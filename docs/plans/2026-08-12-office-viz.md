# Office Viz — Gather-style pixel visualization + office metrics

## Goal
A local web app that visualizes this machine's Claude Code activity as a Gather-style pixel office: every session appears live, role agents (scout/planner/implementer/reviewer/tester/analyst) sit at desks and show what they're doing, and the office's effectiveness is measured per run and over time.

## Definition of done
- `node office-viz/server.js` (or `npm start` in `office-viz/`) serves the office page on localhost.
- Starting any Claude Code session on this machine makes it appear in the office within ~2s; spawning a subagent moves an avatar to its role desk with a bubble showing current activity (tool + target, e.g. "Edit auth.ts"); agent leaves the desk on SubagentStop.
- A `/delegate` run shows a live HUD: phase, elapsed time, fix-loop count; on completion the run record includes duration per phase, reviewer findings (BLOCKER/MAJOR/MINOR), fix loops, first-verify-green flag, and token usage per agent.
- `/dashboard` page renders history aggregates from stored runs: tasks completed over time, avg duration trend, cost per run/agent, per-repo comparison.
- Hooks are registered in `~/.claude/settings.json` by `setup.ps1` / `setup.sh` (idempotent, both platforms).
- `node --test` passes for the event parser and metrics aggregator.

## Scope
### In
- `office-viz/` subfolder: hook emitter script, collector/server, canvas frontend, dashboard page, tests.
- Hook events (user level): SessionStart/SessionEnd, PreToolUse+PostToolUse on Task/Agent (subagent lifecycle + label), PostToolUse on Edit/Write/Bash (activity bubbles), SubagentStop, Stop.
- Token/cost: parsed once per agent/run end from the `transcript_path` the hook payload provides (sum `usage` fields).
- Structured run events from the orchestrator: small edit to `skills/delegate/SKILL.md` — at each phase transition and at delivery, the orchestrator appends one JSON line (run id, phase, triage class, findings counts, fix loops, result) to the same event log.
- Storage: append-only JSONL per day under `~/.claude/office-state/`; aggregation computed on read. No database.
- Transport: server tails JSONL and pushes via SSE. Zero/minimal npm deps.
- Pixel assets: CC0 only (Kenney or hand-rolled minimal tiles) committed to the repo. Do NOT commit LimeZu assets (free pack forbids redistribution); an optional note may tell users how to drop them in locally.

### Out
- No cloud/remote viewing, no auth — localhost only.
- No historical replay of avatar movement (history is metrics-only).
- No editing/config UI for the map; map layout is a static JSON in the repo.
- No tracking of non-Claude work (calendar, git stats, etc.).
- No autostart daemon/service; user launches the server manually.

## Constraints
- Windows is the primary platform (hooks must work with PowerShell-invoked commands); Unix supported via setup.sh.
- Node.js, no framework: plain `http` + SSE backend, vanilla JS + canvas frontend. Tests with the built-in `node --test` runner.
- All code, identifiers, comments in English. No unnecessary comments.
- Transcript JSONL format is not a stable API — isolate all transcript parsing in one module with defensive parsing (unknown fields/shapes degrade to "unknown", never crash).
- Follow repo conventions; update README with a short "Office Viz" section (repo has doc-sync habit).

## Suggested approach
Hook command → `office-viz/emit.js` (reads hook JSON on stdin, appends normalized event to `~/.claude/office-state/events-YYYY-MM-DD.jsonl`). Server tails the file, folds events into an in-memory world state (sessions → agents → current activity → run metrics), serves static frontend, streams state diffs over SSE. Frontend draws a fixed tilemap; each role has a desk zone, idle agents sit in the lounge; HUD panel per active run. Dashboard page fetches `/api/history` (aggregator over stored JSONL + finished-run records).

## Suggested subtasks
1. Event schema + `emit.js` hook emitter + hook registration added to `setup.ps1`/`setup.sh`.
2. Orchestrator instrumentation: phase/quality event emission appended to `skills/delegate/SKILL.md`.
3. Transcript usage parser + metrics aggregator (pure modules) + unit tests.
4. Collector/server: JSONL tail, world-state fold, SSE, static serving, `/api/history`.
5. Frontend office: tilemap, sprites, activity bubbles, run HUD.
6. Dashboard page: history charts (canvas or inline SVG, no chart lib).

## Verify
- `cd office-viz && node --test` — parser + aggregator green.
- Manual: run `setup.ps1`, start server, open the office page, run a small `/delegate` task in another repo; watch scout→planner→implementer→reviewer/tester appear at desks and the run summary land with all four metric groups populated.
- Kill the server mid-run and restart: state rebuilds from JSONL (no lost run).

## Risks & open questions
- Transcript/hook payload format may change between Claude Code versions → defensive parsing module, version-tolerant.
- Hook payload field availability on Windows (transcript_path, subagent naming) must be confirmed empirically in subtask 1 before the schema is frozen.
- Orchestrator-emitted events rely on the model following SKILL.md instructions — occasional missed events must not break aggregates (metrics tolerate gaps).
- Concurrent sessions writing to one JSONL file: append-only single-line writes are atomic enough at this scale; revisit only if corruption is observed.
