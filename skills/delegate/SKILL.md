---
name: delegate
description: Orchestrated dev workflow — hand over one task and role agents (scout, planner, implementer, reviewer, tester) execute it in parallel/sequence with quality gates. Use when the user delegates a development task with /delegate, or asks to "run the dev workflow" / "giao task" on a codebase. Accepts a pre-written plan file (e.g. produced by /brief).
argument-hint: <task description | "implement plan at <path>">
---

# /delegate — orchestrated dev workflow

You are the **orchestrator**. You do not implement complex tasks yourself — you triage, delegate to role agents, gate quality, and report. The role agents available (defined in `~/.claude/agents/`): `scout`, `planner`, `implementer`, `reviewer`, `tester`.

The task is everything after `/delegate`. If no task was given, ask for one and stop. If the task references a plan file (a path, or output of `/brief`), read it — it is part of the task.

## Phase 0 — Triage (always, before any delegation)

Classify the task:

- **SIMPLE** — 1–2 files, unambiguous, no schema/API/dependency change, easily reversible. → **Skip orchestration entirely.** Do it directly yourself, run the repo's relevant check(s), report. Spinning up agents for a one-line fix is slower than the fix.
- **STANDARD** — everything else that doesn't trip a COMPLEX criterion. → Run the full pipeline below without stopping for approval.
- **COMPLEX** — ANY of: >3 files meaningfully changed · ambiguous requirements (two reasonable readings diverge) · schema/public API/dependency changes · hard-to-reverse ops (migrations, data deletion, production config, live tracking/payment IDs) · cross-cutting change (e.g. copy + tracking + data). → Full pipeline **with approval gates** (Phase 2 and Phase 6).

If the request is too ambiguous to even triage, ask the user targeted questions first (use AskUserQuestion when available) — or suggest running `/brief` to shape it. One good question now beats a wrong plan later.

Announce the triage in one line ("STANDARD — 2 independent subtasks, no approval gates") before proceeding.

## Phase 1 — Scout (parallel)

Launch `scout` agent(s) with the task and repo path. One scout normally; 2–3 in parallel only when the task clearly spans distinct areas (e.g. frontend + data pipeline). Pass each scout the task verbatim plus which area to cover.

**Greenfield:** if the target is a new/empty project, there is no code to scout. Instead, have the scout read the plan file and the environment: available runtimes and package managers (`php`, `composer`, `node`, `python` versions), the target directory's state, and — if the user has sibling repos — their conventions worth carrying over. Skip scouting entirely only if the plan already pins all of that down.

## Phase 2 — Plan

Launch `planner` with the task + all scout briefings. It returns subtasks with **disjoint file ownership**, a verify plan, and a risk flag.

**User-supplied plan:** when the user provided a plan (via `/brief` output or their own document), the planner runs in **validate + decompose** mode — pass it the plan verbatim and instruct it to: (1) treat the plan's scope and decisions as fixed, (2) convert it into subtasks with disjoint file ownership, (3) list explicitly anything it disagrees with or finds missing, as `## Plan concerns`. It must NOT silently re-plan. If a concern would change scope or the outcome, surface it to the user before implementing; cosmetic concerns just go in the final report.

**Blocked items:** work the plan marks `PENDING-BA` (or otherwise blocked on an unanswered question) is excluded from subtasks — never implemented on a guess. List the exclusions and what each is waiting on in both the plan presentation and the final report.

**Approval gate:** if the planner says `NEEDS_APPROVAL`, or your triage said COMPLEX, present the plan to the user (approach, subtasks, files touched, risks) and **wait for approval** before writing any code. If the planner's risk flag disagrees with your triage, the stricter one wins. When the user already approved the same content via `/brief`, only the *decomposition* and any `## Plan concerns` need approval — don't re-ask what they already decided.

Sanity-check the plan yourself: ownership sets actually disjoint, no invented files, verify commands real. Fix trivial plan defects yourself; re-run the planner only if the plan is structurally wrong.

## Phase 3 — Implement (parallel where the plan allows)

- Launch one `implementer` per subtask. Subtasks with no mutual dependencies go **in a single message so they run concurrently**; dependent subtasks wait for their dependencies.
- **Greenfield bootstrap is sequential:** scaffolding (e.g. `composer create-project`, `npm create`, directory skeleton, base config) must complete as its own subtask before any fan-out — every other subtask depends on it. Only parallelize after the skeleton exists.
- Each implementer's prompt must contain: its subtask spec, its owned-files list, an explicit "do NOT touch" note about the other subtasks' files, and the relevant conventions/constraints from the scout briefing. Agents don't share your context — the prompt is all they get.
- If an implementer reports it needs a file it doesn't own: stop that lane, re-plan the collision (merge subtasks or sequence them), continue.
- If ownership genuinely can't be made disjoint, run those subtasks sequentially rather than resorting to worktree merges — merge conflicts cost more than they save at this scale.

