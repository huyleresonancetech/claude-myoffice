// Tails office-viz's events-YYYY-MM-DD.jsonl files: a full replay of
// today's + yesterday's file on start, then incremental appends after that.
// Uses fs.watchFile (polling) instead of fs.watch — more reliable than
// native filesystem events on Windows, and simple to reason about across
// midnight's file rollover.
'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('../schema.js');

const POLL_INTERVAL_MS = 500;
const EVENTS_FILE_RE = /^events-\d{4}-\d{2}-\d{2}\.jsonl$/;

function parseLines(raw) {
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') events.push(parsed);
    } catch {
      // malformed line - skip silently
    }
  }
  return events;
}

function dateStr(date) {
  return date.toISOString().slice(0, 10);
}

// Reads the bytes appended since `offset`, but only up to the last complete
// line - a trailing partial line (writer mid-append) is left for the next
// poll instead of being parsed as garbage. Shared by the events-JSONL tailer
// and the generic transcript tailer below.
function readRawIncrement(filePath, offset) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return { complete: '', offset };
  }

  // File got truncated or rewritten under us - restart from the top.
  if (stats.size < offset) offset = 0;
  if (stats.size === offset) return { complete: '', offset };

  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return { complete: '', offset };
  }

  const length = stats.size - offset;
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(fd, buffer, 0, length, offset);
  } catch {
    bytesRead = 0;
  } finally {
    fs.closeSync(fd);
  }

  const raw = buffer.slice(0, bytesRead).toString('utf8');
  const lastNewline = raw.lastIndexOf('\n');
  if (lastNewline === -1) return { complete: '', offset }; // no complete line yet

  const complete = raw.slice(0, lastNewline + 1);
  return { complete, offset: offset + Buffer.byteLength(complete, 'utf8') };
}

function readIncrement(filePath, offset) {
  const { complete, offset: next } = readRawIncrement(filePath, offset);
  return { events: parseLines(complete), offset: next };
}

// The byte offset consumed by a fresh full read of `filePath`, up to its
// last complete line. Callers that read a file's current contents (e.g. for
// an initial burst) and then want to tailFile() it from exactly where that
// read left off should pin this offset *before* doing that read — since the
// file only grows, a pre-read offset is always <= what the read actually
// saw, so nothing appended in between is lost (worst case: a line landing
// in that gap is briefly visible in both the initial read and the first
// subsequent tail pump).
function consumedOffset(filePath) {
  return readRawIncrement(filePath, 0).offset;
}

function readFileEvents(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  return parseLines(raw);
}

function listEventFiles(stateDir) {
  let names;
  try {
    names = fs.readdirSync(stateDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => EVENTS_FILE_RE.test(n))
    .sort()
    .map((n) => path.join(stateDir, n));
}

function listAllEvents(stateDir) {
  const events = [];
  for (const file of listEventFiles(stateDir)) {
    events.push(...readFileEvents(file));
  }
  return events;
}

function createTailer(stateDir, onEvent) {
  const offsets = new Map(); // filePath -> bytes already consumed
  const watched = new Set();

  function pump(filePath) {
    const from = offsets.get(filePath) || 0;
    const { events, offset } = readIncrement(filePath, from);
    offsets.set(filePath, offset);
    for (const event of events) onEvent(event);
  }

  function watchFile(filePath) {
    if (watched.has(filePath)) return;
    watched.add(filePath);
    fs.watchFile(filePath, { interval: POLL_INTERVAL_MS }, () => pump(filePath));
  }

  // Prime a file: replay everything already there, remember the offset, then watch it.
  function prime(filePath) {
    const events = readFileEvents(filePath);
    for (const event of events) onEvent(event);
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      size = 0;
    }
    offsets.set(filePath, size);
    watchFile(filePath);
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  prime(schema.eventsFile(dateStr(yesterday)));
  prime(schema.eventsFile(dateStr(new Date())));

  // Poll for the day rolling over so the new day's file gets primed once it appears.
  const rolloverTimer = setInterval(() => {
    const todayFile = schema.eventsFile(dateStr(new Date()));
    if (!watched.has(todayFile)) prime(todayFile);
  }, POLL_INTERVAL_MS);

  function stop() {
    clearInterval(rolloverTimer);
    for (const filePath of watched) fs.unwatchFile(filePath);
    watched.clear();
    offsets.clear();
  }

  return { stop };
}

// Generic byte-offset tailer for any append-only text file (used by the
// agent console to watch a session's transcript). By default starts
// watching from the file's current size; pass `opts.startOffset` (see
// `consumedOffset`) when the caller already read the file's existing
// content and needs to resume from exactly where that read stopped —
// starting from a fresh `statSync().size` instead would both miss lines
// appended in the gap between that read and this call, and risk landing
// mid-line if the file was mid-write at that moment. Independent of
// createTailer's events-JSONL state, so multiple callers on the same or
// different files don't interfere: each gets its own offset and its own
// fs.watchFile listener, unwatched by reference on stop() rather than by
// path (fs.unwatchFile(path) alone would remove every listener on that
// path, including other callers').
function tailFile(filePath, onLines, opts = {}) {
  const interval = opts.interval || POLL_INTERVAL_MS;
  let offset;
  if (typeof opts.startOffset === 'number' && opts.startOffset >= 0) {
    offset = opts.startOffset;
  } else {
    try {
      offset = fs.statSync(filePath).size;
    } catch {
      offset = 0;
    }
  }

  function pump() {
    const { complete, offset: next } = readRawIncrement(filePath, offset);
    offset = next;
    if (!complete) return;
    const lines = complete.split('\n').filter((line) => line.trim());
    if (lines.length) onLines(lines);
  }

  fs.watchFile(filePath, { interval }, pump);

  return {
    stop() {
      fs.unwatchFile(filePath, pump);
    },
  };
}

module.exports = { createTailer, listAllEvents, tailFile, consumedOffset };
