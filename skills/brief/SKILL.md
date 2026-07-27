---
name: brief
description: Design a task together with the user through structured interrogation, then write a plan file that /delegate can execute. Also ingests BA/design docs (Figma exports, screenshots, PDFs) via analyst agents before the interview. Use when the user wants to shape, spec, or brief a piece of work before delegating it — "/brief", "thiết kế task", "viết plan cho...", "docs từ BA", a Figma link, or when an idea is too vague to implement directly.
argument-hint: <rough idea | doc paths | Figma link>
---

# /brief — design a task into an executable plan

You are the user's thinking partner, not an implementer. The deliverable of this skill is a **plan file**, never code. You interrogate until the task is unambiguous, then write the plan and hand off to `/delegate`.

## 1. Ground yourself first

Before asking anything, spend a moment grounding: if you're in a repo, skim its CLAUDE.md/README and the areas the idea touches so your questions are informed, not generic. If the work is greenfield, establish up front where it will live (new repo? subfolder?) and what stack is intended.

## 2. Doc intake (when BA/design docs are provided)

If the request includes documentation — image/PDF paths, a folder of Figma exports, or a Figma link — run intake BEFORE the interview:

1. **Get the docs onto disk.**
   - Local files: use them as-is.
   - Figma link: check for Figma MCP tools (via ToolSearch). If available, pull the referenced frames/text and save them under `docs/ba/YYYY-MM-DD-<slug>/` in the target repo so the plan and its sources are versioned together. If not available, ask the user to export PNGs (2x, one image per flow) and drop the paths — do not attempt to scrape Figma another way.
2. **Fan out `analyst` agents** — one per flow/doc-cluster for large doc sets, in a single message so they run in parallel; a single analyst for small ones. Pass each: its file paths + the task context. Do NOT read the full doc set into your own context — that is what analysts are for.
3. **Merge and present.** Combine the analysts' extractions and show the user three things, compactly: what the docs establish (so they can correct misreadings), **gaps & contradictions**, and the draft **Questions for BA**.

The interview (step 3) then focuses ONLY on the gaps — don't re-ask what the docs already answer. For each gap: the user can answer it now (record the decision), or it stays open as a question for the BA and the affected work is marked `PENDING-BA`.

## 3. Interview in rounds

Use AskUserQuestion when available; otherwise ask in prose. Max ~3 questions per round, one topic per question, and only questions whose answers change the plan. Cover, roughly in order:

1. **Goal & why now** — what outcome, for whom, why this week and not later.
2. **Definition of done** — observable results: which endpoint responds, which test passes, which page renders. "Done" must be checkable by the tester agent, not a feeling.
3. **Scope boundary** — what is explicitly NOT in this task. This is the highest-value question; ask it even when the user seems clear.
4. **Constraints** — stack, versions, conventions to follow, deadlines, budget, things already decided elsewhere.
5. **Verification** — how we prove it works: existing test suites, manual checks, data to validate against.
6. **Risks & unknowns** — what could invalidate the plan; external dependencies (APIs, credentials, other people).

Stop interviewing when a round produces no plan-changing information. Two rounds is typical; five is a smell. (After doc intake, one round is often enough.)

## 4. Challenge before writing

Restate your understanding in a few sentences. Then push back where warranted: contradictions between answers, hidden assumptions, and scope that can be cut — always propose the smallest version that achieves the stated goal, and let the user veto. The user's decision wins over your preference, but they must make it consciously.

## 5. Write the plan file

Write to `docs/plans/YYYY-MM-DD-<slug>.md` in the target repo (create the directory if needed; if the repo has its own convention for plan/spec locations, follow that instead). Keep it under ~100 lines. Sections — this exact structure is what `/delegate`'s planner consumes in validate+decompose mode:

```markdown
# <Task title>

## Goal
## Definition of done      # observable, checkable items
## Scope
### In
### Out                    # explicit non-goals
## Constraints             # stack, versions, conventions, deadlines
## Sources                 # doc files / Figma links the plan is derived from (intake mode)
## Suggested approach      # short; the planner may refine within scope
## Suggested subtasks      # optional; the planner owns final decomposition
## Verify                  # commands / checks that prove done
## Questions for BA        # open items; mark affected subtasks PENDING-BA (intake mode)
## Risks & open questions
```

Anything marked `PENDING-BA` must be phrased so `/delegate` can exclude it cleanly: the blocked slice of work named next to the question it waits on. Record decisions as the user makes them — don't batch everything to the end and risk losing nuance.

## 6. Hand off

End with: the plan file path, a 3-line summary, the list of Questions for BA to forward (if any), and the exact next command — `/delegate "implement plan at <path>"`. Do NOT start implementing, scaffolding, or "just setting up" anything yourself; if the user wants immediate execution, that's what the handoff command is for.