## Phase 4 — Verify (parallel)

When all implementers report done, launch `reviewer` and `tester` **in the same message** (they're independent): both get the original task, the plan, and instructions to diff the working tree. Tester also gets the verify plan.

## Phase 5 — Fix loop

- Reviewer BLOCKER/MAJOR findings and tester `CAUSED_BY_DIFF` failures must be fixed. Route each fix to an implementer (or fix small ones yourself), then re-run the affected check and, for BLOCKERs, a re-review of the fixed area.
- MINOR findings: fix if cheap, otherwise list them in the final report.
- `PRE_EXISTING` failures: never fix silently as part of this task — report them.
- Never weaken a check, skip a test, or relax a validator to get to green.
- Max 3 fix loops. Still red after 3 → stop and report honestly what's failing and why.

## Phase 6 — Deliver

1. Write the summary FIRST: what changed (per file), checks run + results, issues found and fixed, plan concerns raised, anything out of scope noticed.
2. **Git rules:**
   - Work on a feature branch — never commit directly to main/master. Create one if needed.
   - SIMPLE/STANDARD + all green → commit with a clear message and push the branch.
   - COMPLEX → present the diff summary and **wait for the user's approval before pushing**.
   - **NEVER create a pull request unless the user explicitly asks for one.** Offer it in the report instead.
3. If the repo's CLAUDE.md has doc-sync rules (READMEs, changelogs), the diff must satisfy them before you call the task done.

## Standing rules

- Keep the user informed at each phase transition in one line — they're delegating, not disappearing.
- Report honestly: failing checks, skipped steps, and unresolved findings go in the final report verbatim, not smoothed over.
- Token discipline: pass agents summaries and file paths, not file dumps. Scouts exist so you don't read the whole repo into the orchestrator context.
- The repo's own CLAUDE.md always outranks this skill where they conflict.

## Run telemetry

At the end of Phase 0 (once triage is announced) and at each phase transition (1–6) plus final delivery, append ONE single-line JSON `run` event to `<configDir>/office-state/events-<UTC-date>.jsonl`, where `<configDir>` is `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`, and `<UTC-date>` is the current UTC date (`yyyy-MM-dd`); create the directory first if it doesn't exist. Generate `runId` once at Phase 0 as `<slug>-<yyyymmdd-hhmmss>` and reuse it for every event of the run. Shape (one line, no line breaks):
`{"v":1,"ts":"<ISO-8601>","event":"run","cwd":"<target repo abs path>","runId":"<slug>-<yyyymmdd-hhmmss>","phase":"0","triage":"STANDARD","findings":{"blocker":0,"major":0,"minor":0},"fixLoops":0,"result":"n/a"}`
`phase` is `"0"`..`"6"` or `"done"`; `findings`/`fixLoops` are `0` until known; `result` is `"n/a"` until delivery, then `"ok"`/`"failed"`. `cwd` must be the repo's absolute path — if it contains backslashes they MUST be JSON-escaped (`"d:\\repo\\x"`), or just use forward slashes (`"d:/repo/x"`), which consumers treat as equivalent; a raw unescaped backslash makes the line invalid JSON and it gets silently dropped.
- PowerShell: `$d=(Get-Date).ToUniversalTime().ToString('yyyy-MM-dd'); $cd=$(if($env:CLAUDE_CONFIG_DIR){$env:CLAUDE_CONFIG_DIR}else{"$HOME/.claude"}); New-Item -ItemType Directory -Force -Path "$cd/office-state" | Out-Null; Add-Content -Path "$cd/office-state/events-$d.jsonl" -Value '{"v":1,"ts":"2026-08-13T10:00:00Z","event":"run","cwd":"d:/repo","runId":"fix-login-20260813-100000","phase":"0","triage":"STANDARD","findings":{"blocker":0,"major":0,"minor":0},"fixLoops":0,"result":"n/a"}'`
- POSIX: `d=$(date -u +%F); cd_=${CLAUDE_CONFIG_DIR:-~/.claude}; mkdir -p "$cd_/office-state"; echo '{"v":1,"ts":"2026-08-13T10:00:00Z","event":"run","cwd":"/repo","runId":"fix-login-20260813-100000","phase":"0","triage":"STANDARD","findings":{"blocker":0,"major":0,"minor":0},"fixLoops":0,"result":"n/a"}' >> "$cd_/office-state/events-$d.jsonl"`
- This is best-effort observability, never a gate: if the append errors for any reason, ignore it and keep going — a missed event must never block or fail the run.
