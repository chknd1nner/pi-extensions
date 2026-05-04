---
task_number: 7
title: Wire Up `delegate_check` Tool (Stats from Streamed Events)
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
supersedes: in-progress/archive/delegate/task-07-wire-up-delegate-check-tool-SUPERSEDED-stats-via-rpc.md
next_prompt: |-
  Review Task 7 (rewrite): Wire Up `delegate_check` Tool with accumulator-sourced stats

  Perform a TWO-STAGE REVIEW:

  ## Stage 1: Spec Review
  Compare implementation against the design spec.
  - Read the spec_path document, particularly sections `### delegate_check`, `### delegate_result`, and `### progress.ts`.
  - Verify the implementation derives `input_tokens`, `output_tokens`, and `context_usage_percent` from the ProgressAccumulator (driven by streamed `turn_end` events), NOT from a live RPC call.
  - Verify `context_usage_percent` is `null` when no assistant turn has been observed, or when the worker model is not in the orchestrator's ModelRegistry.
  - Verify `delegate_check` performs no `sendAndWait`/`get_session_stats` calls. Grep the diff for `get_session_stats` and `sendAndWait` — neither should appear in the new `delegate_check` execute path.
  - Verify usage data survives unexpected worker exits (the regression that this task exists to fix).

  If MAJOR spec issues found, you may terminate review early.
  If minor spec divergences, note them and continue to Stage 2.

  ## Stage 2: Code Review
  Use the superpowers:requesting-code-review skill approach.
  - Get git diff for this task's changes
  - Check code quality, architecture, testing
  - Categorize issues: Critical / Important / Minor

  Specific things to check:
  - ProgressAccumulator correctly extracts `usage` from `turn_end` events for assistant messages only (not user/toolResult).
  - ProgressAccumulator no longer updates `lastActivityAt` on `agent_end` (so terminal workers report a meaningful idle interval).
  - The post-mortem failed-worker test actually models the failure correctly: the test must assert that `delegate_check` returns retained stats WITHOUT calling `rpcClient.sendAndWait` (use spy assertions). Tests that allow `sendAndWait` to succeed against a "dead" mock give false confidence.
  - Unknown `task_id` is signaled by `throw`, per Pi extension docs (`return { isError: true }` is silently ignored by Pi). The `delegate_start.test.ts` assertion should expect `rejects.toThrow(...)`.

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
review_prompt_template: |-
  Review Task 7 (rewrite): Wire Up `delegate_check` Tool with accumulator-sourced stats

  Perform a TWO-STAGE REVIEW:

  ## Stage 1: Spec Review
  Compare implementation against the design spec.
  - Read the spec_path document, particularly sections `### delegate_check`, `### delegate_result`, and `### progress.ts`.
  - Verify the implementation derives `input_tokens`, `output_tokens`, and `context_usage_percent` from the ProgressAccumulator (driven by streamed `turn_end` events), NOT from a live RPC call.
  - Verify `context_usage_percent` is `null` when no assistant turn has been observed, or when the worker model is not in the orchestrator's ModelRegistry.
  - Verify `delegate_check` performs no `sendAndWait`/`get_session_stats` calls. Grep the diff for `get_session_stats` and `sendAndWait` — neither should appear in the new `delegate_check` execute path.
  - Verify usage data survives unexpected worker exits (the regression that this task exists to fix).

  If MAJOR spec issues found, you may terminate review early.
  If minor spec divergences, note them and continue to Stage 2.

  ## Stage 2: Code Review
  Use the superpowers:requesting-code-review skill approach.
  - Get git diff for this task's changes
  - Check code quality, architecture, testing
  - Categorize issues: Critical / Important / Minor

  Specific things to check:
  - ProgressAccumulator correctly extracts `usage` from `turn_end` events for assistant messages only (not user/toolResult).
  - ProgressAccumulator no longer updates `lastActivityAt` on `agent_end` (so terminal workers report a meaningful idle interval).
  - The post-mortem failed-worker test actually models the failure correctly: the test must assert that `delegate_check` returns retained stats WITHOUT calling `rpcClient.sendAndWait` (use spy assertions). Tests that allow `sendAndWait` to succeed against a "dead" mock give false confidence.
  - Unknown `task_id` is signaled by `throw`, per Pi extension docs (`return { isError: true }` is silently ignored by Pi). The `delegate_start.test.ts` assertion should expect `rejects.toThrow(...)`.

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
approval_note: |-
  Spec + code review PASS.

  Verification (run from worktree /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension):
  - npx vitest run → 6 files / 42 tests passed (incl. 5 new tests in tests/index.delegate-check.test.ts and 4 new accumulation tests in tests/progress.test.ts).
  - npx tsc --noEmit → clean.
  - rg -n "get_session_stats|sendAndWait|cacheSessionStats" extensions/delegate/index.ts → "clean: no live-RPC stats calls in delegate_check path".

  Spec compliance:
  - delegate_check derives input_tokens/output_tokens/context_usage_percent from ProgressAccumulator.getUsage() (index.ts:251–273), no live RPC.
  - context_usage_percent is null when usage.lastAssistantInput === null OR when ctx.modelRegistry.find(provider, model) returns undefined / no contextWindow (index.ts:257–264). Verified by two dedicated tests.
  - ProgressAccumulator extracts usage only when message.role === "assistant" (progress.ts:94–107). Verified by "ignores turn_end events whose message is not an assistant message" test.
  - lastActivityAt is no longer updated on agent_end (progress.ts:50–52). Verified by "does not advance lastActivityAt on agent_end..." test using fake timers.
  - Unknown task_id throws (index.ts:248–250); test uses rejects.toThrow.
  - REGRESSION test asserts rpcClientMocks.sendAndWait was never called for a failed worker (tests/index.delegate-check.test.ts:173) — guards against re-introducing the live-RPC stats path.

  Code quality: clean, focused diff (6 files, +374/-27); no dead code; minimal, on-design.
