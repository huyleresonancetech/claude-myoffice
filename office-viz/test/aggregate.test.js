'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { aggregateHistory } = require('../lib/aggregate.js');

const BASE = Date.UTC(2026, 7, 12, 0, 0, 0);
const iso = (offsetMs) => new Date(BASE + offsetMs).toISOString();

function runEvent(overrides) {
  return {
    v: 1,
    event: 'run',
    runId: 'r1',
    triage: 'small',
    findings: { blocker: 0, major: 0, minor: 0 },
    fixLoops: 0,
    result: 'n/a',
    cwd: '/repo/a',
    sessionId: 'orchestrator',
    ...overrides,
  };
}

test('complete run: durationMs, phaseDurations, firstVerifyGreen true', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0' }),
    runEvent({ ts: iso(1000), phase: '1' }),
    runEvent({
      ts: iso(3000),
      phase: 'done',
      fixLoops: 0,
      result: 'ok',
      findings: { blocker: 0, major: 0, minor: 1 },
    }),
  ];

  const { runs } = aggregateHistory(events);
  assert.equal(runs.length, 1);
  const run = runs[0];

  assert.equal(run.runId, 'r1');
  assert.equal(run.partial, false);
  assert.equal(run.durationMs, 3000);
  assert.deepEqual(run.phaseDurations, { '0': 1000, '1': 2000 });
  assert.equal(run.firstVerifyGreen, true);
  assert.equal(run.cwd, '/repo/a');
});

test('complete run with fix loops is not firstVerifyGreen', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0' }),
    runEvent({ ts: iso(1000), phase: 'done', fixLoops: 2, result: 'ok' }),
  ];

  const { runs } = aggregateHistory(events);
  assert.equal(runs[0].firstVerifyGreen, false);
});

test('run that never reaches done is partial and excluded from daily/perRepo', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0', runId: 'r2' }),
    runEvent({ ts: iso(1000), phase: '1', runId: 'r2' }),
  ];

  const { runs, daily, perRepo } = aggregateHistory(events);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].partial, true);
  assert.equal(runs[0].durationMs, null);
  assert.deepEqual(daily, []);
  assert.deepEqual(perRepo, []);
});

test('agent_start/agent_stop pairing sums tokens per role', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0' }),
    runEvent({ ts: iso(5000), phase: 'done', result: 'ok' }),
    {
      v: 1,
      ts: iso(1000),
      event: 'agent_start',
      sessionId: 'orchestrator',
      cwd: '/repo/a',
      role: 'implementer',
      label: 'do the thing',
    },
    {
      v: 1,
      ts: iso(2000),
      event: 'agent_stop',
      sessionId: 'orchestrator',
      cwd: '/repo/a',
      usage: { input: 100, cacheCreation: 10, cacheRead: 5, output: 20 },
    },
  ];

  const { runs } = aggregateHistory(events);
  const run = runs[0];
  assert.deepEqual(run.tokens.implementer, {
    input: 100,
    cacheCreation: 10,
    cacheRead: 5,
    output: 20,
  });
  assert.equal(run.tokens.claude, undefined);
});

test('unpaired agent_stop and top-level stop land under role "claude"', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0' }),
    runEvent({ ts: iso(5000), phase: 'done', result: 'ok' }),
    {
      v: 1,
      ts: iso(1000),
      event: 'agent_stop',
      sessionId: 'no-matching-start',
      cwd: '/repo/a',
      usage: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 },
    },
    {
      v: 1,
      ts: iso(2000),
      event: 'stop',
      sessionId: 'orchestrator',
      cwd: '/repo/a',
      usage: { input: 2, cacheCreation: 0, cacheRead: 0, output: 2 },
    },
  ];

  const { runs } = aggregateHistory(events);
  assert.deepEqual(runs[0].tokens.claude, {
    input: 3,
    cacheCreation: 0,
    cacheRead: 0,
    output: 3,
  });
});

