# Delegate-Driven Development Skill — Design (v2)

**Date:** 2026-05-31
**Status:** Draft
**Skill location:** `~/.pi/agent/skills/delegate-driven-development/` (dev source in `skills/delegate-driven-development/`, symlinked)
**Supersedes:** `docs/superpowers/specs/2026-05-04-delegate-driven-development-design.md`

---

## Why v2

The 2026-05-04 design shipped its core ideas (orchestrator-driven control, tickets-as-data, worktree isolation, sequential dispatch, structured worker output). In practice it exposed three problems, all of which v2 addresses:

1. **Token waste from repeated document reads.** Workers were observed re-reading *both* the spec and the plan file on **every** dispatch. With many tasks this is large, repeated, avoidable cost. v1 deliberately gave each worker a "minimal isolated capsule" with **no session history** — which forced workers to re-read source docs to orient.
2. **Busy-poll monitoring.** v1 prescribed `delegate_check` every 60–90s. The background-process plugin now makes non-blocking, alert-driven waiting strictly better.
3. **No model-stability guarantees, no escalation logic.** v1 inherited a model-selection table but had no rule to keep a role's model stable (required for prompt-cache reuse) and no circuit-breaker for repeated review failures.

Two enabling capabilities landed since v1 and make v2 possible:

- **Delegate context inheritance** (`delegate_anchor`, `inherit_context`, `session_entries`, `buildSessionSnapshot`) — lets the orchestrator establish a shared, cacheable session prefix that workers inherit.
- **The background-process plugin** (`process` tool with `logWatches` / `alertOnSuccess`) — lets the orchestrator wait for worker completion without polling, staying free to do other work.

### The central reversal

v1: each worker gets `next_prompt` + env context only — *"No plan file, no sibling ticket context, no session history."*

**v2: workers inherit a shared, immutable, cached prefix containing the spec + plan**, established once by the orchestrator via `delegate_anchor`. The first worker of each role pays to process that prefix; every subsequent same-role worker hits the prompt cache instead of re-reading the documents.

This is a deliberate bet: it pays off precisely because the spec and plan are (a) large, (b) read by every worker, and (c) immutable for the duration of the run. The observed re-reading behaviour confirms the bet is worth making for this workflow.

---

## Architecture overview

Three deliverables:

1. **`delegate-driven-development` skill (v2)** — the orchestration workflow, worker-prompt templates, the anchor/cache protocol, and the non-blocking wait pattern.
2. **`tickets` extension refactor** — `ticket_shard` produces pure-data tickets; all worker-driven workflow text is removed from the extension and moved into the skill.
3. **A bundled `models.json`** — per-role model defaults, beside `SKILL.md`.

### Topology

```
Main checkout (orchestrator cwd)              Worktree (.worktrees/<branch>, feature branch)
├── docs/superpowers/{spec,plan}  ──Read──►   (same files, frozen at branch point)
├── in-progress/  ◄── orchestrator owns       ├── extensions/...  ◄── workers edit + commit here
│   (gitignored scratch = source of truth)    └── (no live tickets; gitignored, not checked out)
└── delegate_anchor / ticket_* / process      cwd passed to every delegate_start
```

- Orchestrator runs in the **main checkout**; sole reader/writer of `in-progress/` ticket state (gitignored scratch).
- One worktree + one feature branch, created up-front via `using-git-worktrees`.
- Every `delegate_start` sets `cwd: <worktree-path>`; all edits/commits land on the feature branch.
- Workers never touch `in-progress/`; tickets aren't source of truth there and aren't even checked out.
- Feature-branch diff stays pure code; `finishing-a-development-branch` merges with zero ticket churn.

---

## 1. Cache / anchor strategy (the core of v2)

**Prefix contents:** spec + plan, and nothing else.

- Code files are **excluded** — they mutate every task, which would both poison the cache (prefix bytes change) and feed workers stale code.
- `AGENTS.md` is **excluded** — Pi's prompt constructor already injects it via the system prompt; duplicating it is wasteful.

**Establishing the anchor (run setup, before the dispatch loop):**

1. Orchestrator `Read`s the spec document (from the main checkout).
2. Orchestrator `Read`s the plan document.
3. Orchestrator calls `delegate_anchor({ name: "plan-foundation" })`, which bookmarks the current session leaf — i.e. the entry immediately after both reads. `buildSessionSnapshot` serializes the branch root→anchor into each worker's inherited session.
4. `ticket_shard` and all subsequent orchestration noise happen **after** the anchor, so they never enter the shared prefix.

**Inheriting the anchor:** every `delegate_start` passes `inherit_context: "plan-foundation"`. Each worker's session is `[system prompt][shared spec+plan prefix][role + task suffix]`.

**Cache correctness rule (non-negotiable):** prompt cache is keyed per `(provider, model, identical-prefix-bytes, identical-system-prompt)`. Therefore:

