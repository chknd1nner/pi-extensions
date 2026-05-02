# Ticket System for Plan Execution

This document describes a deterministic system for sharding Superpowers implementation plans into individual task "tickets" that can be tracked through a workflow.

## Overview

The ticket system converts an implementation plan into individual ticket files, each representing a single task. Tickets move through workflow statuses like a Kanban board, with each status having a corresponding folder: ready → active → review → done.

## Components

### Scripts

- **`scripts/shard-plan.sh`** — Shard a plan into tickets
- **`scripts/ticket.sh`** — Manage ticket workflow operations

### Directory Structure

Tickets physically move between folders as their status changes (like Kanban lanes):

```
in-progress/
├── ready/       # Sharded tickets awaiting work
├── active/      # Currently being implemented  
├── review/      # Awaiting code review
├── needs-fix/   # Requires corrections
├── blocked/     # Blocked on external dependency
├── done/        # Completed
└── archive/     # Historical reference
```

## Sharding a Plan

```bash
# Shard a plan into tickets
./scripts/shard-plan.sh docs/superpowers/plans/YYYY-MM-DD-feature.md [spec.md] [--dry-run]

# Example
./scripts/shard-plan.sh \
  docs/superpowers/plans/2026-04-30-familyos-telegram.md \
  docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
```

This creates one ticket file per `### Task N:` section in the plan, placed in `in-progress/ready/`.

### What Gets Extracted

For each task section, the sharding script:

1. **Parses the task heading** — `### Task N: Title`
2. **Extracts content** — Everything between this heading and the next
3. **Generates filename** — `task-NN-slugified-title.md`
4. **Creates frontmatter** — Standard fields for workflow tracking
5. **Wraps content** — In `## Plan excerpt` section
6. **Adds notes section** — Empty `## Notes` for runtime notes

### Ticket Format

```yaml
---
task_number: 1
title: "Task title from heading"
status: ready
plan_path: path/to/plan.md
spec_path: path/to/spec.md  # optional
next_prompt: |-
  Instructions for the next agent working on this ticket
review_prompt_template: |-
  Template for code review prompts
---

# Task 01 — Title

## Plan excerpt

[Original task content from plan]

---

## Notes

<!-- Verification results, issues, and runtime notes go here -->
```

The `status` field matches the folder the ticket resides in.

## Ticket Workflow

### Statuses

| Status | Folder | Description |
|--------|--------|-------------|
| ready | `ready/` | Awaiting work |
| active | `active/` | Currently being implemented |
| review | `review/` | Awaiting code review |
| needs-fix | `needs-fix/` | Requires corrections |
| blocked | `blocked/` | Blocked on external |
| done | `done/` | Completed |

### Tools (via π extension)

```
ticket_list              # List all tickets by status
ticket_list active       # List tickets with specific status
ticket_show task-01      # Show ticket details
ticket_move task-01 active   # Move ticket (updates status + folder)
ticket_set task-01 field value   # Set frontmatter field
ticket_next task-01      # Get next_prompt for handoff
```

### Typical Workflow

1. **Start work** — Move ticket to active:
   ```
   ticket_move task-01 active
   ```

2. **Execute steps** — Follow the plan excerpt, checking off steps

3. **Request review** — Move ticket to review:
   ```
   ticket_move task-01 review
   ```

4. **Two-stage review process:**
   - **Stage 1: Spec Review** — Does implementation match the design spec?
   - **Stage 2: Code Review** — Is the code quality good?
   
   The reviewer uses `superpowers:requesting-code-review` skill approach.

5. **Handle outcome:**
   - **Approved** → `ticket_move task-01 done` with `approval_note`
   - **Needs changes** → `ticket_move task-01 needs-fix` with updated `next_prompt`

## The `next_prompt` Field

The `next_prompt` frontmatter field contains instructions for the next agent working on the ticket. This enables asynchronous handoffs between agents.

