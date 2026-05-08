# Delegate Status File + Watcher Design

**Date:** 2026-05-07  
**Status:** Approved  
**Extensions affected:** `extensions/delegate/`

---

## Overview

`delegate_start` currently writes a human-readable progress log to disk at:

- `.pi/delegate/<date>/<session>/<taskId>.progress.md`

That is useful for manual observation (`tail -f`) but awkward for lightweight automation. A watcher that needs to know when a worker reaches a terminal state has to either poll `delegate_check` from the orchestrator loop or parse the markdown log, neither of which is ideal.

This design adds a sibling machine-readable status file:

- `.pi/delegate/<date>/<session>/<taskId>.status`

The status file is a plain-text, single-purpose lifecycle artifact that records the worker's current state. It is designed for small polling scripts and background `process` watchers. The progress log remains unchanged and continues to serve human observability.

The status file is best-effort only. Delegate's in-memory worker state remains the source of truth for `delegate_check`, `delegate_abort`, and `delegate_result`. If status-file writes fail, worker orchestration must continue to work correctly.

---

## Goals

- Provide a stable, machine-readable file that external watcher scripts can poll.
- Preserve the existing append-only semantics of `*.progress.md`.
- Avoid coupling worker lifecycle state to markdown log structure.
- Make watcher templates simple enough to include in future prompt instructions.
- Support timeout fallback so orchestrators can recover if status-file writes fail.

## Non-Goals

- Replacing `delegate_check` as the authoritative status source.
- Embedding status in `progress.md` frontmatter or headers.
- Adding a streaming watcher tool or push-based notification channel.
- Introducing JSON status payloads at this stage.

---

## File Contract

For every worker that currently gets a progress log, create a sibling status file:

- `.../<taskId>.progress.md`
- `.../<taskId>.status`

Example:

- `.pi/delegate/2026-05-07/sess-abc/w1.progress.md`
- `.pi/delegate/2026-05-07/sess-abc/w1.status`

### Status File Contents

The file contains exactly one normalized status string plus a trailing newline:

- `running`
- `completed`
- `failed`
- `aborted`

Examples:

```text
running
```

```text
completed
```

### Write Semantics

Status writes must be atomic and ordered to avoid partial reads or stale regressions.

Implementation approach:

1. Ensure the parent directory exists.
2. Write the next status plus trailing newline to a temp file in the same directory.
3. Rename the temp file over `<taskId>.status`.
4. Use synchronous filesystem operations for `StatusFileWriter.writeStatus(...)` so an earlier `running` write cannot land after a later terminal write.

Unlike `progress.md`, the status file is not append-streamed. Atomic replace is therefore safe and preferred.

**Invariant:** status-file contents must never regress from a terminal state back to `running` because of delayed IO.

### Creation Timing

On the successful `delegate_start` path, perform all pre-launch setup first (including context snapshot/temp-file creation when requested). After pre-launch setup succeeds, write `running` immediately before the worker process is started. This ensures that a watcher launched immediately after `delegate_start` receives a stable file to observe while avoiding a stale `running` file for workers that fail before launch.

---

## API Surface Change

A successful `delegate_start` call should include the generated file paths in its returned `details` payload:

```json
{
  "task_id": "w1",
  "status": "running",
  "progress_file": "/.../w1.progress.md",
  "status_file": "/.../w1.status"
}
```

The human-facing text response can remain short, but the details object should expose both paths so watcher scripts do not need to reconstruct date/session directories.

Clarifications:

- `progress_file` is the append-only log path and may not exist yet until the first progress event is written.
- `status_file` is intended to exist immediately after a successful start, but watcher logic must still tolerate it being absent temporarily because status-file IO is best-effort.
- These new fields are additive and are present only on successful `delegate_start` responses. Existing thrown-error behavior is unchanged.

---

## Lifecycle Wiring

The status file is owned by worker lifecycle code in `extensions/delegate/index.ts`, not by the progress accumulator.

Reasoning:

- worker status transitions already happen in `index.ts`
- some terminal states occur outside the normal text stream
- the progress log and the status file have different semantics and failure modes

### New Helper

Add a small sibling writer to `extensions/delegate/visibility.ts`:

- `StatusFileWriter`
- constructs the same directory path shape as `ProgressLogWriter`
- exposes `writeStatus(status: WorkerStatus): void`
- exposes `getFilePath()`
- uses synchronous atomic temp-file + rename writes
- writes exactly `<status>\n`
- never throws to lifecycle code; after the first IO failure it becomes a no-op for the rest of the worker lifetime

`ProgressLogWriter` remains append-only and unchanged in role.

### Worker Entry + Transition Contract

The writer must be reachable from all lifecycle paths that can terminate a worker, not just the `delegate_start` closure.

Expected additions:

- `WorkerEntry.statusWriter?: StatusFileWriter`
- `WorkerManager.setStatus(...)` returns `boolean` indicating whether the transition was applied

**Rule:** terminal status-file writes must only happen when the corresponding in-memory status transition succeeds. Example:

```ts
if (manager.setStatus(taskId, "aborted", "Timed out after 600s")) {
  entry.statusWriter?.writeStatus("aborted");
}
```

This prevents a later `agent_end` callback from overwriting a prior `aborted` or `failed` terminal state on disk.

### Required Status Updates

Write the status file at these points:

1. **After worker registration and after all pre-launch setup succeeds, but before `rpcClient.start()`**  
   Write `running`.

2. **If session snapshot/temp-file setup fails before launch**  
   Attempt the in-memory transition to `failed`; only if that transition applies, best-effort write `failed`.

3. **If `rpcClient.start()` or initial `send()` throws**  
   Attempt the in-memory transition to `failed`; only if that transition applies, best-effort write `failed`.

4. **On `agent_end` while the worker is still `running`**  
   Inspect the final assistant message in `event.messages`, if present:
   - `stopReason === "aborted"` → transition/write `aborted`
   - `stopReason === "error"` → transition/write `failed`
   - otherwise → transition/write `completed`

   If the worker is already terminal in memory, do not change the status file.

5. **On unexpected process termination after RPC stdout has been fully drained, while still `running`**  
   Attempt the in-memory transition to `failed`; only if that transition applies, best-effort write `failed`.

6. **On `onError` while still `running`**  
   Attempt the in-memory transition to `failed`; only if that transition applies, best-effort write `failed`.

7. **On timeout**  
   Attempt the in-memory transition to `aborted`; only if that transition applies, best-effort write `aborted`, then abort/kill the worker.

8. **On manual `delegate_abort`**  
   Attempt the in-memory transition to `aborted`; only if that transition applies, best-effort write `aborted`, then abort/kill the worker.

9. **On `session_shutdown` / `disposeAll()`**  
   For every worker still `running`, attempt the in-memory transition to `aborted` with an orchestrator-shutdown reason; only if that transition applies, best-effort write `aborted`, clear timeout state, then kill/close the worker.

### Exit Ordering Requirement

Unexpected-exit classification must happen only after the worker's RPC stdout has been fully drained. Otherwise a fast process exit can race with buffered `agent_end` delivery and incorrectly classify a completed worker as `failed`.

The implementation may satisfy this by using child-process `close` instead of `exit`, or any equivalent mechanism that guarantees stream-drain-before-classification.

### Failure Policy

Status-file IO failures must be best-effort only:

- do not fail a worker solely because status-file writing broke
- once the status writer fails, suppress future status-write attempts for that worker
- continue relying on in-memory worker state for all delegate tools

This mirrors the existing progress-log philosophy: disk visibility is important, but it must not become a runtime dependency.

---

## Why Not Put Status in `progress.md`

This design explicitly rejects embedding lifecycle state inside the markdown log header.

The worst edge case is an inode split caused by header rewrites:

- a status update rewrites or atomically replaces `w1.progress.md`
- the append file descriptor used for text deltas can remain attached to the old inode
- a watcher reads the new file while the worker keeps appending to the old, now-unlinked file
- the log appears frozen forever from the watcher's perspective

Additional problems:

- append-streamed transcript writes race with header rewrites
- tailing the log does not naturally surface top-of-file status changes
- early-start and pre-text failures create ambiguous file states
- machine readers become coupled to markdown structure instead of a tiny explicit contract