test('events out of order still aggregate to the same result', () => {
  const inOrder = [
    runEvent({ ts: iso(0), phase: '0' }),
    runEvent({ ts: iso(1000), phase: '1' }),
    runEvent({ ts: iso(3000), phase: 'done', result: 'ok' }),
  ];
  const shuffled = [inOrder[2], inOrder[0], inOrder[1]];

  const a = aggregateHistory(inOrder);
  const b = aggregateHistory(shuffled);
  assert.deepEqual(a, b);
  assert.equal(a.runs[0].durationMs, 3000);
});

test('unknown event types are ignored', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0' }),
    runEvent({ ts: iso(1000), phase: 'done', result: 'ok' }),
    { v: 1, ts: iso(500), event: 'some_future_event', sessionId: 'x', cwd: '/repo/a' },
  ];

  const { runs } = aggregateHistory(events);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].durationMs, 1000);
});

test('daily and perRepo aggregates only include completed runs', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0', runId: 'r1' }),
    runEvent({ ts: iso(1000), phase: 'done', result: 'ok', runId: 'r1', cwd: '/repo/a' }),
    runEvent({ ts: iso(2000), phase: '0', runId: 'r2', cwd: '/repo/b' }),
    runEvent({ ts: iso(4000), phase: 'done', result: 'ok', runId: 'r2', cwd: '/repo/b' }),
  ];

  const { daily, perRepo } = aggregateHistory(events);
  assert.equal(daily.length, 1);
  assert.equal(daily[0].tasksCompleted, 2);
  assert.equal(daily[0].avgDurationMs, 1500);

  assert.equal(perRepo.length, 2);
  const repoA = perRepo.find((r) => r.cwd === '/repo/a');
  const repoB = perRepo.find((r) => r.cwd === '/repo/b');
  assert.equal(repoA.runs, 1);
  assert.equal(repoA.avgDurationMs, 1000);
  assert.equal(repoB.runs, 1);
  assert.equal(repoB.avgDurationMs, 2000);
});

test('phaseDurations accumulate across revisited phases in a fix loop', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '4', runId: 'r-loop' }),
    runEvent({ ts: iso(1000), phase: '5', runId: 'r-loop' }),
    runEvent({ ts: iso(2500), phase: '4', runId: 'r-loop' }),
    runEvent({ ts: iso(4000), phase: '5', runId: 'r-loop' }),
    runEvent({ ts: iso(6000), phase: 'done', result: 'ok', runId: 'r-loop' }),
  ];

  const { runs } = aggregateHistory(events);
  const run = runs[0];

  // leaving '4' happens twice: 1000ms (0->1000) and 1500ms (2500->4000)
  // leaving '5' happens twice: 1500ms (1000->2500) and 2000ms (4000->6000)
  assert.deepEqual(run.phaseDurations, { '4': 2500, '5': 3500 });

  const barTotal = Object.values(run.phaseDurations).reduce((a, b) => a + b, 0);
  assert.equal(barTotal, run.durationMs);
});

test('cwd normalization attributes tokens across slash/case differences and groups perRepo', () => {
  const events = [
    runEvent({ ts: iso(0), phase: '0', runId: 'r-cwd', cwd: 'D:/Repo/X' }),
    runEvent({
      ts: iso(3000),
      phase: 'done',
      result: 'ok',
      runId: 'r-cwd',
      cwd: 'D:/Repo/X',
    }),
    {
      v: 1,
      ts: iso(1000),
      event: 'agent_start',
      sessionId: 'orchestrator',
      cwd: 'd:\\repo\\x',
      role: 'implementer',
      label: 'do the thing',
    },
    {
      v: 1,
      ts: iso(2000),
      event: 'agent_stop',
      sessionId: 'orchestrator',
      cwd: 'd:\\repo\\x',
      usage: { input: 50, cacheCreation: 0, cacheRead: 0, output: 25 },
    },
  ];

  const { runs, perRepo } = aggregateHistory(events);
  const run = runs[0];
  assert.deepEqual(run.tokens.implementer, {
    input: 50,
    cacheCreation: 0,
    cacheRead: 0,
    output: 25,
  });

  assert.equal(perRepo.length, 1);
  assert.equal(perRepo[0].cwd, 'D:/Repo/X');
  assert.equal(perRepo[0].runs, 1);
});
