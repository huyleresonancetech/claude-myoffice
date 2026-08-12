# office-viz event & state schema

This is the contract every office-viz subtask builds against. Changing it requires
updating `schema.js` and every consumer (collector/server, aggregator, frontend).

## Storage

Events are appended as JSONL, one file per day, under:

```
<configDir>/office-state/events-YYYY-MM-DD.jsonl
```

`configDir` is `process.env.CLAUDE_CONFIG_DIR` if set, else `~/.claude`. See
`schema.js` (`stateDir()`, `eventsFile(date)`).

## JSONL event envelope

Every line is one JSON object, written by `emit.js` (except `run` events, see below):

```json
{ "v": 1, "ts": "<ISO-8601>", "event": "<type>", "sessionId": "<string>", "cwd": "<string>" }
```

`event` is one of the types in `EVENT_TYPES` (`schema.js`): `session_start`,
`session_end`, `agent_start`, `agent_activity`, `agent_stop`, `stop`, `run`.

Per-type extra fields, merged into the envelope:

- **agent_start**: `{ role, label }`
  - `role`: one of `ROLES` (`scout`, `planner`, `implementer`, `reviewer`, `tester`,
    `analyst`), or `claude` as fallback when the subagent type is missing/unrecognized.
  - `label`: the subagent's `description` (short human-readable task summary).
- **agent_activity**: `{ tool, target }`
  - `tool`: `Edit`, `Write`, or `Bash`.
  - `target`: for `Edit`/`Write`, the basename of the edited file; for `Bash`, the
    first ~40 characters of the command string.
- **agent_stop**: `{ usage }`
- **stop**: `{ usage }`
- **run**: written by the `/delegate` orchestrator directly (not by `emit.js`), one
  line per phase transition / delivery. Shape:
  `{ runId, phase, triage, findings: { blocker, major, minor }, fixLoops, result }`
  - `phase`: `"0"` .. `"6"` or `"done"`. Labels: 0 Triage, 1 Scout, 2 Plan,
    3 Implement, 4 Verify, 5 Fix loop, 6 Deliver.
  - `triage`: the orchestrator's triage classification (free-form string).
  - `findings`: counts of reviewer findings by severity.
  - `fixLoops`: number of fix/re-review loops so far.
  - `result`: `"ok"` | `"failed"` | `"n/a"` (n/a until the run concludes).

### `usage` shape

```json
{ "input": <number>, "cacheCreation": <number>, "cacheRead": <number>, "output": <number> }
```

or `null` when usage could not be determined (e.g. transcript unreadable or the
transcript parser module is not yet available).

`usage` on `agent_stop`/`stop` is a **delta** since the previous emission for that
transcript, not a cumulative total. This matters for the main session transcript
(`payload.transcript_path`), which is shared across every `agent_stop`/`stop` emitted
in that session and whose parser returns a running total — `emit.js` diffs it against
a sidecar (`<stateDir>/usage-offsets.json`) to avoid double-counting overlapping
emissions. Per-agent transcripts (`payload.agent_transcript_path`) are scoped to one
agent, so their total is used as-is (no diffing needed). Known limitation: the first
observation for a given transcript has no prior offset, so its "delta" may include
usage from earlier in that transcript's history.

## World-state JSON

The collector/server folds the event stream into an in-memory world state, shaped:

```json
{
  "sessions": {
    "<sessionId>": {
      "cwd": "<string>",
      "startedAt": "<ISO-8601>",
      "lastSeen": "<ISO-8601>",
      "agents": {
        "<agentKey>": {
          "role": "<ROLES entry>",
          "label": "<string>",
          "activity": { "tool": "<string>", "target": "<string>" } | null,
          "startedAt": "<ISO-8601>"
        }
      },
      "run": {
        "runId": "<string>",
        "phase": "<string>",
        "triage": "<string>",
        "fixLoops": <number>,
        "findings": { "blocker": <number>, "major": <number>, "minor": <number> },
        "startedAt": "<ISO-8601>"
      } | null
    }
  }
}
```

Note: hook payloads carry no agent identity, so attributing an `agent_activity`
bubble to a specific concurrent agent is heuristic — it attaches to the
most-recently-started agent still active in that session.

**cwd normalization**: `cwd` values in events/world-state are not normalized at the
source (they're whatever the hook payload reports). Consumers must compare `cwd`
case-insensitively, with backslashes normalized to forward slashes and any trailing
slash stripped, before treating two `cwd` values as "the same repo" (e.g. for
per-repo history aggregation or session grouping).

## Live transport: SSE

`GET /events` — server-sent events.

- Event name: `state`. Data: the full world-state JSON, sent on every change.
- A heartbeat comment (`:`-prefixed line) is sent every 15s to keep the connection alive.

## History API

`GET /api/history` -> `{ runs, daily, perRepo }`

- **runs**: array of
  `{ runId, startedAt, durationMs, phaseDurations, findings, fixLoops, firstVerifyGreen, tokens, cwd, triage, result, partial? }`
  - `tokens`: role-keyed map — `{ "<role>": { input, cacheCreation, cacheRead, output } }`.
  - `partial: true` marks runs that never reached phase `"done"`; they are excluded
    from `daily`/`perRepo` aggregates.
- **daily**: array of `{ date, tasksCompleted, avgDurationMs, tokens }`
- **perRepo**: array of `{ cwd, runs, avgDurationMs, tokens }`
- `daily.tokens` / `perRepo.tokens` use the same role-keyed map shape as `runs[].tokens`.
