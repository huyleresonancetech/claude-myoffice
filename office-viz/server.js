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
const { createTailer, listAllEvents } = require('./lib/tail.js');
const { createWorld, applyEvent, toState, expireStale } = require('./lib/world.js');
const { aggregateHistory } = require('./lib/aggregate.js');

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

// --- history API -------------------------------------------------------------

function serveHistory(res) {
  const events = listAllEvents(schema.stateDir());
  const history = aggregateHistory(events);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(history));
}

// --- routing -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method !== 'GET') {
    notFound(res);
    return;
  }
  if (urlPath === '/events') {
    serveEvents(req, res);
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
