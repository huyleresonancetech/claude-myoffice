// Folds the office-viz event stream into an in-memory world state, shaped
// per schema.md's "World-state JSON". Pure: no I/O, no timers — callers
// (the tailer/server) own transport and scheduling.
'use strict';

const DEFAULT_STALE_MS = 30 * 60 * 1000;
const RUN_DONE_VISIBLE_MS = 60 * 1000;

function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

// Normalizes a cwd for comparison only — Windows hook payloads carry native
// backslash paths while orchestrator-written run events may use forward
// slashes or a different drive-letter case; the stored/displayed cwd is
// never touched, only what we compare against.
function normCwd(cwd) {
  return String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function createWorld() {
  return { sessions: {}, _seq: 0 };
}

function nextSeq(world) {
  world._seq += 1;
  return world._seq;
}

function ensureSession(world, sessionId, event) {
  let session = world.sessions[sessionId];
  if (!session) {
    session = {
      cwd: event.cwd,
      startedAt: event.ts,
      lastSeen: event.ts,
      agents: {},
      run: null,
      _agentSeq: 0,
    };
    world.sessions[sessionId] = session;
  }
  if (event.cwd !== undefined) session.cwd = event.cwd;
  session.lastSeen = event.ts;
  return session;
}

// Among a session's active agents, the one with the highest _seq is the
// most recently started — used both to attribute agent_activity bubbles
// and to pick which agent an untargeted agent_stop removes (LIFO).
function mostRecentAgentKey(session) {
  let bestKey = null;
  let bestSeq = -1;
  for (const key of Object.keys(session.agents)) {
    const seq = session.agents[key]._seq;
    if (seq > bestSeq) {
      bestSeq = seq;
      bestKey = key;
    }
  }
  return bestKey;
}

function handleSessionStart(world, event) {
  if (!event.sessionId) return;
  ensureSession(world, event.sessionId, event);
}

function handleSessionEnd(world, event) {
  if (!event.sessionId) return;
  delete world.sessions[event.sessionId];
}

function handleAgentStart(world, event) {
  if (!event.sessionId) return;
  const session = ensureSession(world, event.sessionId, event);
  const role = event.role || 'claude';
  session._agentSeq += 1;
  const key = `${role}#${session._agentSeq}`;
  session.agents[key] = {
    role,
    label: event.label,
    activity: null,
    startedAt: event.ts,
    _seq: nextSeq(world),
  };
}

function handleAgentActivity(world, event) {
  if (!event.sessionId) return;
  const session = ensureSession(world, event.sessionId, event);
  const key = mostRecentAgentKey(session);
  if (!key) return;
  session.agents[key].activity = { tool: event.tool, target: event.target };
}

function handleAgentStop(world, event) {
  if (!event.sessionId) return;
  const session = ensureSession(world, event.sessionId, event);
  const key = mostRecentAgentKey(session);
  if (key) delete session.agents[key];
}

function handleStop(world, event) {
  if (!event.sessionId) return;
  const session = ensureSession(world, event.sessionId, event);
  session.agents = {};
}

function findSessionByCwd(world, cwd) {
  const target = normCwd(cwd);
  for (const sessionId of Object.keys(world.sessions)) {
    if (normCwd(world.sessions[sessionId].cwd) === target) return sessionId;
  }
  return null;
}

function handleRun(world, event) {
  if (event.runId == null) return;

  let sessionId = findSessionByCwd(world, event.cwd);
  if (!sessionId) {
    sessionId = `run:${event.runId}`;
    if (!world.sessions[sessionId]) {
      world.sessions[sessionId] = {
        cwd: event.cwd,
        startedAt: event.ts,
        lastSeen: event.ts,
        agents: {},
        run: null,
        _agentSeq: 0,
        _synthetic: true,
      };
    }
  }

  const session = world.sessions[sessionId];
  session.lastSeen = event.ts;

  const priorRun = session.run;
  const startedAt = priorRun && priorRun.runId === event.runId ? priorRun.startedAt : event.ts;

  session.run = {
    runId: event.runId,
    phase: event.phase,
    triage: event.triage,
    fixLoops: typeof event.fixLoops === 'number' ? event.fixLoops : 0,
    findings: event.findings || { blocker: 0, major: 0, minor: 0 },
    startedAt,
    _doneAt: event.phase === 'done' ? event.ts : null,
  };
}

function applyEvent(world, event) {
  if (!event || typeof event !== 'object') return;
  switch (event.event) {
    case 'session_start':
      return handleSessionStart(world, event);
    case 'session_end':
      return handleSessionEnd(world, event);
    case 'agent_start':
      return handleAgentStart(world, event);
    case 'agent_activity':
      return handleAgentActivity(world, event);
    case 'agent_stop':
      return handleAgentStop(world, event);
    case 'stop':
      return handleStop(world, event);
    case 'run':
      return handleRun(world, event);
    default:
      return; // unknown event type, ignore
  }
}

function expireStale(world, now, timeoutMs = DEFAULT_STALE_MS) {
  const nowMs = toMs(now);
  for (const sessionId of Object.keys(world.sessions)) {
    const session = world.sessions[sessionId];
    if (session.run && session.run.phase === 'done' && session.run._doneAt) {
      if (nowMs - toMs(session.run._doneAt) > RUN_DONE_VISIBLE_MS) {
        session.run = null;
      }
    }
    if (nowMs - toMs(session.lastSeen) > timeoutMs) {
      delete world.sessions[sessionId];
    }
  }
}

function toState(world) {
  const sessions = {};
  for (const sessionId of Object.keys(world.sessions)) {
    const session = world.sessions[sessionId];
    const agents = {};
    for (const agentKey of Object.keys(session.agents)) {
      const agent = session.agents[agentKey];
      agents[agentKey] = {
        role: agent.role,
        label: agent.label,
        activity: agent.activity ? { tool: agent.activity.tool, target: agent.activity.target } : null,
        startedAt: agent.startedAt,
      };
    }
    sessions[sessionId] = {
      cwd: session.cwd,
      startedAt: session.startedAt,
      lastSeen: session.lastSeen,
      agents,
      run: session.run
        ? {
            runId: session.run.runId,
            phase: session.run.phase,
            triage: session.run.triage,
            fixLoops: session.run.fixLoops,
            findings: session.run.findings,
            startedAt: session.run.startedAt,
          }
        : null,
    };
  }
  return { sessions };
}

module.exports = { createWorld, applyEvent, toState, expireStale };
