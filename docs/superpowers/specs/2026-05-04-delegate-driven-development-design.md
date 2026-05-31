# Delegate-Driven Development Skill — Design

**Date:** 2026-05-04  
**Status:** Superseded by [`2026-05-31-delegate-driven-development-v2-design.md`](2026-05-31-delegate-driven-development-v2-design.md)  
**Location:** `~/.pi/agent/skills/delegate-driven-development/SKILL.md`

> **Superseded.** v2 reverses this design's central "minimal capsule / no session history" decision in favour of a shared, cached spec+plan prefix (`delegate_anchor` + `inherit_context`), replaces `delegate_check` polling with non-blocking background-process waits, and adds `models.json` (locked-per-run for cache correctness) plus a review-failure escalation circuit-breaker. Retained here as historical record.

---

## Overview

Two tightly coupled deliverables:

1. **`delegate-driven-development` skill** — A Pi-native skill that supersedes `subagent-driven-development` for the ticket-based, delegate-powered workflow. Acts as an explicit override layer: only the sections that conflict with the ticket system and delegate tools are replaced; everything else — two-stage review, model selection, review loops, final code review — inherits unchanged.

2. **Ticket system improvements** — Changes to `extensions/tickets/index.ts` and the prompt templates it generates, required to make the ticket system work correctly with the delegate orchestration model.

---

## What Changes vs. subagent-driven-development

| subagent-driven-development | This skill replaces with |
|---|---|
| Read plan file, extract all tasks, create TodoWrite | `ticket_list` to find ready tickets; `ticket_next` to get task context |
| Provide full plan text to each subagent | Pass `ticket_next` output as the worker's task prompt |
| "Dispatch a subagent" (abstract) | `delegate_start` with assembled prompt, worktree `cwd`, appropriate model |
| Mark task complete in TodoWrite | `ticket_move` for all state transitions |
| Human manages session branching for review phase | Orchestrator autonomously dispatches reviewer worker |

## What Is Inherited Unchanged

- Two-stage review structure (spec compliance first, then code quality)
- Model selection by role and task complexity
- Sequential task execution (no parallel implementers)
- Review loop (needs-fix → fix worker → re-review)
- Final code review after all tasks complete
- `using-git-worktrees` for worktree setup
- `finishing-a-development-branch` at completion

---

## New Sections

### 1. Prerequisites

Before the dispatch loop begins:

- Worktree and feature branch already set up via `using-git-worktrees`
- Tickets already sharded via `ticket_shard` (plan → per-task ticket files)
- Tickets directory is gitignored (ticket state is orchestrator-only, not committed)
- Orchestrator holds two pieces of environmental context it will inject into every worker prompt:
  - Worktree absolute path
  - Feature branch name

### 2. Prompt Assembly

Each worker's task is assembled from two parts:

**Part 1 — Task context (from ticket):**  
`ticket_next` returns the ticket's `next_prompt` — a pre-sharded, minimum-viable context capsule for exactly one unit of work. This is passed verbatim as the core of the worker's task.

**Part 2 — Environmental context (injected by orchestrator):**
```
Worktree: <absolute path>
Branch: <feature branch name>
Do not create new branches or worktrees.
All file changes must be made in the worktree above.
```

The assembled task = Part 1 + Part 2. Nothing else. No plan file, no sibling ticket context, no session history.

**Tool constraints:**  
Delegate tools (`delegate_*`) are always denied to workers automatically by the extension. No additional tool configuration is required unless a specific worker role warrants it (e.g., a read-only reviewer could be restricted further, but this is not required by default).

**Worker `cwd`:**  
Always set to the implementation worktree path for both implementers and reviewers. Implementers need it to commit code to the feature branch; reviewers need it to read implementation files and run tests. Neither should operate from the orchestrator's main checkout.

### 3. Dispatch Loop