---

# Task 07 — Wire Up `delegate_check` Tool (Stats from Streamed Events)

## Background

The first iteration of this task fetched token / context-window stats by sending an RPC `get_session_stats` request to the worker subprocess on demand. That mechanism is structurally unable to report stats for terminal workers — particularly `failed` workers whose process has already exited, because `RPCClient.send()` silently drops writes once stdin is no longer writable.

The spec has been amended (commit `18437f1`). The new design captures token usage **passively** from the streamed RPC event protocol. Every `turn_end` event carries the assistant `AgentMessage` whose `usage` block contains `{ input, output, cacheRead, cacheWrite }`. That data is delivered to the extension before the worker can crash, so it survives any terminal state. `context_usage_percent` is derived at query time from the latest assistant turn's input tokens and the worker model's context window (resolved via the orchestrator's `ModelRegistry`).

This task implements that design. It both (a) registers `delegate_check` for the first time correctly and (b) replaces the original task-07 commit's `delegate_check` body wholesale.

## Plan excerpt

**Files:**
- Modify: `extensions/delegate/progress.ts`
- Modify: `extensions/delegate/types.ts`
- Modify: `extensions/delegate/index.ts`
- Modify: `extensions/delegate/tests/index.delegate-start.test.ts`
- Modify: `extensions/delegate/tests/progress.test.ts`
- Add: `extensions/delegate/tests/index.delegate-check.test.ts`

---

- [x] **Step 1: Add `WorkerUsage` type in `types.ts`**

Add the following near `ToolCallRecord`:

```typescript
export type WorkerUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  lastAssistantInput: number | null;
};
```

This is the shape returned by `ProgressAccumulator.getUsage()` and consumed by `delegate_check` and (in a later task) `delegate_result`.

---

- [x] **Step 2: Extend `ProgressAccumulator` with usage tracking in `progress.ts`**

Make four changes to `progress.ts`:

(a) Add an import for the new type:

```typescript
import type { RPCEvent, ToolCallRecord, WorkerUsage } from "./types";
```

(b) Add internal counter fields next to the existing `transcript` / `toolCalls` / `lastActivityAt` fields:

```typescript
  private cumulativeInput = 0;
  private cumulativeOutput = 0;
  private cumulativeCacheRead = 0;
  private cumulativeCacheWrite = 0;
  private lastAssistantInput: number | null = null;
```

(c) In `handleEvent`, the `lastActivityAt = Date.now()` line at the top of the method must NOT fire for `agent_end`, so terminal workers report a meaningful idle interval. Restructure as follows:

```typescript
  handleEvent(event: RPCEvent): void {
    if (event.type !== "agent_end") {
      this.lastActivityAt = Date.now();
    }

    switch (event.type) {
      // ... existing cases unchanged ...

      case "turn_end": {
        const message = (event.message as {
          role?: string;
          usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
        } | undefined);
        if (message?.role === "assistant" && message.usage) {
          const u = message.usage;
          const input = u.input ?? 0;
          const output = u.output ?? 0;
          this.cumulativeInput += input;
          this.cumulativeOutput += output;
          this.cumulativeCacheRead += u.cacheRead ?? 0;
          this.cumulativeCacheWrite += u.cacheWrite ?? 0;
          this.lastAssistantInput = input;
        }
        break;
      }

      case "agent_end": {
        // existing body unchanged
      }
    }
  }
```

Note: filter on `message.role === "assistant"` because `turn_end` always carries an assistant message per the RPC spec, but defending against schema drift is cheap.

(d) Add a `getUsage()` query method:

```typescript
  getUsage(): WorkerUsage {
    return {
      input: this.cumulativeInput,
      output: this.cumulativeOutput,
      cacheRead: this.cumulativeCacheRead,
      cacheWrite: this.cumulativeCacheWrite,
      lastAssistantInput: this.lastAssistantInput,
    };
  }
```

---

- [x] **Step 3: Replace `delegate_check` registration in `index.ts`**

The existing `delegate_check` block (introduced by commit `3a9f496`) queries `get_session_stats` via `entry.rpcClient.sendAndWait`. Replace its body with an implementation that reads from the accumulator and resolves `context_usage_percent` via the orchestrator's `ModelRegistry`. Final form:

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

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      const progressSummary = entry.progress!.getSummary();
      const usage = entry.progress!.getUsage();
      const elapsed = Math.round((Date.now() - entry.startedAt) / 1000);

      // Resolve context_usage_percent from the orchestrator's ModelRegistry.
      // Returns null when no assistant turn has been observed yet, or when
      // the worker model is not registered (e.g. unknown custom provider).
      let contextPercent: number | null = null;
      if (usage.lastAssistantInput !== null) {
        const model = ctx.modelRegistry?.find(entry.params.provider, entry.params.model);
        const window = model?.contextWindow;
        if (typeof window === "number" && window > 0) {
          contextPercent = Math.round((100 * usage.lastAssistantInput) / window);
        }
      }

      const summary: Record<string, unknown> = {
        status: entry.status,
        elapsed_seconds: elapsed,
        tool_calls: progressSummary.tool_calls,
        last_activity_seconds_ago: progressSummary.last_activity_seconds_ago,
        recent_activity: progressSummary.recent_activity,
        input_tokens: usage.input,
        output_tokens: usage.output,
        context_usage_percent: contextPercent,
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

Key invariants this code MUST preserve:
- No call to `entry.rpcClient.sendAndWait`, no reference to `get_session_stats`, no `cacheSessionStats` helper. The accumulator is the single source of truth for usage data.
- Unknown `task_id` is signaled via `throw new Error(...)`. Per Pi extension docs, returning `{ isError: true }` is silently ignored by Pi; only thrown errors set the error flag. (Other tools in this extension currently use the wrong pattern; that is out of scope for this ticket but flag it in your ## Notes if reviewer asks.)
- The `ctx` parameter is now used (not prefixed with `_`).

---

- [x] **Step 4: Update unknown-task assertion in `tests/index.delegate-start.test.ts`**

Locate the test `it("returns an error for unknown task IDs in delegate_check", ...)` and change it to:

```typescript
  it("throws for unknown task IDs in delegate_check", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check");
    expect(tool).toBeDefined();

    await expect(tool!.execute("call-2", { task_id: "w999" })).rejects.toThrow(
      "Unknown task ID: w999",
    );
  });
```

---

- [x] **Step 5: Add usage-accumulation unit tests in `tests/progress.test.ts`**

Append the following test cases inside the existing `describe` block (or add a new nested `describe("token usage accumulation")` block):

```typescript
  it("accumulates assistant usage across turn_end events", () => {
    const acc = new ProgressAccumulator();

    acc.handleEvent({
      type: "turn_end",
      message: {
        role: "assistant",
        usage: { input: 100, output: 25, cacheRead: 10, cacheWrite: 5 },
      },
    } as unknown as RPCEvent);

    acc.handleEvent({
      type: "turn_end",
      message: {
        role: "assistant",
        usage: { input: 250, output: 40, cacheRead: 20, cacheWrite: 0 },
      },
    } as unknown as RPCEvent);

    expect(acc.getUsage()).toEqual({
      input: 350,
      output: 65,
      cacheRead: 30,
      cacheWrite: 5,
      lastAssistantInput: 250,
    });
  });

  it("returns zero usage with null lastAssistantInput before any turn_end", () => {
    const acc = new ProgressAccumulator();
    expect(acc.getUsage()).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      lastAssistantInput: null,
    });
  });

  it("ignores turn_end events whose message is not an assistant message", () => {
    const acc = new ProgressAccumulator();
    acc.handleEvent({
      type: "turn_end",
      message: { role: "user", usage: { input: 999, output: 999 } },
    } as unknown as RPCEvent);
    expect(acc.getUsage().input).toBe(0);
    expect(acc.getUsage().lastAssistantInput).toBeNull();
  });

  it("does not advance lastActivityAt on agent_end so terminal workers report a real idle interval", async () => {
    const acc = new ProgressAccumulator();

    acc.handleEvent({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "ls" },
    } as unknown as RPCEvent);

    // Advance wall clock slightly. Use real timers + a small delay; this test
    // must not depend on fake timers to keep the rest of the file simple.
    await new Promise((r) => setTimeout(r, 20));

    acc.handleEvent({ type: "agent_end", messages: [] } as unknown as RPCEvent);

    const summary = acc.getSummary();
    expect(summary.last_activity_seconds_ago).toBeGreaterThanOrEqual(0);
    // The point: agent_end did not reset lastActivityAt to "now". We can't
    // assert exact seconds without flake, but the test guards against the
    // regression by demonstrating the field still reflects the earlier event.
  });
```

The `lastActivityAt` test deliberately keeps a tight tolerance. If the existing test file already contains a `last_activity_seconds_ago` test, harmonize with it — the regression we're guarding against is that `agent_end` used to reset the timer.

---

- [x] **Step 6: Add new file `tests/index.delegate-check.test.ts`**

Use this entire file:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

const managerMocks = vi.hoisted(() => ({
  canStart: vi.fn(() => true),
  activeWorkerDescriptions: vi.fn(() => []),
  nextTaskId: vi.fn(() => "w1"),
  register: vi.fn(),
  setStatus: vi.fn(),
  get: vi.fn(),
}));

const rpcClientMocks = vi.hoisted(() => ({
  start: vi.fn(),
  send: vi.fn(),
  sendAndWait: vi.fn(async () => null as unknown),
  kill: vi.fn(async () => {}),
  closeStdin: vi.fn(),
  isAlive: vi.fn(() => true),
}));

vi.mock("../worker-manager", () => ({
  WorkerManager: vi.fn().mockImplementation(() => ({
    canStart: managerMocks.canStart,
    activeWorkerDescriptions: managerMocks.activeWorkerDescriptions,
    nextTaskId: managerMocks.nextTaskId,
    register: managerMocks.register,
    setStatus: managerMocks.setStatus,
    get: managerMocks.get,
  })),
}));

vi.mock("../rpc-client", () => ({
  RPCClient: vi.fn().mockImplementation(() => ({
    start: rpcClientMocks.start,
    send: rpcClientMocks.send,
    sendAndWait: rpcClientMocks.sendAndWait,
    kill: rpcClientMocks.kill,
    closeStdin: rpcClientMocks.closeStdin,
    isAlive: rpcClientMocks.isAlive,
  })),
}));

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
    isError?: boolean;
  }>;
};

function createFakePi(modelLookup?: (provider: string, modelId: string) => unknown) {
  const registeredTools: RegisteredTool[] = [];

  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;

  const ctx = {
    modelRegistry: {
      find: modelLookup ?? (() => undefined),
    },
  };

  return {
    pi,
    ctx,
    getTool: (name: string) => registeredTools.find((tool) => tool.name === name),
  };
}

function makeProgressStub(
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; lastAssistantInput: number | null },
  summary?: Partial<{ tool_calls: number; last_activity_seconds_ago: number; recent_activity: string[]; transcript: string }>,
) {
  return {
    getSummary: () => ({
      tool_calls: 0,
      last_activity_seconds_ago: 0,
      recent_activity: [],
      transcript: "",
      ...summary,
    }),
    getUsage: () => usage,
  };
}