- The model for each role is **locked for the entire run**. The first implementer processes the full prefix; subsequent implementers hit cache. Same for reviewers, same for fixers.
- A role's **system prompt and tool scope must be stable** across that role's workers (they precede the inherited messages in the cache key).
- The **only** sanctioned model switch mid-run is escalating a *repeatedly failing* task to a stronger model — a deliberate, rare cache sacrifice (see §7).

**Cross-role sharing** is a bonus only when two roles happen to share a model; it is not required. The guaranteed win is intra-role reuse.

---

## 2. Tickets-as-data refactor

`ticket_shard` stops baking worker-driven workflow blobs into frontmatter. Each ticket becomes:

```
---
task_number: N
title: "<title>"
status: ready
plan_path: <path>
spec_path: <path>
next_prompt: ""          # generic, orchestrator-written (fix-loop durability)
review_failures: 0       # per-ticket counter for the escalation circuit-breaker
---
# Task NN — <title>

## Plan excerpt
<verbatim task section from the plan>

## Notes
<!-- orchestrator/reviewer findings, verification evidence -->
```

Removed from the extension:
- The `implPrompt` text (the "implement, then `ticket_move` yourself to review, copy `review_prompt_template` into `next_prompt`" instructions).
- The `review_prompt_template` blob (the two-stage review instructions).

These now live as inspectable markdown templates in the skill (see §8). `next_prompt` survives as a **generic, orchestrator-written** field used to persist reviewer fix instructions across loops for crash/restart durability. `review_failures` is a new integer field driving §7.

**Carried-forward v1 findings:**
- Workers cannot reach `in-progress/` from the worktree cwd — resolved structurally: workers never use ticket tools (none in their allowlist).
- `ticket_show` truncates multiline fields — largely moot now (prompts no longer live in tickets), but `ticket_next` remaining the canonical reader of `next_prompt` is still useful for fix-loop handoff.

---

## 3. Model configuration (`models.json`)

Bundled beside `SKILL.md`:

```json
{
  "implementer": { "provider": "<provider>", "modelId": "<id>", "thinking": "low" },
  "reviewer":    { "provider": "<provider>", "modelId": "<id>", "thinking": "medium" },
  "fixer":       { "provider": "<provider>", "modelId": "<id>", "thinking": "low" }
}
```

Resolution at run start: **runtime args → `models.json` defaults**. Each role's `(provider, modelId)` is then **locked for the run** (§1 cache rule). Implementer, reviewer, and fixer are independently configurable. The user may override any subset at invocation time ("implement X using opus for review"); unspecified roles fall back to config.

---

## 4. Run setup (once, before the loop)

1. Confirm a plan exists with `### Task N:` sections; confirm the spec path.
2. `using-git-worktrees` → create `.worktrees/<branch>` on a new feature branch; run project setup; verify clean test baseline. Record worktree path + branch name (injected into every worker prompt).
3. `Read` spec, `Read` plan → `delegate_anchor({ name: "plan-foundation" })`.
4. `ticket_shard(plan_path, spec_path)` → tickets in `in-progress/ready/`.
5. Resolve role models (§3).

---

## 5. Orchestration loop (strictly sequential, one in-flight worker)

For each ticket in `ready` (ascending task number):

1. `ticket_move task-NN active`.
2. Assemble **implementer prompt** = skill implementer template + ticket `## Plan excerpt` + env block (worktree path, branch, "do not create branches/worktrees; make all changes in the worktree; do not touch `in-progress/`").
3. `delegate_start({ task, cwd: worktree, inherit_context: "plan-foundation", provider/model: implementer, thinking, tools: [read, edit, write, bash] })`.
4. **Wait (non-blocking)** — launch the wait-script via `process` (§6). Orchestrator is now free to chat / investigate / pre-draft, but **must not advance the pipeline** until the completion alert fires.
5. On alert → `delegate_result` → parse `STATUS:` footer.
   - `BLOCKED` / `NEEDS_CONTEXT` → `ticket_move blocked`; **stop and escalate to user** with the worker's report.
   - `DONE` / `DONE_WITH_CONCERNS` → record concerns in `## Notes`; proceed.
6. `ticket_move review`. Assemble **combined reviewer prompt** (skill reviewer template + env block); `delegate_start` with reviewer model, **read-only tools `[read, bash]`**, `inherit_context: "plan-foundation"`. Wait via §6.
7. `delegate_result` → parse `VERDICT:`.
   - `PASS` → `ticket_move done`; write verification evidence to `## Notes`; next ticket.
   - `FAIL` → write the reviewer's fix instructions to `next_prompt`; `review_failures += 1`; go to §7.

**Concurrency:** at most one worker in flight. Side work while waiting ≠ pipeline parallelism.

---

## 6. Non-blocking wait (background process)

