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
├── docs/superpowers/specs/<spec>   ──Read──► (same files, frozen at branch point)
├── docs/superpowers/plans/<plan>   ──Read──►
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

**How the snapshot actually works (constraint):** `delegate_anchor` + `buildSessionSnapshot` serialize the **entire session branch from root → anchor entry** — not a curated file set. Whatever is in the session before the anchor lands in every worker's inherited prefix. Therefore prefix cleanliness is achieved by *controlling what happens before the anchor*, not by selecting files.

**Establishing the anchor — the FIRST actions in a fresh session:**

The run **must** begin with `/new` (a clean session) and the orchestration kickoff message. Then, **before any other tool call** (no worktree setup, no bash, no sharding):

1. `Read` the **entire** spec document. `Read` truncates at ~2000 lines / 50KB, so continue with `offset`/`limit` until EOF. Verify the final read returned the end of file.
2. `Read` the **entire** plan document, same EOF-continuation discipline. (The reference plan is 1601 lines / >50KB — it truncates on a single read.) An incomplete prefix silently *causes* the very re-reading v2 exists to eliminate.
3. `delegate_anchor({ name: "plan-foundation" })` — bookmarks the current leaf. The prefix is now exactly `[system prompt][kickoff message][full spec reads][full plan reads]`.
4. **Only now** perform worktree setup, `ticket_shard`, and all other orchestration — it happens *after* the anchor and never enters the shared prefix.

If setup noise accidentally precedes the anchor, recover with `session_entries()` to find the entry id immediately after the plan reads and anchor retroactively via `delegate_anchor({ name: "plan-foundation", entry_id })`. (A future delegate enhancement could build a synthetic spec/plan-only snapshot, removing the ordering constraint entirely — see §11.)

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
review_failures: 0       # per-ticket counter for the escalation circuit-breaker (§7)
task_base_sha: ""        # HEAD recorded before the implementer runs (§5 diff boundary)
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

These now live as inspectable markdown templates in the skill (see §8). `next_prompt` survives as a **generic, orchestrator-written** field used to persist reviewer fix instructions across loops for crash/restart durability. `review_failures` and `task_base_sha` are new frontmatter fields driving §7 and §5 respectively.

**New ticket operations required (scoped minimal set):** the current API only exposes generic `ticket_set` (frontmatter write) and `ticket_next` (reads `next_prompt` only). The orchestrator needs to *read back* arbitrary fields (`review_failures`, `task_base_sha`) to drive the loop, so add:
- `ticket_get(ticket, field)` — read a single frontmatter field.

That is sufficient: `review_failures` is incremented via read-modify-write (`ticket_get` → +1 → `ticket_set`); `task_base_sha` is written once via `ticket_set` and read via `ticket_get`. Durable findings go in `next_prompt` (already supported). The `## Notes` body stays **human-facing/optional** — no body-append tool is added unless a later need justifies it.

**Carried-forward v1 findings:**
- Workers cannot reach `in-progress/` from the worktree cwd — resolved structurally: workers never use ticket tools (none in their allowlist).
- `ticket_show` truncates multiline fields — largely moot now (prompts no longer live in tickets), but `ticket_next` remaining the canonical reader of `next_prompt` is still useful for fix-loop handoff.

---

## 3. Model configuration (`models.json`)

Bundled beside `SKILL.md`:

```json
{
  "implementer": { "provider": "<provider>", "model": "<model-id>", "thinking": "low" },
  "reviewer":    { "provider": "<provider>", "model": "<model-id>", "thinking": "medium" },
  "fixer":       { "provider": "<provider>", "model": "<model-id>", "thinking": "low" }
}
```

The keys `provider` / `model` / `thinking` map **directly** onto `delegate_start`'s parameters (no renaming at dispatch). Resolution at run start: **runtime args → `models.json` defaults**. Each role's `(provider, model)` is then **locked for the run** (§1 cache rule). Implementer, reviewer, and fixer are independently configurable; the user may override any subset at invocation ("implement X using opus for review"); unspecified roles fall back to config.