Separate files avoid these issues cleanly.

---

## Suggested Watcher Contract

The status file is an optimization, not the source of truth. A watcher should therefore:

1. poll the returned `status_file`
2. exit immediately on `completed`, `failed`, or `aborted`
3. enforce a hard timeout (default: 600 seconds)
4. emit a machine-searchable sentinel line on either terminal-state observation or timeout
5. let the orchestrator reconcile ambiguous cases with `delegate_check(task_id)` after timeout

### Sentinel Output

Normal observed completion:

- `DELEGATE_WATCH_DONE w1 completed`
- `DELEGATE_WATCH_DONE w1 failed`
- `DELEGATE_WATCH_DONE w1 aborted`

Timeout fallback:

- `DELEGATE_WATCH_TIMEOUT w1 last=running`
- `DELEGATE_WATCH_TIMEOUT w1 last=unknown`

### Exit Codes

- exit `0` when a terminal status is observed in the file
- exit `124` on timeout

This works well with `process` alerts:

- `alertOnSuccess: true` for terminal observation
- `alertOnFailure: true` for timeout fallback

---

## Suggested Watch Loop Template

The recommended shell loop must avoid `&&` command chaining. Past experiments showed chained expressions could leave stale reads or skip expected control flow, making the loop fail to exit even after the worker finished.

Run the template with **Bash**.

Known-good template:

```bash
status_file="/absolute/path/to/w1.status"
task_id="w1"
timeout_seconds=600
poll_seconds=3
last_status="unknown"
start_seconds=$SECONDS

while true; do
  if [[ -f "$status_file" ]]; then
    status=""
    if read -r status < "$status_file"; then
      case "$status" in
        completed|failed|aborted)
          echo "DELEGATE_WATCH_DONE $task_id $status"
          exit 0
          ;;
        running)
          last_status="$status"
          ;;
        *)
          if [[ -n "$status" ]]; then
            last_status="$status"
          fi
          ;;
      esac
    fi
  fi

  elapsed=$((SECONDS - start_seconds))
  if (( elapsed >= timeout_seconds )); then
    echo "DELEGATE_WATCH_TIMEOUT $task_id last=$last_status"
    exit 124
  fi

  sleep "$poll_seconds"
done
```

### Orchestrator Follow-Up Rule

If the watcher exits with timeout or prints `DELEGATE_WATCH_TIMEOUT ...`, the orchestrator must call `delegate_check(task_id)` before making any decision.

Interpretation:

- if `delegate_check` reports `completed` / `failed` / `aborted`, proceed from authoritative in-memory state
- if `delegate_check` still reports `running`, choose whether to continue waiting, steer, or abort

A watcher timeout means only that file-based observation was inconclusive. It does **not** prove the worker failed.

---

## Implementation Notes

### Files Expected to Change

- `extensions/delegate/visibility.ts`
  - add `StatusFileWriter`
- `extensions/delegate/index.ts`
  - instantiate/store the writer
  - write initial `running`
  - gate terminal file writes on successful in-memory transitions
  - update terminal-state writes at all lifecycle transitions
  - return `progress_file` and `status_file` from `delegate_start`
- `extensions/delegate/worker-manager.ts`
  - return transition success from `setStatus(...)`
  - mark running workers `aborted` during shutdown disposal
- `extensions/delegate/rpc-client.ts`
  - ensure unexpected-exit classification happens after stdout drain (`close` or equivalent)
- `extensions/delegate/tests/visibility.test.ts`
  - add tests for atomic status writes and file paths
- `extensions/delegate/tests/index.delegate-start.test.ts`
  - assert returned details expose `status_file` and `progress_file`
- `extensions/delegate/tests/...`
  - update/add lifecycle tests covering failed, completed, aborted transitions, shutdown disposal, and non-regressing terminal status writes

### Backwards Compatibility

- existing progress-log behaviour remains intact
- delegate tool semantics remain unchanged
- new `details.progress_file` and `details.status_file` fields are additive on successful `delegate_start` responses only

---

## Open Questions

None. The design intentionally keeps the file format minimal and defers richer structured status payloads unless a future integration requires them.
