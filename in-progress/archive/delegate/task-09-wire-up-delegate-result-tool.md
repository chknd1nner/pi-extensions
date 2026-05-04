---
task_number: 9
title: Wire Up `delegate_result` Tool
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Review Task 9: Wire Up `delegate_result` Tool

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
  - Move ticket to done status (ticket_move task-09 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-09 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
review_prompt_template: |-
  Review Task 9: Wire Up `delegate_result` Tool

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
  - Move ticket to done status (ticket_move task-09 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-09 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: 'Spec match for delegate_result (status/result/usage, throws on running/unknown, zero-defaulted usage when no assistant turn). Verified in worktree .worktrees/delegate-extension @ 8e8b4c5: tsc --noEmit clean; rg "isError:\\s*true" index.ts → clean; vitest run → 55/55 passed (incl. 8 in tests/index.delegate-result.test.ts covering unknown id, running guard, assistant-text extraction, transcript fallback, failed+stderr tail, zero-default usage, session_shutdown disposeAll). Type tightened: WorkerResult.usage is required and drops cost, matching spec schema.'
---

# Task 09 — Wire Up `delegate_result` Tool

## Convention reminder (added after task-07 review)

For every failure path in this tool: signal failures with `throw new Error(...)`, **never** `return { isError: true }`. Pi only sets the error flag on a tool call when `execute()` throws — returning `{ isError: true }` is silently treated as a successful tool result, and the orchestrator LLM cannot branch on it. The code block below already uses the correct pattern; preserve it exactly.

Note: when the worker is in a terminal state but produced an error (status `failed` / `aborted` with `entry.error` set), the tool still **returns** the result rather than throws. That is deliberate — the worker finished and its post-mortem details (`status`, `error`, `stderr` tail, partial transcript) are the value the orchestrator asked for. Throwing only applies to *requests* `delegate_result` cannot fulfil (unknown task, worker still running).

## Plan excerpt

**Files:**
- Modify: `extensions/delegate/index.ts`

- [x] **Step 1: Add `delegate_result` registration in `index.ts`**

Add after `delegate_abort`:

```typescript
  pi.registerTool({
    name: "delegate_result",
    label: "Delegate Result",
    description: "Read the final output of a completed worker.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      if (entry.status === "running") {
        throw new Error(
          `Worker ${params.task_id} is still running. Use delegate_check to monitor progress, or delegate_abort to stop it.`,
        );
      }

      const transcript = entry.progress?.getFullTranscript() ?? "";
      const finalMessages = entry.progress?.getFinalMessages() ?? [];

      // AssistantMessage.content is (TextContent | ThinkingContent | ToolCall)[], not a string.
      let resultText = "";
      for (const msg of finalMessages) {
        const m = msg as { role?: string; content?: unknown[] };
        if (m.role === "assistant" && Array.isArray(m.content)) {
          for (const block of m.content) {
            if ((block as { type: string }).type === "text") {
              resultText += (block as { text: string }).text;
            }
          }
        }
      }

      if (!resultText) {
        resultText = transcript;
      }

      const result: Record<string, unknown> = {
        status: entry.status,
        result: resultText.trim(),
      };

      if (entry.error) {
        result.error = entry.error;
        if (entry.rpcClient) {
          result.stderr = entry.rpcClient.getStderr().slice(-2000);
        }
      }

      return {
        content: [{ type: "text" as const, text: resultText.trim() || `Worker ${params.task_id} ${entry.status} with no output.${entry.error ? ` Error: ${entry.error}` : ""}` }],
        details: result,
      };
    },
  });
```

- [x] **Step 2: Remove the comment about remaining tools**

Delete the comment in `index.ts` that says:
```typescript
  // Remaining tools (delegate_check, delegate_steer, delegate_abort, delegate_result)
  // are registered in subsequent tasks.
```

(After tasks 7 and 8 land, the comment will already read `// Remaining tools (delegate_steer, delegate_abort, delegate_result) are registered in subsequent tasks.` or similar — delete whatever variant is present.)

- [x] **Step 3: Add cleanup on extension unload**

At the end of the `delegate` function, before the closing brace, add:

```typescript
  pi.on("session_shutdown", async () => {
    await manager.disposeAll();
  });
```

- [x] **Step 4: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 5: Verify the wrong pattern was not reintroduced**

Run: `cd extensions/delegate && rg -n "isError:\s*true" index.ts || echo "clean"`
Expected: `clean`

- [x] **Step 6: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): add delegate_result tool, complete all 5 tools"
```

---


---

## Notes

- Added TDD coverage in `extensions/delegate/tests/index.delegate-result.test.ts` before implementation; initial red run failed with 7/7 failures because `delegate_result` and `session_shutdown` cleanup were not wired yet.
- Commit created in implementation worktree: `046d890` (`feat(delegate): add delegate_result tool, complete all 5 tools`).
- Verification:
  - `cd extensions/delegate && npx vitest run tests/index.delegate-result.test.ts` → PASS (7 tests)
  - `cd extensions/delegate && npx tsc --noEmit` → PASS
  - `cd extensions/delegate && rg -n "isError:\s*true" index.ts || echo "clean"` → `clean`
  - `cd extensions/delegate && npx vitest run` → PASS (54 tests)
- Follow-up after review feedback:
  - Added a second TDD cycle for spec alignment on `delegate_result.usage`; the red run failed with 4/8 tests because the usage payload was missing.
  - Updated `delegate_result` to always include `usage: { input, output, cacheRead, cacheWrite }`, defaulting to zero counts when no assistant turn was observed.
  - Added coverage for both populated and zeroed usage payloads; fresh verification passed:
    - `cd extensions/delegate && npx vitest run tests/index.delegate-result.test.ts` → PASS (8 tests)
    - `cd extensions/delegate && npx tsc --noEmit` → PASS
    - `cd extensions/delegate && rg -n "isError:\s*true" index.ts || echo "clean"` → `clean`
    - `cd extensions/delegate && npx vitest run` → PASS (55 tests)