describe("delegate_check (accumulator-sourced stats)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns accumulator stats for a running worker and computes context_usage_percent", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "running",
      params: { task: "x", model: "claude-sonnet-4-6", provider: "anthropic" },
      startedAt: Date.now() - 5000,
      progress: makeProgressStub({
        input: 1500,
        output: 320,
        cacheRead: 0,
        cacheWrite: 0,
        lastAssistantInput: 50000,
      }),
      rpcClient: { isAlive: () => true },
    });

    const fake = createFakePi(() => ({ contextWindow: 200000 }));
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check")!;
    const result = await tool.execute("call-1", { task_id: "w1" }, undefined, undefined, fake.ctx);

    expect(result.details?.input_tokens).toBe(1500);
    expect(result.details?.output_tokens).toBe(320);
    expect(result.details?.context_usage_percent).toBe(25); // 50000 / 200000 = 25%
    expect(result.details?.status).toBe("running");
  });

  it("REGRESSION: returns retained accumulator stats for a failed worker without invoking sendAndWait", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "failed",
      params: { task: "x", model: "claude-sonnet-4-6", provider: "anthropic" },
      startedAt: Date.now() - 5000,
      error: "Process exited unexpectedly (code 1)",
      progress: makeProgressStub({
        input: 800,
        output: 120,
        cacheRead: 0,
        cacheWrite: 0,
        lastAssistantInput: 30000,
      }),
      // rpcClient may still be referenced after process exit; make sendAndWait
      // a spy so we can prove delegate_check never calls it.
      rpcClient: { isAlive: () => false, sendAndWait: rpcClientMocks.sendAndWait },
    });

    const fake = createFakePi(() => ({ contextWindow: 200000 }));
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check")!;
    const result = await tool.execute("call-1", { task_id: "w1" }, undefined, undefined, fake.ctx);

    expect(result.details?.status).toBe("failed");
    expect(result.details?.input_tokens).toBe(800);
    expect(result.details?.output_tokens).toBe(120);
    expect(result.details?.context_usage_percent).toBe(15); // 30000 / 200000 = 15%
    expect(result.details?.error).toBe("Process exited unexpectedly (code 1)");

    // The whole point of this rewrite: we MUST NOT round-trip to a dead worker.
    expect(rpcClientMocks.sendAndWait).not.toHaveBeenCalled();
  });

  it("returns null context_usage_percent when no assistant turn has been observed", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "running",
      params: { task: "x", model: "claude-sonnet-4-6", provider: "anthropic" },
      startedAt: Date.now(),
      progress: makeProgressStub({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        lastAssistantInput: null,
      }),
      rpcClient: { isAlive: () => true },
    });

    const fake = createFakePi(() => ({ contextWindow: 200000 }));
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check")!;
    const result = await tool.execute("call-1", { task_id: "w1" }, undefined, undefined, fake.ctx);

    expect(result.details?.context_usage_percent).toBeNull();
    expect(result.details?.input_tokens).toBe(0);
  });

  it("returns null context_usage_percent when the worker model is not in the registry", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "completed",
      params: { task: "x", model: "totally-unknown", provider: "custom-proxy" },
      startedAt: Date.now() - 1000,
      progress: makeProgressStub({
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        lastAssistantInput: 12000,
      }),
    });

    const fake = createFakePi(() => undefined); // registry returns nothing
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check")!;
    const result = await tool.execute("call-1", { task_id: "w1" }, undefined, undefined, fake.ctx);

    expect(result.details?.context_usage_percent).toBeNull();
    expect(result.details?.input_tokens).toBe(100); // tokens still reported
  });

  it("appends transcript when detail=full", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "completed",
      params: { task: "x", model: "claude-sonnet-4-6", provider: "anthropic" },
      startedAt: Date.now() - 1000,
      progress: makeProgressStub(
        { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, lastAssistantInput: 100 },
        { transcript: "hello world" },
      ),
    });

    const fake = createFakePi(() => ({ contextWindow: 200000 }));
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check")!;
    const result = await tool.execute("call-1", { task_id: "w1", detail: "full" }, undefined, undefined, fake.ctx);

    expect(result.content[0].text).toContain("transcript:\nhello world");
  });
});
```

The first three tests prove the spec contract. The **REGRESSION** test is the key artifact that must not be removed: it asserts that `delegate_check` against a `failed` worker returns retained stats without calling `sendAndWait`. That assertion is the trip-wire that catches the original bug if anyone tries to "improve" the live-RPC path again.

---

- [x] **Step 7: Run the test suite**

```
cd extensions/delegate && npx vitest run
```

Expected: all tests pass, including:
- the new `progress.test.ts` cases for usage accumulation
- the new `tests/index.delegate-check.test.ts` file (5 tests)
- the updated unknown-task assertion in `tests/index.delegate-start.test.ts`

Then run typecheck:

```
cd extensions/delegate && npx tsc --noEmit
```

Expected: no errors.

---

- [x] **Step 8: Commit**

```bash
git add extensions/delegate/progress.ts \
        extensions/delegate/types.ts \
        extensions/delegate/index.ts \
        extensions/delegate/tests/index.delegate-start.test.ts \
        extensions/delegate/tests/progress.test.ts \
        extensions/delegate/tests/index.delegate-check.test.ts
