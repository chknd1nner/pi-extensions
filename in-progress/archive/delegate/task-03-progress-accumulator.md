---
task_number: 3
title: Progress Accumulator
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Re-review Task 03 (fix pass).

  Scope implemented in /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension:
  - extensions/delegate/progress.ts
  - extensions/delegate/tests/progress.test.ts

  Fixes applied:
  1. Added tool_execution_update handling in ProgressAccumulator.
  2. Accumulate partial tool output into pending ToolCallRecord.result.
  3. Capture/persist final result text on tool_execution_end before marking tool complete.
  4. Added focused tests for partial accumulation and final-result capture.

  Verification evidence:
  - cd extensions/delegate && npx vitest run tests/progress.test.ts  -> PASS (9 tests)
  - cd extensions/delegate && npx tsc --noEmit  -> PASS (no output)

  Please run Stage 1 spec review and Stage 2 code review per review_prompt_template.
review_prompt_template: |-
  Review Task 3: Progress Accumulator

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
  - Move ticket to done status (ticket_move task-03 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-03 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: 'Re-review passed on 2026-05-03. Spec gap for tool result accumulation is resolved in `extensions/delegate/progress.ts` with `tool_execution_update` handling and final result persistence (`progress.ts:63-84`). Added regression coverage in `extensions/delegate/tests/progress.test.ts:40-98`. Fresh verification in `/Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate`: `npx vitest run tests/progress.test.ts` -> 9/9 tests passed, exit 0; `npx tsc --noEmit` -> exit 0.'
---

# Task 03 — Progress Accumulator

## Plan excerpt

**Files:**
- Create: `extensions/delegate/progress.ts`
- Create: `extensions/delegate/tests/progress.test.ts`

- [x] **Step 1: Write failing tests**

Create `tests/progress.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ProgressAccumulator } from "../progress";

describe("ProgressAccumulator", () => {
  let progress: ProgressAccumulator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    progress = new ProgressAccumulator();
  });

  it("starts with empty state", () => {
    const summary = progress.getSummary();
    expect(summary.tool_calls).toBe(0);
    expect(summary.recent_activity).toEqual([]);
    expect(summary.transcript).toBe("");
  });

  it("accumulates text deltas from message_update events", () => {
    progress.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello " },
    });
    progress.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "world" },
    });
    expect(progress.getFullTranscript()).toBe("Hello world");
  });

  it("ignores message_update events without text_delta", () => {
    progress.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    });
    expect(progress.getFullTranscript()).toBe("");
  });

  it("records tool calls from tool_execution_start/end events", () => {
    progress.handleEvent({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "ls src/" },
    });
    progress.handleEvent({
      type: "tool_execution_end",
      toolCallId: "t1",
      result: { content: [{ type: "text", text: "file1.ts" }] },
      isError: false,
    });

    const summary = progress.getSummary();
    expect(summary.tool_calls).toBe(1);
    expect(summary.recent_activity).toEqual(['bash: {"command":"ls src/"}']);
  });

  it("keeps only the last 5 tool calls in recent_activity", () => {
    for (let i = 0; i < 7; i++) {
      progress.handleEvent({
        type: "tool_execution_start",
        toolCallId: `t${i}`,
        toolName: "read",
        args: { filePath: `file${i}.ts` },
      });
      progress.handleEvent({
        type: "tool_execution_end",
        toolCallId: `t${i}`,
        result: { content: [{ type: "text", text: "content" }] },
        isError: false,
      });
    }

    const summary = progress.getSummary();
    expect(summary.tool_calls).toBe(7);
    expect(summary.recent_activity).toHaveLength(5);
    expect(summary.recent_activity[0]).toContain("file2.ts");
    expect(summary.recent_activity[4]).toContain("file6.ts");
  });

  it("truncates args to ~80 chars", () => {
    const longCommand = "a".repeat(200);
    progress.handleEvent({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: longCommand },
    });
    progress.handleEvent({
      type: "tool_execution_end",
      toolCallId: "t1",
      result: { content: [] },
      isError: false,
    });

    const activity = progress.getSummary().recent_activity[0];
    expect(activity.length).toBeLessThanOrEqual(90);
  });

  it("updates lastActivityAt on events", () => {
    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    progress.handleEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } });

    vi.setSystemTime(new Date("2026-04-26T10:00:30Z"));
    const summary = progress.getSummary();
    expect(summary.last_activity_seconds_ago).toBe(30);
  });

  it("marks finished on agent_end", () => {
    progress.handleEvent({
      type: "agent_end",
      messages: [{ role: "assistant", content: "done" }],
    });
    expect(progress.isFinished()).toBe(true);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd extensions/delegate && npx vitest run tests/progress.test.ts`
Expected: FAIL — `ProgressAccumulator` not found

- [x] **Step 3: Implement `progress.ts`**

```typescript
import type { RPCEvent, ToolCallRecord } from "./types";

function truncateArgs(args: unknown): string {
  const str = JSON.stringify(args);
  if (str.length <= 80) return str;
  return str.slice(0, 77) + "...";
}

export class ProgressAccumulator {
  private transcript = "";
  private toolCalls: ToolCallRecord[] = [];
  private pendingTools = new Map<string, ToolCallRecord>();
  private lastActivityAt = Date.now();
  private finished = false;
  private finalMessages: unknown[] = [];

  handleEvent(event: RPCEvent): void {
    this.lastActivityAt = Date.now();

    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent as { type: string; delta?: string } | undefined;
        if (ame?.type === "text_delta" && ame.delta) {
          this.transcript += ame.delta;
        }
        break;
      }
      case "tool_execution_start": {
        const record: ToolCallRecord = {
          name: event.toolName as string,
          args: truncateArgs(event.args),
          startedAt: Date.now(),
        };
        this.pendingTools.set(event.toolCallId as string, record);
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        const pending = this.pendingTools.get(id);
        if (pending) {
          pending.endedAt = Date.now();
          this.toolCalls.push(pending);
          this.pendingTools.delete(id);
        }
        break;
      }
      case "agent_end": {
        this.finished = true;
        this.finalMessages = (event.messages as unknown[]) ?? [];
        break;
      }
    }
  }

  getSummary(): {
    tool_calls: number;
    last_activity_seconds_ago: number;
    recent_activity: string[];
    transcript: string;
  } {
    const recentCount = 5;
    const recent = this.toolCalls.slice(-recentCount).map(
      (tc) => `${tc.name}: ${tc.args}`,
    );

    return {
      tool_calls: this.toolCalls.length,
      last_activity_seconds_ago: Math.round((Date.now() - this.lastActivityAt) / 1000),
      recent_activity: recent,
      transcript: this.transcript,
    };
  }

  getFullTranscript(): string {
    return this.transcript;
  }

  getFinalMessages(): unknown[] {
    return this.finalMessages;
  }

  isFinished(): boolean {
    return this.finished;
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd extensions/delegate && npx vitest run tests/progress.test.ts`
Expected: All 8 tests PASS

- [x] **Step 5: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 6: Commit**

```bash
git add extensions/delegate/progress.ts extensions/delegate/tests/progress.test.ts
git commit -m "feat(delegate): add progress accumulator for RPC event stream"
```

---


---

## Notes

- 2026-05-03: Implemented in worktree `feature/delegate-extension-impl` at `extensions/delegate/`.
- RED: `cd extensions/delegate && npx vitest run tests/progress.test.ts` failed with `Cannot find module '../progress'`.
- GREEN: same test command passed with `8 passed`.
- Typecheck: `cd extensions/delegate && npx tsc --noEmit` passed (no output).
- 2026-05-03 review: Needs fix. `extensions/delegate/progress.ts` does not handle `tool_execution_update` events or persist tool results on `tool_execution_end`, so the implementation diverges from the design spec for `progress.ts` event storage and `ToolCallRecord` contents. Add coverage for those behaviors before resubmitting.
- 2026-05-03 fix pass: Updated `extensions/delegate/progress.ts` to handle `tool_execution_update`, accumulate partial tool output in pending `ToolCallRecord.result`, and persist final result text on `tool_execution_end` before completing the call record.
- 2026-05-03 tests added: Extended `extensions/delegate/tests/progress.test.ts` with focused coverage for partial-result accumulation and final-result capture while preserving existing transcript/recent-activity/finished-state assertions.
- Verification:
  - `cd extensions/delegate && npx vitest run tests/progress.test.ts` → PASS (`9 passed`)
  - `cd extensions/delegate && npx tsc --noEmit` → PASS (no output)

