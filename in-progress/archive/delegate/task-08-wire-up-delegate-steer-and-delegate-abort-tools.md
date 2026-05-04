---
task_number: 8
title: Wire Up `delegate_steer` and `delegate_abort` Tools
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Review Task 8: Wire Up `delegate_steer` and `delegate_abort` Tools

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
  - Move ticket to done status (ticket_move task-08 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-08 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
review_prompt_template: |-
  Review Task 8: Wire Up `delegate_steer` and `delegate_abort` Tools

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
  - Move ticket to done status (ticket_move task-08 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-08 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: 'Spec match: delegate_steer throws on non-streaming/rejected; delegate_abort uses rpcClient.kill() which implements RPC abort → stdin close → SIGTERM → SIGKILL per spec; both return {success: boolean} via details. Already-terminal abort returns success:false (documented design choice). Race with agent_end is guarded by idempotent setStatus on terminal states (worker-manager.ts:64). Verification: tsc --noEmit clean, rg isError:true clean, vitest run 47/47 passed (5 new tests for steer/abort). Commit 6a7b22a.'
---

# Task 08 — Wire Up `delegate_steer` and `delegate_abort` Tools

## Convention reminder (added after task-07 review)

For every failure path in these tools: signal failures with `throw new Error(...)`, **never** `return { isError: true }`. Pi only sets the error flag on a tool call when `execute()` throws — returning `{ isError: true }` is silently treated as a successful tool result, and the orchestrator LLM cannot branch on it. The code blocks below already use the correct pattern; preserve it exactly.

## Plan excerpt

**Files:**
- Modify: `extensions/delegate/index.ts`

- [x] **Step 1: Add `delegate_steer` registration in `index.ts`**

Add after `delegate_check`:

```typescript
  pi.registerTool({
    name: "delegate_steer",
    label: "Delegate Steer",
    description: "Send a steering message to a running worker. Delivered between turns.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
      message: Type.String({ description: "Steering instruction" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      if (entry.status !== "running") {
        throw new Error(
          `Cannot steer ${params.task_id}: worker is ${entry.status}, not running.`,
        );
      }

      if (!entry.rpcClient?.isAlive()) {
        throw new Error(
          `Cannot steer ${params.task_id}: worker process is not alive.`,
        );
      }

      // steer requires active streaming. During compaction the RPC layer may reject it.
      const resp = await entry.rpcClient.sendAndWait({ type: "steer", message: params.message });
      const respObj = resp as { success?: boolean; error?: string } | null | undefined;
      if (respObj && respObj.success === false) {
        const reason = respObj.error ?? "worker not actively streaming (possibly mid-compaction)";
        throw new Error(
          `Steer rejected by ${params.task_id}: ${reason}. Retry shortly.`,
        );
      }

      return {
        content: [{ type: "text" as const, text: `Steering message sent to ${params.task_id}.` }],
        details: { success: true },
      };
    },
  });
```

- [x] **Step 2: Add `delegate_abort` registration in `index.ts`**

Add after `delegate_steer`:

```typescript
  pi.registerTool({
    name: "delegate_abort",
    label: "Delegate Abort",
    description: "Terminate a running worker. Sends RPC abort for clean shutdown, falls back to SIGTERM/SIGKILL.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      if (entry.status !== "running") {
        // Already terminal — not an error, just a no-op the orchestrator can branch on.
        return {
          content: [{ type: "text" as const, text: `Worker ${params.task_id} is already ${entry.status}.` }],
          details: { success: false },
        };
      }

      manager.setStatus(params.task_id, "aborted", "Aborted by orchestrator");
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);

      if (entry.rpcClient) {
        await entry.rpcClient.kill();
      }
      entry.logWriter?.close();

      return {
        content: [{ type: "text" as const, text: `Worker ${params.task_id} aborted.` }],
        details: { success: true },
      };
    },
  });
```

Note on the "already terminal" branch: this stays a non-throwing return because aborting an already-finished worker is not an error condition — the orchestrator may legitimately call `delegate_abort` to ensure a worker is stopped without caring whether it had already completed. `details: { success: false }` is sufficient signal.

- [x] **Step 3: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 4: Verify the wrong pattern was not reintroduced**

Run: `cd extensions/delegate && rg -n "isError:\s*true" index.ts || echo "clean"`
Expected: `clean`

- [x] **Step 5: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): add delegate_steer and delegate_abort tools"
```

---


---

## Notes

- Added TDD coverage in `extensions/delegate/tests/index.delegate-steer-abort.test.ts` before implementing the tool registrations.
- Verification run in implementation worktree:
  - `cd extensions/delegate && npx vitest run tests/index.delegate-steer-abort.test.ts` → PASS (5 tests)
  - `cd extensions/delegate && npx tsc --noEmit` → PASS
  - `cd extensions/delegate && rg -n "isError:\s*true" index.ts || echo "clean"` → `clean`
  - `cd extensions/delegate && npx vitest run` → PASS (47 tests)
- Commit: `6a7b22a` (`feat(delegate): add delegate_steer and delegate_abort tools`)
