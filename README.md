# claude-myoffice

Personal command center for Claude Code — the "brain" holding the operating persona, role agents, and orchestration workflows, shared across **every repo** on the machine. Edit in one place, every project inherits.

## Install (once per machine)

```bash
git clone https://github.com/huyleresonancetech/claude-myoffice.git ~/claude-myoffice
~/claude-myoffice/setup.sh
```

The script only creates **symlinks** from `~/.claude/` back into the repo — it never overwrites existing config (foreign files are SKIPped and reported). Updating later is just `git pull`. Three things get linked:

| Source | Target | Role |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | The brain: operating persona + global rules, loaded in **every session, every repo** |
| `agents/*.md` | `~/.claude/agents/` | The role-agent team |
| `skills/*/` | `~/.claude/skills/` | The workflows (`/brief`, `/delegate`) |

## Usage

The full flow is two steps — design the task together, then hand it to the team:

```
/brief "Laravel backend for pawcast"
   → structured interview: goal, definition of done, scope In/Out, constraints, verify
   → outputs a plan file: docs/plans/2026-07-26-pawcast-backend.md

/delegate "implement plan at docs/plans/2026-07-26-pawcast-backend.md"
   → the pipeline executes that plan (planner only validates + decomposes, never re-plans)
```

If the task is already clear, delegate directly and skip `/brief`:

```
/delegate "add a new landing page segment, copy sourced from 01-segments/9-xxx.md"
```

### The /delegate pipeline

```
/delegate "<task | plan file>"
  ├─ Triage ── SIMPLE → do it directly, no orchestration (faster)
  ├─ [1] scout        parallel, read-only — understand the relevant code
  │        └─ greenfield → reads the plan + environment instead of code
  ├─ [2] planner      splits into independent subtasks, disjoint file ownership
  │        ├─ plan provided → validate + decompose, disagreements surfaced explicitly
  │        └─ COMPLEX → ⏸ present plan, wait for approval
  ├─ [3] implementer  N agents in parallel, one subtask each
  │        └─ greenfield → scaffold subtask runs sequentially BEFORE fan-out
  ├─ [4] reviewer ∥ tester   adversarial review + run build/lint/tests
  ├─ [5] fix loop     (max 3 rounds, checks are never weakened)
  └─ [6] deliver      report → commit → push
           └─ COMPLEX → ⏸ present diff, wait for approval before push
           └─ NEVER creates a PR without explicit confirmation
```

### Roles

| Agent | Model | Access | Job |
|---|---|---|---|
| `scout` | haiku | read-only | Codebase reconnaissance, returns a briefing |
| `planner` | inherit (strongest) | read-only | Plan + parallelizable subtask split, flags risk |
| `implementer` | sonnet | edit | Executes exactly 1 subtask, only in its assigned files |
| `reviewer` | inherit (strongest) | read-only | Hunts real defects in the diff, verdict APPROVE/NEEDS_FIXES |
| `tester` | sonnet | bash + write tests | Discovers and runs the repo's checks, verdict GREEN/RED |

The orchestrating brain is **not a separate agent** — the main session (the Claude you're chatting with) reads the SKILL.md and becomes the orchestrator. That's what lets the plan/diff approval gates talk to you directly, with no intermediary.

### Approval gates (when it stops to ask)

A task is treated as **COMPLEX** — plan approved before coding, diff approved before pushing — when it hits ≥1 criterion:

- meaningfully changes >3 files
- ambiguous requirements (two reasonable readings diverge)
- schema / public API / dependency changes
- hard-to-reverse operations: migrations, data deletion, production config, live tracking/payment IDs
- cross-cutting change (e.g. copy + tracking + data)

Hits none → runs straight through to push, report only.

## Repo layout

```
CLAUDE.md          # the brain: global persona + rules, symlinked → ~/.claude/CLAUDE.md
agents/            # one .md per role (frontmatter: model, tools + system prompt)
skills/brief/      # /brief — design a task with the user → plan file
skills/delegate/   # /delegate — orchestration playbook
setup.sh           # symlinks into ~/.claude/
```

## Extending

- **Add a role**: create `agents/<name>.md` (mirror the format of existing files), re-run `setup.sh`, and mention it in `skills/delegate/SKILL.md` if the pipeline should use it.
- **Add a workflow**: create `skills/<name>/SKILL.md`, re-run `setup.sh` → the `/<name>` command exists immediately.
- **Tune gates/models**: edit `skills/delegate/SKILL.md` directly (COMPLEX criteria) or the `model:` frontmatter in each agent.
- **Record new rules**: durable decisions go into `CLAUDE.md` (global) or the relevant skill, then commit.

## Locked design decisions (2026-07-26)

- Minimal instead of porting gstack: 5 roles + 2 skills reproduce the 3 core principles (specific roles, artifacts handed downstream, quality gates) — without adopting 23 skills.
- Symlink over copy: one source of truth, `git pull` is the whole update.
- Tiered models: cheap-fast for recon/test-running, strongest for plan/review — where mistakes are most expensive.
- SIMPLE tasks bypass the pipeline entirely: orchestration has overhead, only worth it when the task splits.
- Skill names describe the user's action (`/brief`, `/delegate`) rather than domain keywords (`/dev`, `/design`) — avoids collision/confusion with other skills.
- The brain = main session + global `CLAUDE.md`, NOT an orchestrator subagent — a subagent can't converse with the user directly, so approval gates would break, and context degrades through the middleman.
- Designing tasks with the user is a **skill** (main loop, conversational), not a subagent.
