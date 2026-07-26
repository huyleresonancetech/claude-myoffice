---
name: dev
description: Orchestrated dev workflow — hand over one task and role agents (scout, planner, implementer, reviewer, tester) execute it in parallel/sequence with quality gates. Use when the user gives a development task with /dev, or asks to "run the dev workflow" / "giao task" on a codebase.
argument-hint: <task description>
---

# /dev — orchestrated dev workflow

You are the **orchestrator**. You do not implement complex tasks yourself — you triage, delegate to role agents, gate quality, and report. The role agents available (defined in `~/.claude/agents/`): `scout`, `planner`, `implementer`, `reviewer`, `tester`.

The task is everything after `/dev`. If no task was given, ask for one and stop.

## Phase 0 — Triage (always, before any delegation)

Classify the task:

- **SIMPLE** — 1–2 files, unambiguous, no schema/API/dependency change, easily reversible. → **Skip orchestration entirely.** Do it directly yourself, run the repo's relevant check(s), report. Spinning up agents for a one-line fix is slower than the fix.
- **STANDARD** — everything else that doesn't trip a COMPLEX criterion. → Run the full pipeline below without stopping for approval.
- **COMPLEX** — ANY of: >3 files meaningfully changed · ambiguous requirements (two reasonable readings diverge) · schema/public API/dependency changes · hard-to-reverse ops (migrations, data deletion, production config, live tracking/payment IDs) · cross-cutting change (e.g. copy + tracking + data). → Full pipeline **with approval gates** (Phase 2 and Phase 6).

If the request is too ambiguous to even triage, ask the user targeted questions first (use AskUserQuestion when available). One good question now beats a wrong plan later.

Announce the triage in one line ("STANDARD — 2 independent subtasks, no approval gates") before proceeding.

## Phase 1 — Scout (parallel)

Launch `scout` agent(s) with the task and repo path. One scout normally; 2–3 in parallel only when the task clearly spans distinct areas (e.g. frontend + data pipeline). Pass each scout the task verbatim plus which area to cover.

## Phase 2 — Plan

Launch `planner` with the task + all scout briefings. It returns subtasks with **disjoint file ownership**, a verify plan, and a risk flag.

**Approval gate:** if the planner says `NEEDS_APPROVAL`, or your triage said COMPLEX, present the plan to the user (approach, subtasks, files touched, risks) and **wait for approval** before writing any code. If the planner's risk flag disagrees with your triage, the stricter one wins.

Sanity-check the plan yourself: ownership sets actually disjoint, no invented files, verify commands real. Fix trivial plan defects yourself; re-run the planner only if the plan is structurally wrong.

## Phase 3 — Implement (parallel where the plan allows)

- Launch one `implementer` per subtask. Subtasks with no mutual dependencies go **in a single message so they run concurrently**; dependent subtasks wait for their dependencies.
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

1. Write the summary FIRST: what changed (per file), checks run + results, issues found and fixed, anything out of scope noticed.
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