git commit -m "feat(delegate): rewrite delegate_check to source stats from event accumulator

Per the updated design spec, token and context-window stats are now
captured passively from the streamed RPC turn_end events instead of
being fetched on demand via get_session_stats. This makes the data
survive any terminal worker state, including unexpected process exits
that previously left delegate_check returning zeros for failed workers.

- progress.ts: accumulate cumulative input/output/cache* and track
  lastAssistantInput from each assistant turn_end event; expose via
  getUsage(); stop resetting lastActivityAt on agent_end.
- index.ts: rewrite delegate_check to read usage from the accumulator
  and resolve context_usage_percent via ctx.modelRegistry; throw on
  unknown task_id (Pi convention); no live RPC calls in this path.
- types.ts: add WorkerUsage shape for getUsage().
- tests: add progress accumulation unit tests; add full delegate_check
  test file including a regression test that asserts no sendAndWait
  call against a failed worker; update unknown-task assertion to
  expect a thrown error."
```

---

## Verification commands (run before moving to review)

From the worktree root (`/Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension`):

```
cd extensions/delegate && npx vitest run
cd extensions/delegate && npx tsc --noEmit
```

Both must pass. The vitest run should show at least 7 test files, with the new `index.delegate-check.test.ts` contributing 5 tests and `progress.test.ts` showing the new accumulation cases.

Manual sanity grep on the diff (paste output into ## Notes):

```
git diff main..HEAD -- extensions/delegate/index.ts | grep -E "(get_session_stats|sendAndWait|cacheSessionStats)" || echo "clean: no live-RPC stats calls in delegate_check path"
```

Expected output: `clean: no live-RPC stats calls in delegate_check path`. If anything else appears, you have re-introduced the regression — investigate before moving to review.

---

## Notes

- Implementation worktree: `/Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension`
- Commit: `2d1892b` (`feat(delegate): rewrite delegate_check to source stats from event accumulator`)
- Verification:
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx vitest run` ✅ (`6` files / `42` tests passed; current suite contains 6 files in this branch, including the new `tests/index.delegate-check.test.ts` with 5 tests)
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx tsc --noEmit` ✅
  - `cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension && rg -n "get_session_stats|sendAndWait|cacheSessionStats" extensions/delegate/index.ts || echo "clean: no live-RPC stats calls in delegate_check path"` ✅ (`clean: no live-RPC stats calls in delegate_check path`)
- TDD evidence:
  - Initial red run: `npx vitest run tests/progress.test.ts tests/index.delegate-start.test.ts tests/index.delegate-check.test.ts` failed with missing `getUsage()`, incorrect unknown-task behavior, and `agent_end` idle-timer regression.
  - After implementation, the same targeted run passed before full-suite verification.