### Initial Implementation Prompt

When a ticket is created, `next_prompt` contains implementation instructions:

```yaml
next_prompt: |-
  Implement Task 1: Title
  
  Read the Plan excerpt section below and execute each step in order.
  Check off steps as you complete them (- [x]).
  Run verification commands and confirm they pass.
  Commit when all steps are complete.
  
  When done:
  - Move ticket to review status (ticket_move task-01 review)
  - Update next_prompt to the review_prompt_template value
  - The reviewer will perform spec + code review
```

### After Implementation

The implementing agent updates `next_prompt` to trigger review:

```
ticket_set task-01 next_prompt "Review Task 1 implementation.

Git diff shows the changes.
Run: cd services/foo && npm test
Expected: All tests pass

If approved: ticket_move task-01 done
If changes needed: ticket_move task-01 needs-fix"
### After Review (Needs Fix)

If review finds issues, `next_prompt` contains fix instructions:

```yaml
next_prompt: |-
  Fix Task 1: Address review feedback
  
  Issues found:
  - Missing error handling in parseConfig()
  - Test coverage incomplete for edge case X
  
  Fix these issues, then: ticket_move task-01 review
```

## Under the Hood

The extension uses `mdedit` internally for structured markdown operations. You can also use mdedit directly if needed:

```bash
mdedit outline in-progress/ready/task-01.md      # Show structure
mdedit frontmatter show in-progress/ready/task-01.md   # Show frontmatter
mdedit frontmatter get in-progress/ready/task-01.md next_prompt   # Get field
mdedit frontmatter set in-progress/ready/task-01.md status review  # Set field
mdedit append in-progress/ready/task-01.md "Notes" --content "Verified"  # Append
```

## Two-Stage Review Process

Every ticket review includes both spec and code review to catch divergences early:

### Stage 1: Spec Review

Compare implementation against the design spec document:
- Does implementation match spec intent?
- Any divergences from spec requirements?
- Missing spec requirements?

If **major spec issues** are found, the reviewer may terminate early.
If **minor divergences**, note them and continue to Stage 2.

### Stage 2: Code Review

Use the `superpowers:requesting-code-review` skill approach:
- Get git diff for task changes
- Check code quality, architecture, testing
- Categorize issues: Critical / Important / Minor

### Review Output Format

```markdown
### Spec Compliance
[Matches spec / Minor divergences / Major divergences]
- Divergence 1: [spec section] vs [implementation]
- Divergence 2: ...

### Code Quality
#### Strengths
- ...

#### Issues
**Critical:** ...
**Important:** ...
**Minor:** ...

### Verdict
[Ready to merge / With fixes / Major rework needed]
```

### Why Two Stages?

Code review alone isn't sufficient. Implementation can be:
- ✅ Perfect code quality
- ✅ Adheres to implementation plan
- ✅ Tests pass
- ❌ Diverges from design spec

The spec review catches this early, per-task, rather than discovering divergences only at final integration.

## Integration with Superpowers

This ticket system integrates with the Superpowers workflow:

1. **brainstorming** skill produces a spec
2. **writing-plans** skill produces a plan
3. **shard-plan.sh** converts plan to tickets
4. **subagent-driven-development** or **executing-plans** work through tickets
5. **requesting-code-review** triggers review workflow
6. **verification-before-completion** ensures work is verified before done

### Starting Execution

After sharding, you can:

1. **Manual execution** — Work through tickets sequentially
2. **Subagent dispatch** — Dispatch agents per ticket with `next_prompt`
3. **Batch execution** — Use executing-plans skill with ticket tracking

## Best Practices

1. **One ticket at a time** — Keep at most one ticket in `active/`
2. **Update next_prompt** — Always set clear instructions for handoffs
3. **Use Notes section** — Document verification results, issues, decisions
4. **Frequent commits** — Commit after each logical step
5. **Verify before done** — Run all verification commands before marking done