```
For each ticket in ready:

  1. ticket_move → active
  2. ticket_next → get implementer prompt
  3. Assemble full worker prompt (next_prompt + env context)
  4. delegate_start (implementer role, worktree cwd, model per complexity)
  5. Monitor until complete (see Monitoring section)
  6. delegate_result → read worker output
  7. ticket_show → check actual ticket state (source of truth)

  If ticket is in review:
    8. ticket_next → get reviewer prompt
    9. Assemble reviewer prompt (next_prompt + env context)
    10. delegate_start (reviewer role, capable model)
    11. Monitor until complete
    12. delegate_result → read reviewer output
    13. ticket_show → check ticket state

    If ticket is in done:
      → Proceed to next ready ticket

    If ticket is in needs-fix:
      14. ticket_next → get fix instructions
      15. Assemble fix worker prompt
      16. delegate_start (implementer role)
      17. Monitor, result, check state
      18. Loop back to step 8 (re-review)

  If ticket is still active after worker completed:
    → Worker did not follow instructions. Read worker output.
      Determine if partially complete. Move ticket state manually.
      Re-dispatch or escalate to user.
```

Ticket state is the communication channel between roles. The orchestrator does not parse worker prose to determine pass/fail — it reads ticket state.

**Worker concurrency:**  
The delegate extension enforces a 2-worker ceiling. The sequential dispatch loop stays within this naturally: at most one implementer and one reviewer are active simultaneously, at task boundaries. Never dispatch two implementers in parallel — tasks have sequential dependencies and will conflict.

### 4. Monitoring

**When to check:**  
Call `delegate_check` approximately every 60–90 seconds for long-running tasks. Do not poll obsessively — each check adds overhead and noise.

**What to look for:**

| Signal | Meaning |
|---|---|
| `status: completed` | Worker finished — call `delegate_result` |
| `status: failed` | Worker process died — check error, decide whether to retry |
| `status: aborted` | Timed out or manually aborted |
| `last_activity_seconds_ago > 120` | Worker may be stuck |
| `recent_activity` shows repeated tool calls | Worker may be in a loop |
| `context_usage_percent > 80` | Worker approaching context limit |

**When to steer (`delegate_steer`):**
- Worker silent for >2 minutes and still running
- Worker appears stuck in a tool loop (same tool called repeatedly with no progress)
- Worker is visibly going off-scope (touching wrong files, wrong branch)

Steering messages should be minimal and directive. State the observation and redirect: *"You've been running tests in a loop. Stop, assess what's failing, and fix the root cause."*

**When NOT to steer:**
- Worker is making visible progress (healthy recent activity)
- Worker is simply slow (compilation, tests, file reads all take time)
- You are impatient — do not micro-manage

**When to abort:**
- `status: failed` and retry is not warranted
- `context_usage_percent > 90` and task is not complete — abort, move ticket to needs-fix, start a fresh worker with a narrowed scope
- Worker is clearly going in the wrong direction and steering has not helped after one attempt

### 5. Model Selection

Inherit from `subagent-driven-development` with these role defaults:

| Role | Default |
|---|---|
| Implementer — simple task (1–2 files, clear spec) | Cheap/fast model |
| Implementer — integration task (multi-file, judgment needed) | Standard model |
| Reviewer | Most capable available model |
| Fix worker | Same as implementer, or one tier up if previous attempt failed |

---

## Ticket System Changes

The existing ticket system has four issues that must be fixed for the delegate workflow.

### Problem 1: Workers can't reach ticket files from the worktree

The ticket extension resolves all paths relative to `ctx.cwd`. Workers are dispatched with `cwd` set to the implementation worktree. Ticket files live in the main checkout's `in-progress/` directory. When a worker calls any ticket tool it looks for `<worktree>/in-progress/` which doesn't exist.

**Resolution:** Workers do not manage ticket state. The orchestrator is the sole reader and writer of ticket state. Ticket tools are not needed by workers and should not be included in their tool allowlist.

### Problem 2: Prompt templates instruct workers to manage ticket state

The current `implPrompt` ends with instructions to call `ticket_move` and update `next_prompt`. The `reviewPrompt` ends with instructions to call `ticket_move` and write fix instructions into `next_prompt`. Both must change.

**Resolution:** Worker prompts are rewritten (see Prompt Files below). Workers produce structured output only. The orchestrator reads `delegate_result` and drives all state transitions.

