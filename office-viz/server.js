#!/usr/bin/env node
// The office-viz collector/server: tails the event log into an in-memory
// world state, streams it to the pixel-office UI over SSE, and serves the
// history API the dashboard reads. Restart safety comes for free — the
// tailer's initial full replay of today's/yesterday's JSONL rebuilds state
// on boot, nothing is persisted separately.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const schema = require('./schema.js');
const { createTailer, listAllEvents, tailFile, consumedOffset } = require('./lib/tail.js');
const { createWorld, applyEvent, toState, expireStale, getSession } = require('./lib/world.js');
const { aggregateHistory } = require('./lib/aggregate.js');
const { parseLogLine, readLogTail } = require('./lib/transcript.js');

const HOST = '127.0.0.1';
const PORT = Number(process.env.OFFICE_VIZ_PORT) || 4517;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STALE_SWEEP_MS = 60 * 1000;
const BROADCAST_DEBOUNCE_MS = 100;
const HEARTBEAT_MS = 15 * 1000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const world = createWorld();
const sseClients = new Set();
let broadcastTimer = null;

function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastState();
  }, BROADCAST_DEBOUNCE_MS);
}

function broadcastState() {
  const frame = `event: state\ndata: ${JSON.stringify(toState(world))}\n\n`;
  for (const res of sseClients) res.write(frame);
}

function handleEvent(event) {
  applyEvent(world, event);
  scheduleBroadcast();
}

setInterval(() => {
  expireStale(world, Date.now());
  scheduleBroadcast();
}, STALE_SWEEP_MS);

const tailer = createTailer(schema.stateDir(), handleEvent);

// --- static file serving --------------------------------------------------

function resolvePublicPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const clean = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(PUBLIC_DIR, '.' + clean);
  const prefix = PUBLIC_DIR + path.sep;
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(prefix)) return null; // path traversal
  if (resolved === PUBLIC_DIR) return null;
  return resolved;
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveStatic(res, urlPath) {
  const filePath = resolvePublicPath(urlPath);
  if (!filePath) {
    notFound(res);
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      notFound(res);
      return;
    }
    const contentType = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// --- SSE -------------------------------------------------------------------

function serveEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: state\ndata: ${JSON.stringify(toState(world))}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);

  function cleanup() {
    clearInterval(heartbeat);
    sseClients.delete(res);
  }
  req.on('close', cleanup);
  res.on('close', cleanup);
}

// --- agent console log stream -------------------------------------------------

function serveLog(req, res, sessionId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let fileTailer = null;
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);

  function cleanup() {
    clearInterval(heartbeat);
    if (fileTailer) fileTailer.stop();
  }
  req.on('close', cleanup);
  res.on('close', cleanup);

  const session = sessionId ? getSession(world, sessionId) : null;
  const transcriptPath = session && session.transcriptPath;

  // transcriptPath is our own hook-emitted data, not user input — the
  // extension check is a cheap sanity guard, not a security boundary.
  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) {
    res.write('event: log\ndata: []\n\n');
    return; // connection stays open — heartbeats only, client shows "no transcript"
  }

  // Pin the resume offset *before* reading the burst: the file only grows,
  // so a pre-read offset can never be ahead of what the burst read actually
  // saw (no lost appends), it always lands on a real line boundary (no
  // mid-line garbage on the first pump), and starting from statSync().size
  // *after* the read would leave a window where appends are silently missed.
  const offset = consumedOffset(transcriptPath);
  res.write(`event: log\ndata: ${JSON.stringify(readLogTail(transcriptPath, 200))}\n\n`);

  fileTailer = tailFile(
    transcriptPath,
    (lines) => {
      const entries = [];
      for (const line of lines) entries.push(...parseLogLine(line));
      if (entries.length) res.write(`event: log\ndata: ${JSON.stringify(entries)}\n\n`);
    },
    { startOffset: offset }
  );
}

// --- history API -------------------------------------------------------------

function serveHistory(res) {
  const events = listAllEvents(schema.stateDir());
  const history = aggregateHistory(events);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(history));
}

// --- routing -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '';
  // A well-formed request-target starts with exactly one '/'. Node's HTTP
  // parser passes oddities like "//[" straight through, and new URL() on
  // that throws (host "[") — reject before it ever reaches the constructor.
  if (rawUrl[0] !== '/' || rawUrl[1] === '/') {
    notFound(res);
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl, `http://${HOST}`);
  } catch {
    notFound(res);
    return;
  }
  const urlPath = parsedUrl.pathname;

  if (req.method !== 'GET') {
    notFound(res);
    return;
  }
  if (urlPath === '/events') {
    serveEvents(req, res);
    return;
  }
  if (urlPath === '/api/log') {
    serveLog(req, res, parsedUrl.searchParams.get('session'));
    return;
  }
  if (urlPath === '/api/history') {
    serveHistory(res);
    return;
  }
  serveStatic(res, urlPath);
});

server.listen(PORT, HOST, () => {
  console.log(`office-viz listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  tailer.stop();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
