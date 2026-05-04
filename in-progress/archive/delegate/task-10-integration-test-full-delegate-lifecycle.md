---
task_number: 10
title: Integration Test — Full Delegate Lifecycle
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Review Task 10: Integration Test — Full Delegate Lifecycle

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
  - Move ticket to done status (ticket_move task-10 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-10 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
review_prompt_template: |-
  Review Task 10: Integration Test — Full Delegate Lifecycle

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
  - Move ticket to done status (ticket_move task-10 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-10 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: 'Spec match: integration test asserts delegate_start return shape, progress log path under {cwd}/.pi/delegate/{date}/{sessionId}/w1.progress.md, [TOOL: bash] marker + streamed text in log, delegate_check details (status/tool_calls/recent_activity/tokens/context_percent), delegate_result usage block. Test correctly skipped without DELEGATE_INTEGRATION=1. Verification on implementation worktree: `npx vitest run` -> 55 passed, 1 skipped (integration), 0 failures; `npx tsc --noEmit -p tsconfig.json` -> clean. Implementor recorded DELEGATE_INTEGRATION=1 run as ✅ in ticket Notes (commit 6d62ae1).'
---

# Task 10 — Integration Test — Full Delegate Lifecycle

## Plan excerpt

> **Note:** Task 10 was originally "Fix delegate_check Token Stats via RPC Response Handling" — that code has been collapsed into Tasks 2 (sendAndWait on RPCClient) and 7 (delegate_check uses sendAndWait directly).

**Files:**
- Create: `extensions/delegate/tests/integration.test.ts`

This tests the full lifecycle with a real `pi --mode rpc` process. Requires Pi to be installed and a provider to be configured. Mark as skippable in CI.

- [x] **Step 1: Write integration test**

Create `tests/integration.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { RPCClient } from "../rpc-client";
import { ProgressAccumulator } from "../progress";
import type { RPCEvent } from "../types";

const RUN_INTEGRATION = process.env.DELEGATE_INTEGRATION === "1";

describe.skipIf(!RUN_INTEGRATION)("integration: full delegate lifecycle", () => {
  it("spawns a worker, receives events, and reads result", async () => {
    const progress = new ProgressAccumulator();
    const events: RPCEvent[] = [];

    const client = new RPCClient(
      {
        model: "claude-haiku-4-5",
        provider: "anthropic",
        cwd: process.cwd(),
      },
      {
        onEvent(event) {
          events.push(event);
          progress.handleEvent(event);
        },
        onExit() {},
        onError() {},
      },
    );

    client.start();
    client.send({ type: "prompt", message: "Reply with exactly: DELEGATE_TEST_OK" });

    // Wait for agent_end (timeout after 30s)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for agent_end")), 30_000);
      const interval = setInterval(() => {
        if (progress.isFinished()) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 200);
    });

    const transcript = progress.getFullTranscript();
    expect(transcript).toContain("DELEGATE_TEST_OK");

    const summary = progress.getSummary();
    expect(summary.tool_calls).toBeGreaterThanOrEqual(0);

    client.closeStdin();

    // Wait for process exit
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (!client.isAlive()) {
          clearInterval(interval);
          resolve();
        }
      }, 200);
    });
  }, 60_000);
});
```

- [x] **Step 2: Run integration test**

Run: `cd extensions/delegate && DELEGATE_INTEGRATION=1 npx vitest run tests/integration.test.ts`
Expected: PASS (requires working Pi + Anthropic API key)

- [x] **Step 3: Run all unit tests (integration skipped by default)**

Run: `cd extensions/delegate && npx vitest run`
Expected: All unit tests PASS, integration test SKIPPED

- [x] **Step 4: Commit**

```bash
git add extensions/delegate/tests/integration.test.ts
git commit -m "test(delegate): add integration test for full worker lifecycle"
```

---


---

## Notes

- Added `extensions/delegate/tests/integration.test.ts` covering `delegate_start` → `delegate_check` → `delegate_result` with a real `pi --mode rpc` worker.
- The test fixes the session id via `session_start`, asserts `.pi/delegate/<date>/<sessionId>/w1.progress.md` is created, and verifies the log contains both a `[TOOL: bash]` marker and streamed `DELEGATE_TEST_OK` output.
- Verification run in the implementation worktree:
  - `cd extensions/delegate && DELEGATE_INTEGRATION=1 npx vitest run tests/integration.test.ts` ✅
  - `cd extensions/delegate && npx vitest run` ✅ (`tests/integration.test.ts` skipped by default)
  - `cd extensions/delegate && npx tsc --noEmit -p tsconfig.json` ✅
- Commit created in implementation branch: `6d62ae1` (`test(delegate): add integration test for full worker lifecycle`).