**Implementer output format:**
```
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

[Summary of what was implemented and verified]

[If DONE_WITH_CONCERNS: description of concerns]
[If NEEDS_CONTEXT: what information is needed]
[If BLOCKED: blocker description and suggested resolution]
```

**Reviewer output format:**
```
VERDICT: PASS | FAIL

### Spec Compliance
[findings]

### Code Quality
[findings]

### Fix Instructions  ← required if VERDICT: FAIL
[Specific, actionable fix instructions the orchestrator will write to next_prompt]
```

The orchestrator reads STATUS/VERDICT from the first line of the worker's output and acts accordingly. No prose parsing required.

### Problem 3: `ticket_show` truncates multiline fields

The orchestrator needs to read `review_prompt_template` to dispatch the reviewer worker, but `ticket_show` returns `"(multiline)"` for any field with line breaks. The orchestrator cannot read the reviewer prompt.

**Resolution:** Extend `ticket_next` to accept an optional `field` parameter (default: `next_prompt`). The orchestrator calls `ticket_next(ticket, "review_prompt_template")` to retrieve the reviewer prompt. Alternatively, fix `ticket_show` to return full values — both changes are desirable.

### Problem 4: The `next_prompt` swap

Currently the implementer copies `review_prompt_template` into `next_prompt` before moving to review. In the delegate workflow the orchestrator does this — after reading the implementer's DONE status, it:
1. Calls `ticket_next(ticket, "review_prompt_template")` to get the reviewer prompt
2. Calls `ticket_set(ticket, "next_prompt", <reviewer_prompt>)` to update the field
3. Calls `ticket_move(ticket, "review")` to advance state

This preserves `ticket_next` as a uniform interface — it always returns the prompt for the current phase.

---

## Prompt Files

Prompt templates are extracted from TypeScript string literals into inspectable markdown files. This separates content from code, makes prompt changes visible in version control diffs, and allows independent iteration.

**Development location (version controlled in this repo):**
```
skills/delegate-driven-development/
├── SKILL.md
└── references/
    ├── implementer-prompt.md
    ├── reviewer-prompt.md
    └── fix-prompt.md
```

**Installed location (what Pi loads):**
```
~/.pi/agent/skills/delegate-driven-development/
├── SKILL.md
└── references/
    ├── implementer-prompt.md
    ├── reviewer-prompt.md
    └── fix-prompt.md
```

Installation is a symlink from the dev copy to the installed location, so edits in the project are immediately reflected without a separate copy step.

`ticket_shard` reads prompt files from the installed skill path at shard time. If the files are not found it falls back to built-in defaults so existing workflows are not broken.

The prompts themselves are updated to reflect the new structured output format (Problem 2 above) and to remove all ticket state management instructions.

---

## Git and Ticket Setup

**Branch structure:**  
- Orchestrator runs from `main` checkout  
- One feature branch created by `using-git-worktrees` in `.worktrees/<feature>`  
- All implementation commits go to the feature branch  

**Tickets:**  
- Gitignored — ticket state is filesystem-only, not committed  
- Sharded at plan time via `ticket_shard`  
- Orchestrator is the only agent that reads or writes ticket state  
- Workers never access ticket files directly — context is injected via assembled prompt  

---

## Skill Boundaries

This skill covers the orchestration loop only. It does not cover:

- **Brainstorming and spec writing** → `brainstorming` skill  
- **Writing implementation plans** → `writing-plans` skill  
- **Ticket sharding** → `ticket_shard` tool (run once on the plan before starting this skill)  
- **Worktree setup** → `using-git-worktrees` skill  
- **Branch completion and merge** → `finishing-a-development-branch` skill  

The ticket system changes are in scope for this deliverable and are prerequisites for the skill to function correctly.  

---

## Relationship to Existing Skills

```
brainstorming
  → writing-plans
    → ticket_shard (shard plan into tickets)
      → using-git-worktrees (set up feature branch + worktree)
        → delegate-driven-development  ← THIS SKILL
          → finishing-a-development-branch
```

`delegate-driven-development` slots in exactly where `subagent-driven-development` previously sat. Any project already using the superpowers workflow adopts this skill by loading it instead at the implementation phase.