**Validation (fail fast at run start, before any worker spawns):** every role used by the run must resolve to a non-empty `provider` and `model`. Missing/empty config with no runtime override → halt and ask the user. Unknown extra keys are ignored.

---

## 4. Run setup (once, before the loop)

Order matters — the anchor must be established **before** any noisy setup (§1).

1. Start from `/new`; the kickoff message names the plan + spec.
2. **Anchor first:** `Read` the full spec (to EOF), `Read` the full plan (to EOF), then `delegate_anchor({ name: "plan-foundation" })`. Nothing else may precede this.
3. Confirm the plan has `### Task N:` sections.
4. `using-git-worktrees` → create `.worktrees/<branch>` on a new feature branch; run project setup; verify a clean test baseline. Record worktree path + branch name (injected into every worker prompt).
5. `ticket_shard(plan_path, spec_path)` → tickets in `in-progress/ready/`.
6. Resolve and validate role models (§3).

---

## 5. Orchestration loop (strictly sequential, one in-flight worker)

For each ticket in `ready` (ascending task number):

1. `ticket_move task-NN active`. Record the diff boundary: `task_base_sha = git rev-parse HEAD` (in the worktree) and persist it via `ticket_set task-NN task_base_sha <sha>`.
2. Assemble **implementer prompt** = skill implementer template + ticket `## Plan excerpt` + env block (worktree path, branch, "do not create branches/worktrees; make all changes in the worktree; do not touch `in-progress/`") + the commit requirement: **the implementer must create exactly one task commit when done** (the basis for the per-ticket diff boundary).
3. `delegate_start({ task, cwd: worktree, inherit_context: "plan-foundation", provider/model: implementer, thinking, tools: [read, edit, write, bash] })`.
4. **Wait (non-blocking)** — launch the wait-script via `process` (§6). Orchestrator is now free to chat / investigate / pre-draft, but **must not advance the pipeline** until the completion alert fires.
5. On alert → `delegate_result` → parse `STATUS:` footer.
   - `BLOCKED` / `NEEDS_CONTEXT` → `ticket_move blocked`; **stop and escalate to user** with the worker's report.
   - `DONE` / `DONE_WITH_CONCERNS` → optionally note concerns (see *Notes* below); proceed to the commit-boundary gate.
