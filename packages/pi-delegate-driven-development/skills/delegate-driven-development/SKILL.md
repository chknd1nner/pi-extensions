---
name: delegate-driven-development
description: Use when executing an implementation plan end-to-end via delegated workers — orchestrates implementer → two-stage reviewer → fixer per ticket with a cached spec+plan prefix and non-blocking waits. Slots where subagent-driven-development would, but uses delegate_start workers instead of in-session subagents.
---

# Delegate-Driven Development (v2)

**Announce at start:** "I'm using the delegate-driven-development skill to orchestrate this plan."

You are the **orchestrator**. You own all ticket state and the pipeline. Workers are
stateless functions you dispatch via `delegate_start`; they report a structured footer
and you decide every transition. Design spec:
`docs/superpowers/specs/2026-05-31-delegate-driven-development-v2-design.md`.

## Core idea — cache the spec+plan prefix
`delegate_pack` freezes the spec + plan into an on-disk context pack
(`.pi/delegate/<date>/packs/<name>.jsonl`); every worker dispatched with
`context_pack` receives it as an identical message prefix, independent of the
orchestrator's own session history. Role instructions ride in the system layer via
`system_prompt_file`. Each worker's token prefix is exactly:
`[base system prompt][role prompt][pack: spec+plan][task]` — the first worker of
each role pays to process everything before `[task]`; later same-role workers hit
cache.

**Cache correctness (non-negotiable):**
- Lock each role's `(provider, model)`, `system_prompt_file`, and tool scope for
  the whole run ("pick and stick"). The only sanctioned mid-run model switch is
  escalating a repeatedly failing task (see Escalation).
- Role template files are re-read at every spawn — do not edit them mid-run.
- Never put per-ticket detail in the pack or a role prompt. Per-ticket values go
  only in the `task` argument (the uncached tail).
- Never recompile the pack mid-run (`overwrite: true` starts a new cold prefix).
  After an orchestrator restart mid-run, reuse the existing pack by name
  (`context_pack` resolves newest-date-first) — do not recompile.

(`delegate_anchor` + `inherit_context` still exist for inheriting live *session*
context into a worker and compose with `context_pack` — anchor content first, pack
appended — but this skill's pipeline does not need them.)

## Run setup
1. The kickoff message names the plan + spec paths. (A fresh session is NOT
   required — packs are independent of orchestrator session history.)
2. `delegate_pack({ name: "plan-foundation", files: [<spec path>, <plan path>] })`.
   Do NOT read the full spec/plan into your own context first — workers get them
   from the pack; read targeted sections on demand if orchestration requires it.
   If the pack already exists from an interrupted run, reuse it as-is.
3. Confirm the plan has `### Task N:` sections.
4. `using-git-worktrees` → create `.worktrees/<branch>` on a new feature branch; run
   project setup; verify a clean test baseline. Record the worktree path + branch name.
5. `ticket_shard(plan_path, spec_path)` → tickets land in `in-progress/ready/`.
6. Resolve role models: runtime args → `models.json` (beside this file). **Validate**
   every used role has non-empty `provider` and `model`; if not, halt and ask the user.
7. Record the absolute path of this skill's `references/` directory — role prompts
   are passed from there via `system_prompt_file`.

## Orchestration loop (sequential — one worker in flight)
**Keep dispatches lean.** Pass each role's prompt via `system_prompt_file` — the
absolute path to this skill's `references/<role>-prompt.md` (implementer-prompt.md,
reviewer-prompt.md, fixer-prompt.md). The extension reads the file at spawn time, so
template bodies never enter your transcript. The `task` argument carries ONLY
per-task data: the ticket's plan excerpt, worktree path, branch, task base SHA, and
(for fixers) fix instructions. Never inline template bodies into `task`.

For each ticket in `ready`, ascending task number:

1. `ticket_move task-NN active`. Record the diff boundary:
   `task_base_sha = git -C <worktree> rev-parse HEAD`; persist with
   `ticket_set task-NN task_base_sha <sha>`.
2. Build the implementer task message: the ticket's `## Plan excerpt`, the worktree
   path, and the branch name.
3. `delegate_start({ task, cwd: <worktree>, context_pack: "plan-foundation",
   system_prompt_file: "<skill references dir>/implementer-prompt.md",
   provider/model: implementer, thinking, tools: ["read","edit","write","bash"] })`.
