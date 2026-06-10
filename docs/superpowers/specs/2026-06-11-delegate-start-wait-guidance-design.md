# Delegate Start Wait Guidance Design

**Date:** 2026-06-11  
**Status:** Approved  
**Package:** `packages/pi-delegate-driven-development`  
**Extension:** `extensions/delegate/`

## Overview

`delegate_start` already creates durable worker artifacts under `.pi/delegate/<date>/<session>/` and returns their absolute paths in the tool result details. However, its human-facing response still primarily tells agents to use `delegate_check` to monitor progress. In practice, that nudges agents into frequent polling, sometimes every few seconds, and makes it harder for them to discover the progress/status files.

The fix is to make `delegate_start` return a self-contained waiting recipe along with clearer artifact paths. The recipe should compose with whatever execution tools are available in the caller's environment: if an async/background command runner exists, the agent should use it; if not, the same wait command can run in a blocking shell. Blocking is less ideal than async waiting, but still better than repeatedly polling `delegate_check`.

## Goals

- Make the `.pi/delegate/...` artifact paths easy to find from the normal tool response.
- Reduce frequent `delegate_check` polling by teaching a status-file wait pattern at the point of worker creation.
- Avoid hard dependencies on third-party tools or skills.
- Provide structured, machine-readable wait metadata in `details` for capable agents.
- Keep `delegate_check` as the authoritative follow-up after the wait command emits a sentinel or times out.

## Non-Goals

- Adding a new blocking `delegate_wait` tool.
- Requiring any specific background process extension by name.
- Replacing `delegate_check` as the source of truth.
- Moving or changing the status/progress file contract.
- Depending on the delegate-driven-development skill's `wait.sh` file.

## User-Facing Behavior

A successful `delegate_start` result should include concise human text like:

```text
Worker w1 started.

Artifacts:
- progress: .pi/delegate/2026-06-11/<session>/w1.progress.md
- status: .pi/delegate/2026-06-11/<session>/w1.status

Recommended wait pattern:
- If an async/background command runner is available, run details.watch.command there and watch for: DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT.
- If no async/background runner is available, run the same command in a shell; it will block, but avoids frequent delegate_check polling.
- After any sentinel or timeout, call delegate_check("w1") once; delegate_check is authoritative.
```

The wording intentionally avoids naming optional tools such as `process`, while still being clear enough for models that have one in their prompt.

## Details Payload

Keep the existing absolute path fields for backwards compatibility and add relative paths plus a structured watch recipe:

```json
{
  "task_id": "w1",
  "status": "running",
  "progress_file": "/abs/project/.pi/delegate/2026-06-11/sess/w1.progress.md",
  "status_file": "/abs/project/.pi/delegate/2026-06-11/sess/w1.status",
  "progress_file_relative": ".pi/delegate/2026-06-11/sess/w1.progress.md",
  "status_file_relative": ".pi/delegate/2026-06-11/sess/w1.status",
  "watch": {
    "command": "...",
    "timeout_seconds": 1800,
    "poll_seconds": 5,
    "sentinel_pattern": "DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT",
    "preferred_mode": "async_background_if_available",
    "fallback_mode": "blocking_shell",
    "authoritative_followup": "delegate_check"
  }
}
```

Existing consumers that read `progress_file` and `status_file` continue to work. New consumers can use the relative path fields for compact display and the watch object for orchestration.

## Watch Command Contract

`details.watch.command` should be self-contained. It must not depend on the skill-local `wait.sh` script. It should:

1. Poll the returned status file.
2. Exit when it reads `completed`, `failed`, or `aborted`.
3. Enforce the worker timeout.
4. Emit a machine-searchable sentinel line exactly once.
5. Avoid proving final state by itself; the caller must use `delegate_check` afterward.

Sentinels:

```text
DELEGATE_WATCH_DONE task_id=w1 status=completed
DELEGATE_WATCH_DONE task_id=w1 status=failed
DELEGATE_WATCH_DONE task_id=w1 status=aborted
DELEGATE_WATCH_TIMEOUT task_id=w1 last=running
DELEGATE_WATCH_TIMEOUT task_id=w1 last=unknown
```

Recommended exit codes:

- `0` when a terminal status is observed.
- `124` on timeout.

## Prompt Guidance Update

Update `delegate_start` prompt guidance to discourage frequent polling:

- Use `delegate_start` to offload code review, implementation, and research tasks.
- `delegate_start` returns progress/status artifact paths and a self-contained status-file wait command in `details.watch.command`.
- Prefer running the wait command with an async/background command runner when one is available; otherwise run it in a blocking shell rather than polling frequently.
- After the wait command emits `DELEGATE_WATCH_DONE` or `DELEGATE_WATCH_TIMEOUT`, call `delegate_check` once for authoritative state, then `delegate_result` when terminal.
- Avoid tight polling loops around `delegate_check`; if polling is unavoidable, use a slow cadence.

## Error Handling

If relative path calculation fails for any unexpected reason, the tool should still return absolute paths and the worker should continue. The watch command can use the absolute `status_file`, so relative paths are display convenience only.

If status-file IO fails during worker execution, existing behavior remains: status files are best-effort, and `delegate_check` remains authoritative. A watch timeout should never be interpreted as worker failure without a follow-up `delegate_check`.

## Testing

Add or update unit tests for `delegate_start` to assert:

- Human text includes relative progress and status paths.
- Existing `progress_file` and `status_file` absolute detail fields remain present.
- New `progress_file_relative` and `status_file_relative` fields are present.
- `details.watch` includes command, timeout, poll interval, sentinel pattern, preferred/fallback mode, and authoritative follow-up.
- The watch command contains the status file path and emits the expected sentinel strings.
- Prompt guidance mentions the wait recipe and discourages frequent polling without naming optional third-party tools.

## Implementation Scope

Expected files:

- `packages/pi-delegate-driven-development/extensions/delegate/index.ts`
  - Build relative artifact paths.
  - Build self-contained watch command.
  - Update `delegate_start` result text and details.
  - Update `delegate_start` prompt guidance.
- `packages/pi-delegate-driven-development/extensions/delegate/tests/...`
  - Extend existing delegate-start tests or add a focused test file.
- `packages/pi-delegate-driven-development/README.md`
  - Optionally document the wait recipe at a high level.

## Acceptance Criteria

- A model receiving only the `delegate_start` result can find progress and status files without reconstructing `.pi/delegate` paths.
- A model with an async/background runner can start a non-blocking wait using `details.watch.command` and sentinel matching.
- A model without such a runner can still use the same command in a blocking shell.
- The result text makes clear that repeated tight `delegate_check` polling is not the intended monitoring pattern.
- No new required dependency on any optional tool, skill, or package is introduced.