5a. **Commit-boundary gate (mandatory before review).** Verify in the worktree that the implementer actually committed: `git rev-parse HEAD` must differ from `task_base_sha`, **and** `git status --porcelain` must be empty (clean tree). If `HEAD` did not advance or the tree is dirty, the task commit is missing/partial — `git diff <task_base_sha>..HEAD` would miss uncommitted work. Treat as incomplete: re-dispatch (implementer/fixer) with an explicit "commit your work" instruction, or escalate. Do **not** proceed to review until this gate passes.
6. `ticket_move review`. Assemble **combined reviewer prompt** (skill reviewer template + env block + the per-ticket diff command `git diff <task_base_sha>..HEAD` and `git log <task_base_sha>..HEAD`, so the reviewer sees **only this ticket's changes**, never cumulative branch history); `delegate_start` with reviewer model, **read-only tools `[read, bash]`**, `inherit_context: "plan-foundation"`. Wait via §6.
7. `delegate_result` → parse `VERDICT:`.
   - `PASS` → `ticket_move done`; optionally record verification evidence (see *Notes* below); next ticket.
   - `FAIL` → write the reviewer's fix instructions to `next_prompt`; increment `review_failures` (`ticket_get` → +1 → `ticket_set`); go to §7.

***Notes* (optional, human-facing).** The `## Notes` body is for human readability only. The orchestrator may append to it via a **direct file edit** of the ticket markdown (it has `edit`/`write` and knows the ticket path) — no `ticket_*` body-append tool is added. **Durable, loop-critical state never lives in Notes**: it lives in frontmatter (`review_failures`, `task_base_sha`) and `next_prompt`, which survive crashes and are read back via `ticket_get`/`ticket_next`.

**Per-ticket diff boundary (inherited from subagent-driven-development / requesting-code-review):** the implementer commits exactly one task commit; reviewers and fixers operate on `git diff <task_base_sha>..HEAD`. A fixer that *amends* must update nothing else; a fixer that *adds* a fix commit keeps the base SHA fixed so the range still captures the whole task. This prevents reviewing cumulative history and conflating prior tasks with the current one.

**Concurrency:** at most one worker in flight. Side work while waiting ≠ pipeline parallelism.

---

## 6. Non-blocking wait (background process)

Status files are **best-effort** (per `2026-05-07-delegate-status-file-design.md`); the watcher is a convenience trigger, **`delegate_check` is authoritative**. `delegate_start` returns a `status_file` path the delegate extension updates (`running` → `completed`/`failed`/`aborted`).

The skill encapsulates a wait-script template with a **hard timeout** and explicit sentinels:

```bash
# args: <status_file> <timeout_seconds>
deadline=$(( $(date +%s) + ${2:-1800} ))
while :; do
  s=$(cat "$1" 2>/dev/null)
  case "$s" in
    completed|failed|aborted) echo "DELEGATE_WATCH_DONE status=$s"; exit 0 ;;
  esac
  [ "$(date +%s)" -ge "$deadline" ] && { echo "DELEGATE_WATCH_TIMEOUT"; exit 1; }
  sleep 5
done
```

Launch via `process({ action: "start", command: "bash wait.sh <status_file> <timeout>", alertOnSuccess: true, alertOnFailure: true, logWatches: [{ pattern: "DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT" }] })`.

**Reconciliation rule (mandatory):** on *any* alert — success, failure, or timeout — the orchestrator calls `delegate_check` to obtain the **authoritative** status before acting. It never trusts the status-file value alone. On `DELEGATE_WATCH_TIMEOUT` with a still-`running` worker, the orchestrator decides whether to keep waiting (relaunch watcher), `delegate_steer`, or `delegate_abort`.

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
    → /new + Read FULL spec + plan (to EOF) → delegate_anchor("plan-foundation")   [anchor FIRST]
      → using-git-worktrees (feature branch + worktree)
        → ticket_shard
          → delegate-driven-development (v2)   ← THIS SKILL
            → finishing-a-development-branch
```

(Ordering is load-bearing: the anchor must precede worktree setup so setup noise never enters the inherited prefix — see §1/§4.)

`delegate-driven-development` v2 slots in where `subagent-driven-development` sits in the generic superpowers flow.

---

## 11. Open questions / risks

1. **Cache-payoff validation.** The shared-prefix bet should be measured against v1's minimal-capsule approach on a real plan (tokens billed, cache-hit rate). If spec+plan are small, capsules may win; this workflow's observed re-reading suggests the prefix wins here.
2. **Anchor-leaf precision.** Because the snapshot captures the whole branch root→anchor (§1), the anchor must land exactly after the full spec/plan reads and before any setup noise. The `/new` + anchor-first ordering (§4) enforces this; `session_entries()` + explicit `entry_id` is the recovery path. Validate that no hidden pre-anchor entries (e.g. tool preambles) leak into the prefix.
3. **System-prompt stability.** Verify that the worker system prompt (incl. tool definitions) is byte-stable across same-role workers — any per-run variation silently breaks the cache.
4. **`models.json` discovery.** Confirm the skill can resolve its bundled config path reliably at both dev (symlinked) and installed locations.
5. **Status-file race.** The watcher polls (not a one-shot read) and `delegate_check` reconciles every alert (§6), so a transition between script start and first poll is caught on the next poll or by reconciliation. Confirm in practice.
6. **`delegate_wait` (future).** A first-class blocking/await primitive in the delegate extension could replace the wait-script entirely; deferred.
7. **Synthetic spec/plan-only snapshot (future).** A delegate option to build an inherited prefix from explicit content (not the live branch) would remove the §1/§4 ordering constraint and make prefix cleanliness robust to orchestrator missteps.