4. **Wait (non-blocking):** launch `skills/delegate-driven-development/references/wait.sh <status_file> <timeout>` via the
   `process` tool with `alertOnSuccess: true`, `alertOnFailure: true`, and
   `logWatches: [{ pattern: "DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT" }]`. While
   waiting you MAY chat / investigate / pre-draft, but MUST NOT advance the pipeline,
   move the in-flight ticket, or edit worktree code.
5. On alert → `delegate_check` (authoritative) → `delegate_result`; parse `STATUS:`.
   - `BLOCKED` / `NEEDS_CONTEXT` → `ticket_move blocked`; stop and escalate to the user.
   - `DONE` / `DONE_WITH_CONCERNS` → proceed to the commit-boundary gate.
6. **Commit-boundary gate (mandatory before EVERY review and re-review).** In the
   worktree, require `git rev-parse HEAD` ≠ `task_base_sha` AND `git status --porcelain`
   empty. If HEAD didn't advance or the tree is dirty, the task commit is missing —
   re-dispatch with an explicit "commit your work" instruction, or escalate. Do not
   review until this passes.
7. `ticket_move review`. Build the reviewer task message: the ticket's
   `## Plan excerpt`, the worktree path, and `task_base_sha`. `delegate_start` with
   the reviewer model, READ-ONLY tools `["read","bash"]`,
   `context_pack: "plan-foundation"`, and
   `system_prompt_file: "<skill references dir>/reviewer-prompt.md"`. Wait via the
   same non-blocking pattern.
8. On alert → `delegate_check` → `delegate_result`; parse `VERDICT:`.
   - `PASS` → `ticket_move done`; next ticket.
   - `FAIL` → write the reviewer's Fix Instructions to `next_prompt`
     (`ticket_set task-NN next_prompt <…>`); increment `review_failures`
     (`ticket_get` → +1 → `ticket_set`); go to Escalation.

## Escalation circuit-breaker (by `review_failures`)
- **1** → routine fixer run: build the fixer task message from the ticket's
  `## Plan excerpt`, the fix instructions (read from `next_prompt`), the worktree
  path, and the branch. `delegate_start` with the fixer model, tools
  `["read","edit","write","bash"]`, `context_pack: "plan-foundation"`, and
  `system_prompt_file: "<skill references dir>/fixer-prompt.md"`.
  After it reports, re-run the commit-boundary gate (step 6), then re-enter review (step 7).
- **2** → YOU (the strong orchestrator) investigate the root cause. If it is a
  fundamental spec/design flaw → stop and escalate to the user with findings. Otherwise
  dispatch fixer run #2 (optionally escalate the fixer model — a deliberate cache sacrifice).
- **3** → always stop and escalate to the user.

## Non-blocking wait details
Status files are best-effort; the watcher is only a trigger — `delegate_check` is
authoritative. On `DELEGATE_WATCH_TIMEOUT` with a still-`running` worker, decide whether
to relaunch the watcher, `delegate_steer`, or `delegate_abort`. Get the `status_file`
path from the `delegate_start` result details (or `delegate_check`).

## Worker roles & tools
| Role | Tools |
|---|---|
| Implementer / Fixer | `read`, `edit`, `write`, `bash` |
| Reviewer | `read`, `bash` (strictly read-only) |
Workers never get `ticket_*` or `delegate_*` and must never touch `in-progress/`.

## Project-scope extensions/skills do not load inside workers
Worker subagents boot a fresh `pi` process whose cwd is the worktree. `.pi/` is
gitignored and `pi` does not walk upward to find `.pi/settings.json`, so project-scope
extensions and skills do not load inside workers — only stock pi tools and user-global
packages from `~/.pi/agent/settings.json` are available. Worker procedures in this
skill are intentionally self-contained: TDD/review/fix steps are inlined in the
templates and allowlists are stock-only. To require a project extension or skill
inside a worker, install it under `~/.pi/agent/extensions/<name>` (or via `npm:`/`git:`
in `~/.pi/agent/settings.json`) first.

## Completion
When all tickets are `done`: optionally run a whole-implementation reviewer pass over
the full feature-branch diff, then hand off to `finishing-a-development-branch` to
verify tests and present merge/PR/cleanup options.

## Out of scope (other skills/tools)
spec writing → `brainstorming`; plan writing → `writing-plans`; sharding → `ticket_shard`;
worktree setup → `using-git-worktrees`; merge/cleanup → `finishing-a-development-branch`.
