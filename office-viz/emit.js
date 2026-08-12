#!/usr/bin/env node
// Hook command target for Claude Code. Reads one JSON payload from stdin,
// appends one normalized JSONL event line to today's events file.
//
// Hard constraint: this must NEVER block or fail Claude Code's flow. It must
// always exit 0, print nothing on success, and swallow every error.
'use strict';

function main() {
  const fs = require('fs');
  const path = require('path');
  const schema = require('./schema.js');

  const payload = readPayload(fs);
  if (!payload) return;

  const event = buildEvent(payload, path, schema);
  if (!event) return;

  const dir = schema.stateDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = schema.eventsFile(todayDate());
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
}

function readPayload(fs) {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function envelope(payload) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    sessionId: payload.session_id,
    cwd: payload.cwd,
  };
}

function buildEvent(payload, path, schema) {
  const hookEvent = payload.hook_event_name;
  const toolName = payload.tool_name;

  switch (hookEvent) {
    case 'SessionStart':
      return { ...envelope(payload), event: schema.EVENT_TYPES.SESSION_START };

    case 'SessionEnd':
      return { ...envelope(payload), event: schema.EVENT_TYPES.SESSION_END };

    case 'Stop':
      return {
        ...envelope(payload),
        event: schema.EVENT_TYPES.STOP,
        usage: getUsage(payload),
      };

    case 'SubagentStop':
      return {
        ...envelope(payload),
        event: schema.EVENT_TYPES.AGENT_STOP,
        usage: getUsage(payload),
      };

    case 'PreToolUse':
      if (toolName === 'Task' || toolName === 'Agent') {
        return buildAgentStart(payload, schema);
      }
      return null;

    case 'PostToolUse':
      // SubagentStop is the single source of agent_stop — Claude Code fires both
      // SubagentStop and PostToolUse(Task) for every finished subagent, so a second
      // agent_stop here would duplicate the event and poison LIFO agent pairing.
      if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Bash') {
        return buildAgentActivity(payload, path, schema);
      }
      return null;

    default:
      return null;
  }
}

function buildAgentStart(payload, schema) {
  const input = payload.tool_input || {};
  const role = schema.ROLES.includes(input.subagent_type) ? input.subagent_type : 'claude';
  return {
    ...envelope(payload),
    event: schema.EVENT_TYPES.AGENT_START,
    role,
    label: input.description,
  };
}

function buildAgentActivity(payload, path, schema) {
  const input = payload.tool_input || {};
  const toolName = payload.tool_name;
  let target;
  if (toolName === 'Edit' || toolName === 'Write') {
    target = input.file_path ? path.basename(input.file_path) : undefined;
  } else if (toolName === 'Bash') {
    target = typeof input.command === 'string' ? input.command.slice(0, 40) : undefined;
  }
  return {
    ...envelope(payload),
    event: schema.EVENT_TYPES.AGENT_ACTIVITY,
    tool: toolName,
    target,
  };
}

const USAGE_FIELDS = ['input', 'cacheCreation', 'cacheRead', 'output'];
const USAGE_OFFSETS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const USAGE_OFFSETS_MAX_ENTRIES = 50;

function getUsage(payload) {
  try {
    const transcript = require('./lib/transcript.js');
    if (typeof transcript.sumUsage !== 'function') return null;

    if (payload.agent_transcript_path) {
      // Per-agent transcript is scoped to that one agent — its cumulative total is safe to use as-is.
      return transcript.sumUsage(payload.agent_transcript_path) || null;
    }

    if (payload.transcript_path) {
      // Main session transcript is shared across every agent_stop/stop emitted in that
      // session, and sumUsage returns its running total — diff against the last-seen
      // total (sidecar file) so overlapping emissions don't get summed as if additive.
      const total = transcript.sumUsage(payload.transcript_path);
      return deltaUsage(payload.transcript_path, total);
    }
  } catch {
    // lib/transcript.js not built yet, transcript unreadable, or usage sidecar corrupted/unwritable
  }
  return null;
}

function deltaUsage(transcriptPath, total) {
  if (!total) return null;

  const fs = require('fs');
  const path = require('path');
  const schema = require('./schema.js');
  const offsetsFile = path.join(schema.stateDir(), 'usage-offsets.json');

  const offsets = readOffsets(fs, offsetsFile);
  const prev = offsets[transcriptPath] && offsets[transcriptPath].totals;

  const delta = {};
  for (const field of USAGE_FIELDS) {
    const cur = typeof total[field] === 'number' ? total[field] : 0;
    const before = prev && typeof prev[field] === 'number' ? prev[field] : 0;
    delta[field] = Math.max(0, cur - before);
  }

  offsets[transcriptPath] = { totals: total, ts: Date.now() };
  pruneOffsets(offsets);

  fs.mkdirSync(schema.stateDir(), { recursive: true });
  // temp file + rename so a concurrent/interrupted write can't leave a truncated sidecar
  const tmpFile = offsetsFile + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(offsets));
  try {
    fs.renameSync(tmpFile, offsetsFile);
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw err;
  }

  return delta;
}

function readOffsets(fs, offsetsFile) {
  let raw;
  try {
    raw = fs.readFileSync(offsetsFile, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err; // real read errors (e.g. permissions) should surface as usage: null, not silent {}
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // corrupt sidecar (e.g. interrupted write): reset rather than disable usage tracking forever
    return {};
  }
}

function pruneOffsets(offsets) {
  const now = Date.now();
  for (const key of Object.keys(offsets)) {
    const ts = offsets[key] && offsets[key].ts;
    if (typeof ts !== 'number' || now - ts > USAGE_OFFSETS_MAX_AGE_MS) delete offsets[key];
  }
  const keys = Object.keys(offsets);
  if (keys.length > USAGE_OFFSETS_MAX_ENTRIES) {
    keys
      .sort((a, b) => offsets[a].ts - offsets[b].ts)
      .slice(0, keys.length - USAGE_OFFSETS_MAX_ENTRIES)
      .forEach((key) => delete offsets[key]);
  }
}

// Entry point runs last, after every function/const above has been declared —
// calling it at the top of the file would hit consts (e.g. USAGE_FIELDS) before
// their module-evaluation-order initialization, throwing ReferenceError.
try {
  main();
} catch {
  // swallow — hooks must never throw
}
process.exitCode = 0;