The skill encapsulates a small wait-script template. `delegate_start` returns a `status_file` path that the delegate extension keeps current (`running` → `completed`/`failed`/`aborted`).

- Launch via `process({ action: "start", command: <poll status_file until terminal>, alertOnSuccess: true, logWatches: [{ pattern: "completed|failed|aborted" }] })`.
- The harness hands the orchestrator a turn the moment the watcher fires; the orchestrator then reads `delegate_result`.
- **Permitted while waiting:** respond to the user, run investigations, pre-draft the next prompt.
- **Forbidden while waiting:** spawning the next pipeline stage, moving the in-flight ticket, editing worktree code.

---

## 7. Review model, fix loop, and escalation circuit-breaker

**Reviewer:** single worker, two stages internally, with early exit.
- Stage 1 — spec compliance vs the design spec. A **major** divergence → terminate early, `VERDICT: FAIL` (skip Stage 2). Minor divergences → note and continue.
- Stage 2 — code quality on the diff (`git diff`/`git log` in the worktree).
- Returns a combined verdict via `delegate_result`.

**Fix loop** uses a **fresh fixer worker** each time (stateless workers; continuity lives in the orchestrator + ticket):
- Fixer inherits the same `plan-foundation` anchor + the reviewer's findings (read from `next_prompt`) + instruction to amend the diff, then re-enters review (§5.6).

**Escalation by `review_failures`:**
- **1** → routine fixer run.
- **2** → the **orchestrator itself investigates root cause** (it is the strong model). It must decide:
  - *Fundamental spec/design flaw* → **stop and escalate to user** with findings.
  - *Otherwise* (one more fix will plausibly resolve) → dispatch fixer run #2 (optionally escalate fixer model — a deliberate cache sacrifice).
- **3** → **always escalate to user**.

---

## 8. Worker roles, permissions, reporting

| Role | Tools | Notes |
|---|---|---|
| Implementer / Fixer | `read`, `edit`, `write`, `bash` | No `ticket_*`, no `delegate_*` (auto-denied). Prompt forbids touching `in-progress/`. |
| Reviewer | `read`, `bash` | Strictly read-only — cannot "fix". |

**Reporting contract** (machine-parseable footer read via `delegate_result`):

```
# implementer / fixer
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
<summary; for NEEDS_CONTEXT/BLOCKED include what is needed / the blocker>

# reviewer
VERDICT: PASS | FAIL
### Spec Compliance
<findings>
### Code Quality
<findings; omitted if early-exit on major spec divergence>
### Fix Instructions   ← required if FAIL
<specific, actionable instructions the orchestrator writes to next_prompt>
```

**Prompt templates** live as inspectable markdown in the skill (separates content from logic; visible in diffs):

```
skills/delegate-driven-development/
├── SKILL.md
├── models.json
└── references/
    ├── implementer-prompt.md
    ├── reviewer-prompt.md
    └── fixer-prompt.md
```

---

## 9. Completion

After all tickets are `done`:
- Optional whole-implementation reviewer pass over the full feature-branch diff.
- `finishing-a-development-branch` → verify tests, present merge/PR/cleanup options, execute choice.

---

## 10. Skill boundaries & relationship to existing skills

This skill covers the **orchestration loop only**. Out of scope (delegated to other skills/tools):

- Spec writing → `brainstorming`
- Plan writing → `writing-plans`
- Sharding → `ticket_shard`
- Worktree setup → `using-git-worktrees`
- Merge/cleanup → `finishing-a-development-branch`

```
brainstorming
  → writing-plans
    → using-git-worktrees (feature branch + worktree)
      → Read spec + plan → delegate_anchor("plan-foundation")
        → ticket_shard
          → delegate-driven-development (v2)   ← THIS SKILL
            → finishing-a-development-branch
```

`delegate-driven-development` v2 slots in where `subagent-driven-development` sits in the generic superpowers flow.

---

## 11. Open questions / risks

1. **Cache-payoff validation.** The shared-prefix bet should be measured against v1's minimal-capsule approach on a real plan (tokens billed, cache-hit rate). If spec+plan are small, capsules may win; this workflow's observed re-reading suggests the prefix wins here.
2. **Anchor-leaf precision.** The anchor must land exactly after the two `Read`s and before any sharding noise. If the orchestrator interleaves other tool calls, use `session_entries()` + explicit `entry_id` to anchor retroactively at the correct entry.
3. **System-prompt stability.** Verify that the worker system prompt (incl. tool definitions) is byte-stable across same-role workers — any per-run variation silently breaks the cache.
4. **`models.json` discovery.** Confirm the skill can resolve its bundled config path reliably at both dev (symlinked) and installed locations.
5. **Status-file race.** Confirm the wait-script reliably observes the terminal status write (no missed transition if the worker finishes between script start and first poll).
6. **`delegate_wait` (future).** A first-class blocking/await primitive in the delegate extension could replace the wait-script entirely; deferred.
```
