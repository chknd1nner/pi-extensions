---
task_number: 7
title: Wire Up `delegate_check` Tool
status: needs-fix
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Rework Task 7 failure-path stats retention for `delegate_check`.

  Remaining review finding:
  1. The new failure-path snapshotting is not actually reliable for unexpected worker exits. In `extensions/delegate/index.ts`, `onExit()` marks the worker failed and then calls `cacheSessionStats(entry, rpcClient, 500)`, but by that point the RPC subprocess has already exited. `RPCClient.send()` is a no-op when stdin is no longer writable (`extensions/delegate/rpc-client.ts`), so the `get_session_stats` request cannot be delivered and failed workers still fall back to zero stats unless a prior running-state check happened to cache them.
  2. Add a regression test that covers the failed-worker path and proves the intended retained-stats behavior, or adjust the implementation/design handling explicitly if failed workers cannot guarantee final stats.

  Files to revisit:
  - `extensions/delegate/index.ts`
  - `extensions/delegate/rpc-client.ts` (for failure-path behavior awareness)
  - `extensions/delegate/tests/index.delegate-check.test.ts`

  Verification to rerun after fixes:
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx vitest run tests/index.delegate-check.test.ts`
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx vitest run`
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx tsc --noEmit`

  Then move the ticket back to `review`.
review_prompt_template: |-
  Review Task 7: Wire Up `delegate_check` Tool

  Perform a TWO-STAGE REVIEW:

  ## Stage 1: Spec Review
  Compare implementation against the design spec.
  - Read the spec_path document (if provided)
  - Check: Does implementation match spec intent?
  - Check: Any divergences from spec requirements?
  - Check: Missing spec requirements?

  If MAJOR spec issues found, you may terminate review early.
  If minor spec divergences, note them and continue to Stage 2.

  ## Stage 2: Code Review
  Use the superpowers:requesting-code-review skill approach.
  - Get git diff for this task's changes
  - Check code quality, architecture, testing
  - Categorize issues: Critical / Important / Minor

  ## Review Output

  ### Spec Compliance
  [Matches spec / Minor divergences / Major divergences]
  [List any divergences with spec section references]

  ### Code Quality
  [Strengths and issues per code-reviewer format]

  ### Verdict
  If task passes BOTH stages:
  - Move ticket to done status (ticket_move task-07 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-07 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
---

# Task 07 — Wire Up `delegate_check` Tool

## Plan excerpt

**Files:**
- Modify: `extensions/delegate/index.ts`

- [x] **Step 1: Add `delegate_check` registration after `delegate_start` in `index.ts`**

Add the following tool registration inside the `delegate` function, after the `delegate_start` registration:

```typescript
  pi.registerTool({
    name: "delegate_check",
    label: "Delegate Check",
    description: "Query the progress of a running or completed worker.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
      detail: Type.Optional(
        StringEnum(["summary", "full"] as const, { description: "Level of detail (default: summary)" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        return {
          content: [{ type: "text" as const, text: `Unknown task ID: ${params.task_id}` }],
          details: {},
          isError: true,
        };
      }

      const progressSummary = entry.progress!.getSummary();
      const elapsed = Math.round((Date.now() - entry.startedAt) / 1000);

      let tokenInfo = { input: 0, output: 0, contextPercent: 0 };
      if (entry.rpcClient && entry.status === "running") {
        const resp = await entry.rpcClient.sendAndWait({ type: "get_session_stats" });
        if (resp && (resp as any).success && (resp as any).data) {
          const data = (resp as any).data;
          const tokens = data.tokens ?? {};
          const ctxUsage = data.contextUsage ?? {};
          tokenInfo = {
            input: tokens.input ?? 0,
            output: tokens.output ?? 0,
            contextPercent: ctxUsage.percent ?? 0,
          };
        }
      }

      const summary: Record<string, unknown> = {
        status: entry.status,
        elapsed_seconds: elapsed,
        tool_calls: progressSummary.tool_calls,
        last_activity_seconds_ago: progressSummary.last_activity_seconds_ago,
        recent_activity: progressSummary.recent_activity,
        input_tokens: tokenInfo.input,
        output_tokens: tokenInfo.output,
        context_usage_percent: tokenInfo.contextPercent,
      };

      if (entry.error) {
        summary.error = entry.error;
      }

      let text = Object.entries(summary)
        .map(([k, v]) => {
          if (Array.isArray(v)) return `${k}:\n${v.map((item) => `  - ${item}`).join("\n")}`;
          return `${k}: ${v}`;
        })
        .join("\n");

      if (params.detail === "full") {
        text += `\n\ntranscript:\n${progressSummary.transcript}`;
      }

      return {
        content: [{ type: "text" as const, text }],
        details: summary,
      };
    },
  });
```

- [x] **Step 2: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 3: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): add delegate_check tool for worker progress monitoring"
```

---


---

## Notes

- Implemented review fixes for Task 7 in the implementation worktree:
  - `extensions/delegate/index.ts`
    - `delegate_check` now throws `Error` for unknown `task_id` (Pi-supported tool-error path).
    - Added shared session-stats parsing/fetch helpers.
    - `delegate_check` now reuses cached `sessionStats` for terminal workers and refreshes/cache-updates stats while running.
    - On `agent_end`, worker stats are snapshotted before stdin is closed so terminal checks retain token/context usage.
  - `extensions/delegate/worker-manager.ts`
    - Added `sessionStats` to `WorkerEntry`.
  - `extensions/delegate/types.ts`
    - Added `SessionStatsSnapshot` type.
  - Tests:
    - Updated `extensions/delegate/tests/index.delegate-start.test.ts` to assert unknown task IDs reject by throw.
    - Added `extensions/delegate/tests/index.delegate-check.test.ts` covering cached terminal stats in `delegate_check`.

- Verification (2026-05-03):
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx vitest run` ✅ (6 files, 34 tests passed)
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx tsc --noEmit` ✅
- Re-review findings (2026-05-03):
  - Unknown-task handling is fixed: `delegate_check` now throws, and the registration test asserts rejection.
  - Cached terminal stats are only snapshotted in the `agent_end` completion path, so `failed` and `aborted` workers can still report zero token/context stats when no earlier running-state check cached them.
  - `extensions/delegate/tests/index.delegate-check.test.ts` covers only the completed terminal state, so the non-completed terminal-state gap remains untested.

- Needs-fix implementation (2026-05-03):
  - `extensions/delegate/index.ts`
    - Added `cacheSessionStats()` and made session-stats fetching tolerant to RPC errors/timeouts.
    - Cached final stats not only on `agent_end` (`completed`) but also in timeout (`aborted`) and failure paths (`onError`/`onExit`).
    - `delegate_check` now attempts a terminal-state stats fetch when no cached snapshot exists, then reuses cached values.
  - `extensions/delegate/tests/index.delegate-check.test.ts`
    - Kept completed-worker cached-stats coverage.
    - Added timed-out worker coverage to ensure non-completed terminal workers retain token/context stats.

- Verification (needs-fix rerun, 2026-05-03):
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx vitest run tests/index.delegate-check.test.ts` ✅ (2 tests passed; red→green cycle for timeout retention)
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx vitest run` ✅ (6 files, 35 tests passed)
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx tsc --noEmit` ✅
- Re-review findings (2026-05-03, second re-review):
  - Completed and timeout-aborted paths are improved, but the unexpected-exit failure path is still not reliable. `extensions/delegate/index.ts` calls `cacheSessionStats()` from `onExit()` after the RPC subprocess has already exited, and `extensions/delegate/rpc-client.ts` drops sends when stdin is no longer writable, so the `get_session_stats` request cannot actually be delivered in that case.
  - `extensions/delegate/tests/index.delegate-check.test.ts` still does not prove retained stats for a true failed-worker path.
- Conference concerns / open questions (2026-05-03):
  - There appears to be a design/mechanism mismatch: the spec expects `delegate_check` to report token/context stats for terminal states, but the current mechanism only knows how to fetch those stats from a *live* RPC worker via `get_session_stats`.
  - For `completed` and extension-driven `aborted` workers, we can snapshot stats before closing/killing the worker. For an unexpected `failed` exit, there may be no surviving transport left to query.
  - The current failed-path implementation is therefore probably not fixable by a small patch in `delegate_check` alone; it likely needs either a design clarification or a different data-capture strategy.
  - The current tests can give false confidence because the mocks allow `sendAndWait()` to succeed after the worker has notionally failed/exited. They do not model the real RPC limitation where `RPCClient.send()` becomes a no-op once stdin is no longer writable.
  - Questions for review/conference:
    - Should the spec explicitly allow missing/last-known stats for `failed` workers?
    - Should we proactively cache rolling session stats while the worker is still running, so `delegate_check` can fall back to the last known snapshot after crashes?
    - Is there another authoritative source for final usage (for example from streamed assistant/agent-end data) that would avoid a post-exit RPC fetch?
    - Do we want different guarantees for `completed` / `aborted` versus truly unexpected `failed` workers?
