// Folds a flat list of already-parsed office-viz events into the
// { runs, daily, perRepo } shape documented in schema.md's History API.
// Pure function: no I/O, tolerant of duplicate/out-of-order/unknown events.
'use strict';

function emptyUsage() {
  return { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
}

function toUsage(usage) {
  const u = emptyUsage();
  if (!usage || typeof usage !== 'object') return u;
  u.input = typeof usage.input === 'number' ? usage.input : 0;
  u.cacheCreation = typeof usage.cacheCreation === 'number' ? usage.cacheCreation : 0;
  u.cacheRead = typeof usage.cacheRead === 'number' ? usage.cacheRead : 0;
  u.output = typeof usage.output === 'number' ? usage.output : 0;
  return u;
}

function addUsage(target, usage) {
  target.input += usage.input;
  target.cacheCreation += usage.cacheCreation;
  target.cacheRead += usage.cacheRead;
  target.output += usage.output;
}

function mergeTokensInto(target, source) {
  for (const role of Object.keys(source || {})) {
    if (!target[role]) target[role] = emptyUsage();
    addUsage(target[role], source[role]);
  }
}

function parseTs(ts) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

function tsOf(event) {
  return parseTs(event && event.ts);
}

// Windows paths from hook payloads and orchestrator-written run events can
// differ in slash direction and drive-letter case; normalize before any
// cwd comparison or grouping.
function normCwd(cwd) {
  return String(cwd || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// Assigns a role to every agent_stop event by pairing it with the nearest
// preceding, still-unpaired agent_start in the same session. Unpaired
// agent_stop events (no matching agent_start) fall back to role "claude".
function pairAgentStopRoles(events) {
  const roleByStop = new Map();
  const stacks = new Map();

  const relevant = events
    .filter((e) => e && (e.event === 'agent_start' || e.event === 'agent_stop'))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => tsOf(a.e) - tsOf(b.e) || a.i - b.i);

  for (const { e } of relevant) {
    const sid = e.sessionId;
    if (e.event === 'agent_start') {
      if (!stacks.has(sid)) stacks.set(sid, []);
      stacks.get(sid).push(e.role);
    } else {
      const stack = stacks.get(sid);
      const role = stack && stack.length ? stack.pop() : 'claude';
      roleByStop.set(e, role);
    }
  }

  return roleByStop;
}

function groupRuns(events) {
  const byRunId = new Map();
  for (const e of events) {
    if (!e || e.event !== 'run' || e.runId == null) continue;
    if (!byRunId.has(e.runId)) byRunId.set(e.runId, []);
    byRunId.get(e.runId).push(e);
  }
  return byRunId;
}

function buildRunRow(runId, runEvents) {
  const sorted = [...runEvents].sort((a, b) => tsOf(a) - tsOf(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const reachedDone = sorted.some((e) => e.phase === 'done');
  const windowStartMs = tsOf(first);
  const windowEndMs = tsOf(last);

  const phaseDurations = {};
  for (let i = 0; i < sorted.length - 1; i++) {
    const leavingPhase = sorted[i].phase;
    if (leavingPhase == null) continue;
    const delta = tsOf(sorted[i + 1]) - tsOf(sorted[i]);
    phaseDurations[leavingPhase] = (phaseDurations[leavingPhase] || 0) + delta;
  }

  const fixLoops = typeof last.fixLoops === 'number' ? last.fixLoops : 0;
  const result = last.result || 'n/a';

  return {
    runId,
    startedAt: first.ts,
    durationMs: reachedDone ? windowEndMs - windowStartMs : null,
    partial: !reachedDone,
    phaseDurations,
    findings: last.findings || { blocker: 0, major: 0, minor: 0 },
    fixLoops,
    triage: last.triage,
    result,
    firstVerifyGreen: fixLoops === 0 && result === 'ok',
    cwd: last.cwd,
    windowStartMs,
    windowEndMs,
  };
}

// Sums usage from agent_stop/stop events landing inside the run's time
// window and matching its cwd, keyed by the role assigned via pairing.
function computeRunTokens(run, events, stopRoleMap) {
  const tokens = {};
  const runCwd = normCwd(run.cwd);
  for (const e of events) {
    if (!e || (e.event !== 'agent_stop' && e.event !== 'stop')) continue;
    if (normCwd(e.cwd) !== runCwd) continue;
    const t = tsOf(e);
    if (t < run.windowStartMs || t > run.windowEndMs) continue;

    const role = e.event === 'stop' ? 'claude' : stopRoleMap.get(e) || 'claude';
    if (!tokens[role]) tokens[role] = emptyUsage();
    addUsage(tokens[role], toUsage(e.usage));
  }
  return tokens;
}

function buildDaily(completedRuns) {
  const byDate = new Map();
  for (const r of completedRuns) {
    const date = typeof r.startedAt === 'string' ? r.startedAt.slice(0, 10) : '';
    if (!date) continue;
    if (!byDate.has(date)) {
      byDate.set(date, { date, tasksCompleted: 0, totalDurationMs: 0, tokens: {} });
    }
    const bucket = byDate.get(date);
    bucket.tasksCompleted += 1;
    bucket.totalDurationMs += r.durationMs || 0;
    mergeTokensInto(bucket.tokens, r.tokens);
  }

  const daily = [...byDate.values()].map((bucket) => ({
    date: bucket.date,
    tasksCompleted: bucket.tasksCompleted,
    avgDurationMs: bucket.totalDurationMs / bucket.tasksCompleted,
    tokens: bucket.tokens,
  }));
  daily.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return daily;
}

function buildPerRepo(completedRuns) {
  const byCwd = new Map();
  for (const r of completedRuns) {
    if (r.cwd == null) continue;
    const key = normCwd(r.cwd);
    if (!byCwd.has(key)) {
      // Keep the first-seen original string for display; grouping key is normalized.
      byCwd.set(key, { cwd: r.cwd, runs: 0, totalDurationMs: 0, tokens: {} });
    }
    const bucket = byCwd.get(key);
    bucket.runs += 1;
    bucket.totalDurationMs += r.durationMs || 0;
    mergeTokensInto(bucket.tokens, r.tokens);
  }

  const perRepo = [...byCwd.values()].map((bucket) => ({
    cwd: bucket.cwd,
    runs: bucket.runs,
    avgDurationMs: bucket.totalDurationMs / bucket.runs,
    tokens: bucket.tokens,
  }));
  perRepo.sort((a, b) => (a.cwd < b.cwd ? -1 : a.cwd > b.cwd ? 1 : 0));
  return perRepo;
}

function aggregateHistory(events) {
  const list = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object') : [];

  const stopRoleMap = pairAgentStopRoles(list);
  const runGroups = groupRuns(list);

  const runs = [];
  for (const [runId, runEvents] of runGroups) {
    const built = buildRunRow(runId, runEvents);
    const tokens = computeRunTokens(built, list, stopRoleMap);
    const { windowStartMs, windowEndMs, ...row } = built;
    runs.push({ ...row, tokens });
  }
  runs.sort((a, b) => parseTs(a.startedAt) - parseTs(b.startedAt));

  const completed = runs.filter((r) => !r.partial);

  return {
    runs,
    daily: buildDaily(completed),
    perRepo: buildPerRepo(completed),
  };
}

module.exports = { aggregateHistory };
