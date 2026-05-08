# Delegate Status File & Watcher Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add best-effort machine-readable worker status files to `extensions/delegate/`, surface the new file paths from `delegate_start`, and harden lifecycle handling so disk status never regresses or misclassifies a completed worker as failed.

**Architecture:** `extensions/delegate/visibility.ts` gains a synchronous `StatusFileWriter` that writes `<taskId>.status` atomically and disables itself after its first filesystem failure. `extensions/delegate/index.ts` owns normal worker lifecycle transitions through a local helper that only writes terminal file states after `WorkerManager.setStatus()` actually applies the in-memory transition, while `WorkerManager.disposeAll()` handles session-shutdown aborts for still-running workers. `extensions/delegate/rpc-client.ts` moves terminal callback dispatch from child-process `exit` to `close` so buffered stdout events such as `agent_end` are drained before unexpected-exit classification runs.

**Tech Stack:** TypeScript, Vitest, TypeBox, `@mariozechner/pi-coding-agent`, `node:fs`, `node:path`, `node:child_process`

**Spec:** `docs/superpowers/specs/2026-05-07-delegate-status-file-design.md`

---

## File Map

**Modified**
- `extensions/delegate/visibility.ts` — add a sibling `StatusFileWriter` and shared path construction
- `extensions/delegate/worker-manager.ts` — add `statusWriter` to `WorkerEntry`, return transition success from `setStatus()`, and mark running workers aborted during `disposeAll()`
- `extensions/delegate/rpc-client.ts` — defer terminal callback dispatch until child-process `close`
- `extensions/delegate/index.ts` — instantiate the status writer, wire status writes through all worker lifecycle edges, and return `progress_file` / `status_file` from `delegate_start`
- `extensions/delegate/tests/visibility.test.ts` — cover status-file pathing, newline format, overwrite semantics, and failure latching
- `extensions/delegate/tests/worker-manager.test.ts` — cover boolean transition results and shutdown abort behavior
- `extensions/delegate/tests/rpc-client.test.ts` — cover `close` ordering vs. buffered stdout delivery
- `extensions/delegate/tests/index.delegate-anchor.test.ts` — mock visibility writers so delegate-start unit tests do not create real `.pi/delegate/.../*.status` files
- `extensions/delegate/tests/index.inherit-context.test.ts` — mock visibility writers and assert failed status writes on pre-launch snapshot/setup failures
- `extensions/delegate/tests/integration.test.ts` — assert `delegate_start` returns both file paths and the real worker writes `running` then a terminal status

**New**
- `extensions/delegate/tests/index.delegate-status-start.test.ts` — focused unit tests for `delegate_start` status writer wiring and additive details payloads
- `extensions/delegate/tests/index.delegate-status-lifecycle.test.ts` — focused unit tests for `agent_end`, `onError`, timeout, and non-regressing terminal status writes

---

### Task 1: Add the status writer and worker-manager contract

**Files:**
- Modify: `extensions/delegate/visibility.ts:1-52`
- Modify: `extensions/delegate/worker-manager.ts:1-103`
- Modify: `extensions/delegate/tests/visibility.test.ts:1-53`
- Modify: `extensions/delegate/tests/worker-manager.test.ts:1-72`

- [ ] **Step 1.1: Extend `visibility.test.ts` with failing status-writer tests**

Update the imports and add these tests to `extensions/delegate/tests/visibility.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ProgressLogWriter, StatusFileWriter } from "../visibility";

afterEach(() => {
  vi.restoreAllMocks();
});

it("writes sibling status files with a trailing newline and replaces old contents", () => {
  const writer = new StatusFileWriter(tmpDir, "2026-05-07", "sess-abc", "w1");
  writer.writeStatus("running");
  writer.writeStatus("completed");

  const filePath = path.join(tmpDir, ".pi", "delegate", "2026-05-07", "sess-abc", "w1.status");
  expect(fs.existsSync(filePath)).toBe(true);
  expect(fs.readFileSync(filePath, "utf8")).toBe("completed\n");
});

it("disables itself after the first filesystem failure", () => {
  const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw new Error("disk full");
  });

  const writer = new StatusFileWriter(tmpDir, "2026-05-07", "sess-abc", "w1");
  expect(() => writer.writeStatus("running")).not.toThrow();
  expect(() => writer.writeStatus("completed")).not.toThrow();

  const filePath = path.join(tmpDir, ".pi", "delegate", "2026-05-07", "sess-abc", "w1.status");
  expect(fs.existsSync(filePath)).toBe(false);
});
```

- [ ] **Step 1.2: Run the visibility tests to verify they fail for the missing writer**

Run:

```bash
cd extensions/delegate
npx vitest run tests/visibility.test.ts
```

Expected: FAIL with a TypeScript/runtime error because `StatusFileWriter` does not exist yet.

- [ ] **Step 1.3: Implement `StatusFileWriter` in `visibility.ts`**

Replace `extensions/delegate/visibility.ts` with:

```ts
import fs from "node:fs";
import path from "node:path";
import type { WorkerStatus } from "./types";

function buildDelegateArtifactPath(
  projectRoot: string,
  date: string,
  sessionId: string,
  taskId: string,
  fileName: string,
): string {
  return path.join(projectRoot, ".pi", "delegate", date, sessionId, fileName.replace("{taskId}", taskId));
}

export class ProgressLogWriter {
  private fd: number | null = null;
  private filePath: string;
  private dirCreated = false;

  constructor(
    projectRoot: string,
    date: string,
    sessionId: string,
    taskId: string,
  ) {
    this.filePath = buildDelegateArtifactPath(
      projectRoot,
      date,
      sessionId,
      taskId,
      "{taskId}.progress.md",
    );
  }

  private ensureDir(): void {
    if (this.dirCreated) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.dirCreated = true;
  }

  private ensureOpen(): void {
    if (this.fd !== null) return;
    this.ensureDir();
    this.fd = fs.openSync(this.filePath, "a");
  }

  appendText(text: string): void {
    this.ensureOpen();
    fs.writeSync(this.fd!, text);
  }

  appendToolCall(toolName: string, args: string): void {
    this.ensureOpen();
    fs.writeSync(this.fd!, `\n[TOOL: ${toolName}] ${args}\n`);
  }

  getFilePath(): string {
    return this.filePath;
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

export class StatusFileWriter {
  private filePath: string;
  private dirCreated = false;
  private disabled = false;

  constructor(
    projectRoot: string,
    date: string,
    sessionId: string,
    taskId: string,
  ) {
    this.filePath = buildDelegateArtifactPath(
      projectRoot,
      date,
      sessionId,
      taskId,
      "{taskId}.status",
    );
  }

  private ensureDir(): void {
    if (this.dirCreated) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.dirCreated = true;
  }

  writeStatus(status: WorkerStatus): void {
    if (this.disabled) return;

    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      this.ensureDir();
      fs.writeFileSync(tempPath, `${status}\n`, "utf8");
      fs.renameSync(tempPath, this.filePath);
    } catch {
      this.disabled = true;
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  getFilePath(): string {
    return this.filePath;
  }
}
```

- [ ] **Step 1.4: Add failing worker-manager tests for boolean transitions and shutdown aborts**

Update `extensions/delegate/tests/worker-manager.test.ts` imports and add these tests:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";

it("returns whether a transition was applied", () => {
  manager.register("w1", baseParams);

  expect(manager.setStatus("w1", "completed")).toBe(true);
  expect(manager.setStatus("w1", "failed", "late failure")).toBe(false);
  expect(manager.get("w1")!.status).toBe("completed");
});

it("marks running workers aborted during disposeAll and writes the aborted status file", async () => {
  const kill = vi.fn(async () => {});
  const writeStatus = vi.fn();
  const close = vi.fn();

  const entry = manager.register("w1", baseParams);
  entry.rpcClient = { kill } as never;
  entry.statusWriter = { writeStatus, getFilePath: () => "/tmp/w1.status" } as never;
  entry.logWriter = { close } as never;

  await manager.disposeAll();

  expect(entry.status).toBe("aborted");
  expect(entry.error).toBe("Aborted during session shutdown");
  expect(writeStatus).toHaveBeenCalledWith("aborted");
  expect(kill).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

it("does not kill workers that were already terminal before disposeAll", async () => {
  const kill = vi.fn(async () => {});
  const close = vi.fn();

  const entry = manager.register("w1", baseParams);
  entry.rpcClient = { kill } as never;
  entry.logWriter = { close } as never;
  manager.setStatus("w1", "completed");

  await manager.disposeAll();

  expect(kill).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 1.5: Implement the worker-manager contract**

Make these targeted changes in `extensions/delegate/worker-manager.ts`:

```ts
import type { ProgressLogWriter, StatusFileWriter } from "./visibility";

export type WorkerEntry = {
  taskId: string;
  status: WorkerStatus;
  params: DelegateStartParams;
  startedAt: number;
  rpcClient?: RPCClient;
  progress?: ProgressAccumulator;
  logWriter?: ProgressLogWriter;
  statusWriter?: StatusFileWriter;
  tempFilePath?: string;
  error?: string;
  timeoutTimer?: ReturnType<typeof setTimeout>;
};
```

Replace `setStatus()` with:

```ts
setStatus(taskId: string, status: WorkerStatus, error?: string): boolean {
  const entry = this.workers.get(taskId);
  if (!entry) return false;
  if (entry.status === "completed" || entry.status === "failed" || entry.status === "aborted") {
    return false;
  }

  entry.status = status;
  if (error !== undefined) entry.error = error;
  return true;
}
```

Replace `disposeAll()` with:

```ts
async disposeAll(): Promise<void> {
  const kills: Promise<void>[] = [];

  for (const entry of this.workers.values()) {
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);

    if (entry.status === "running") {
      const applied = this.setStatus(entry.taskId, "aborted", "Aborted during session shutdown");
      if (applied) {
        entry.statusWriter?.writeStatus("aborted");
        if (entry.rpcClient) {
          kills.push(entry.rpcClient.kill());
        }
      }
    }

    entry.logWriter?.close();
  }

  await Promise.allSettled(kills);
}
```

- [ ] **Step 1.6: Run the targeted tests and commit**

Run:

```bash
cd extensions/delegate
npx vitest run tests/visibility.test.ts tests/worker-manager.test.ts
```

Expected: PASS.

Commit:

```bash
git add extensions/delegate/visibility.ts extensions/delegate/worker-manager.ts extensions/delegate/tests/visibility.test.ts extensions/delegate/tests/worker-manager.test.ts
git commit -m "feat(delegate): add status writer and worker manager plumbing"
```

---

### Task 2: Preserve `agent_end` ordering by dispatching terminal callbacks on child-process `close`

**Files:**
- Modify: `extensions/delegate/rpc-client.ts:1-195`
- Modify: `extensions/delegate/tests/rpc-client.test.ts:1-194`

- [ ] **Step 2.1: Add a failing `close`-ordering test to `rpc-client.test.ts`**

Replace the top of `extensions/delegate/tests/rpc-client.test.ts` so the `node:child_process` mock is declared before the module under test is imported:

```ts
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MockStream extends EventEmitter {
  writable = true;
  write = vi.fn();
  end = vi.fn(() => {
    this.writable = false;
  });
}

class MockChild extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();
  stdin = new MockStream();
  kill = vi.fn();
}

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

import { parseJsonlBuffer, RPCClient } from "../rpc-client";
```

Then add this test:

```ts
it("emits onExit only after close, after buffered stdout events are delivered", () => {
  const child = new MockChild();
  spawnMock.mockReturnValue(child);
  const calls: string[] = [];

  const client = new RPCClient(
    { model: "test", provider: "test", cwd: "/tmp" },
    {
      onEvent: (event) => calls.push(`event:${String(event.type)}`),
      onExit: () => calls.push("exit"),
      onError: () => calls.push("error"),
    },
  );

  client.start();

  child.emit("exit", 0, null);
  expect(calls).toEqual([]);

  child.stdout.emit("data", Buffer.from('{"type":"agent_end","messages":[]}\n'));
  child.emit("close", 0, null);

  expect(calls).toEqual(["event:agent_end", "exit"]);
});
```

- [ ] **Step 2.2: Run the rpc-client test to verify the ordering failure**

Run:

```bash
cd extensions/delegate
npx vitest run tests/rpc-client.test.ts
```

Expected: FAIL because `RPCClient.start()` currently fires `onExit` from the child's `exit` event.

- [ ] **Step 2.3: Implement `close`-based terminal dispatch in `rpc-client.ts`**

Replace the `exitPromise` setup in `extensions/delegate/rpc-client.ts` with:

```ts
this.exitPromise = new Promise<void>((resolve) => {
  let exitCode: number | null = null;
  let exitSignal: string | null = null;

  this.proc!.once("exit", (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  });

  this.proc!.once("close", (code, signal) => {
    this.exited = true;
    this.callbacks.onExit(exitCode ?? code, exitSignal ?? signal);
    resolve();
  });
});
```

Leave the rest of `send()`, `kill()`, and `sendAndWait()` unchanged.

- [ ] **Step 2.4: Re-run the rpc-client tests and commit**

Run:

```bash
cd extensions/delegate
npx vitest run tests/rpc-client.test.ts
```

Expected: PASS.

Commit:

```bash
git add extensions/delegate/rpc-client.ts extensions/delegate/tests/rpc-client.test.ts
git commit -m "fix(delegate): wait for process close before terminal callbacks"
```

---

### Task 3: Wire `delegate_start` to create the status file and return both artifact paths

**Files:**
- Modify: `extensions/delegate/index.ts:1-300`
- Modify: `extensions/delegate/tests/index.delegate-anchor.test.ts:1-199`
- Modify: `extensions/delegate/tests/index.inherit-context.test.ts:1-244`
- Create: `extensions/delegate/tests/index.delegate-status-start.test.ts`

- [ ] **Step 3.1: Mock visibility in existing delegate-start unit tests and add focused failing tests for start-time status wiring**

First, update `extensions/delegate/tests/index.delegate-anchor.test.ts` and `extensions/delegate/tests/index.inherit-context.test.ts` so they do not create real `.pi/delegate/.../*.status` files once `delegate_start` begins writing `running` immediately.

Add this shared visibility mock to both files:

```ts
const visibilityMocks = vi.hoisted(() => ({
  progressFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.progress.md",
  statusFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.status",
  appendText: vi.fn(),
  appendToolCall: vi.fn(),
  close: vi.fn(),
  writeStatus: vi.fn(),
}));

vi.mock("../visibility", () => ({
  ProgressLogWriter: vi.fn().mockImplementation(() => ({
    appendText: visibilityMocks.appendText,
    appendToolCall: visibilityMocks.appendToolCall,
    close: visibilityMocks.close,
    getFilePath: () => visibilityMocks.progressFile,
  })),
  StatusFileWriter: vi.fn().mockImplementation(() => ({
    writeStatus: visibilityMocks.writeStatus,
    getFilePath: () => visibilityMocks.statusFile,
  })),
}));
```

Then extend `extensions/delegate/tests/index.inherit-context.test.ts` so each pre-launch failure path also asserts the failed status write:

```ts
expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
```

Add that assertion to the missing-anchor, temp-file-write-failure, and missing-session-manager tests.

Then create `extensions/delegate/tests/index.delegate-status-start.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

const managerState = vi.hoisted(() => {
  const entry = {
    taskId: "w1",
    status: "running",
    params: { task: "Review delegate status files.", model: "gpt-5.5", provider: "openai-codex" },
    startedAt: Date.now(),
  };

  return {
    entry,
    canStart: vi.fn(() => true),
    activeWorkerDescriptions: vi.fn(() => []),
    nextTaskId: vi.fn(() => "w1"),
    register: vi.fn(() => entry),
    get: vi.fn(() => entry),
    setStatus: vi.fn(() => true),
    disposeAll: vi.fn(async () => {}),
  };
});

const rpcClientState = vi.hoisted(() => ({
  start: vi.fn(),
  send: vi.fn(),
  sendAndWait: vi.fn(async () => null as unknown),
  kill: vi.fn(async () => {}),
  closeStdin: vi.fn(),
  isAlive: vi.fn(() => true),
}));

const visibilityState = vi.hoisted(() => ({
  progressFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.progress.md",
  statusFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.status",
  writeStatus: vi.fn(),
  appendText: vi.fn(),
  appendToolCall: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../worker-manager", () => ({
  WorkerManager: vi.fn().mockImplementation(() => ({
    canStart: managerState.canStart,
    activeWorkerDescriptions: managerState.activeWorkerDescriptions,
    nextTaskId: managerState.nextTaskId,
    register: managerState.register,
    get: managerState.get,
    setStatus: managerState.setStatus,
    disposeAll: managerState.disposeAll,
  })),
}));

vi.mock("../rpc-client", () => ({
  RPCClient: vi.fn().mockImplementation(() => ({
    start: rpcClientState.start,
    send: rpcClientState.send,
    sendAndWait: rpcClientState.sendAndWait,
    kill: rpcClientState.kill,
    closeStdin: rpcClientState.closeStdin,
    isAlive: rpcClientState.isAlive,
  })),
}));

vi.mock("../visibility", () => ({
  ProgressLogWriter: vi.fn().mockImplementation(() => ({
    appendText: visibilityState.appendText,
    appendToolCall: visibilityState.appendToolCall,
    close: visibilityState.close,
    getFilePath: () => visibilityState.progressFile,
  })),
  StatusFileWriter: vi.fn().mockImplementation(() => ({
    writeStatus: visibilityState.writeStatus,
    getFilePath: () => visibilityState.statusFile,
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
  }>;
};

function createFakePi() {
  const registeredTools: RegisteredTool[] = [];

  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;

  return {
    pi,
    getTool: (name: string) => registeredTools.find((tool) => tool.name === name),
  };
}

describe("delegate_start status file details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerState.entry.status = "running";
    managerState.entry.startedAt = Date.now();
    managerState.setStatus.mockReturnValue(true);
    rpcClientState.start.mockImplementation(() => undefined);
  });

  it("returns progress_file and status_file details and writes running before start", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start")!;
    const result = await tool.execute("call-1", {
      task: "Review delegate status files.",
      model: "gpt-5.5",
      provider: "openai-codex",
    });

    expect(result.details).toEqual({
      task_id: "w1",
      status: "running",
      progress_file: visibilityState.progressFile,
      status_file: visibilityState.statusFile,
    });
    expect(visibilityState.writeStatus).toHaveBeenCalledWith("running");
    expect(visibilityState.writeStatus.mock.invocationCallOrder[0]).toBeLessThan(
      rpcClientState.start.mock.invocationCallOrder[0],
    );
    expect(rpcClientState.send).toHaveBeenCalledWith({
      type: "prompt",
      message: "Review delegate status files.",
    });
  });

  it("writes failed if rpcClient.start throws", async () => {
    rpcClientState.start.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start")!;

    await expect(
      tool.execute("call-1", {
        task: "Review delegate status files.",
        model: "gpt-5.5",
        provider: "openai-codex",
      }),
    ).rejects.toThrow("Failed to start worker w1: spawn failed");

    expect(managerState.setStatus).toHaveBeenCalledWith("w1", "failed", "spawn failed");
    expect(visibilityState.writeStatus).toHaveBeenCalledWith("failed");
  });

  it("writes failed if the initial prompt send throws", async () => {
    rpcClientState.send.mockImplementationOnce(() => {
      throw new Error("send failed");
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start")!;

    await expect(
      tool.execute("call-1", {
        task: "Review delegate status files.",
        model: "gpt-5.5",
        provider: "openai-codex",
      }),
    ).rejects.toThrow("Failed to start worker w1: send failed");

    expect(managerState.setStatus).toHaveBeenCalledWith("w1", "failed", "send failed");
    expect(visibilityState.writeStatus).toHaveBeenCalledWith("failed");
  });
});
```

- [ ] **Step 3.2: Run the new start-status test file to verify it fails**

Run:

```bash
cd extensions/delegate
npx vitest run tests/index.delegate-anchor.test.ts tests/index.inherit-context.test.ts tests/index.delegate-status-start.test.ts
```

Expected: FAIL because `delegate_start` does not yet instantiate `StatusFileWriter`, write `running`, write failed status on pre-launch failures, or return the two artifact paths.

- [ ] **Step 3.3: Implement start-time status writer plumbing in `index.ts`**

Make these changes in `extensions/delegate/index.ts`.

1. Update imports:

```ts
import { ProgressLogWriter, StatusFileWriter } from "./visibility";
import type { DelegateStartParams, WorkerStatus } from "./types";
```

2. Add a helper near `todayDate()`:

```ts
function statusFromAgentEndMessages(messages: unknown[] | undefined): WorkerStatus {
  if (!Array.isArray(messages)) return "completed";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; stopReason?: string };
    if (message.role !== "assistant") continue;
    if (message.stopReason === "aborted") return "aborted";
    if (message.stopReason === "error") return "failed";
    return "completed";
  }

  return "completed";
}
```

3. Inside `delegate_start`, right after the `ProgressLogWriter` is created, instantiate and store the status writer:

```ts
const statusWriter = new StatusFileWriter(projectRoot, todayDate(), sessionId, taskId);
entry.statusWriter = statusWriter;
```

4. Add a local helper in `delegate_start` that gates file writes on in-memory transition success:

```ts
const transitionWorker = (status: WorkerStatus, error?: string): boolean => {
  const applied = manager.setStatus(taskId, status, error);
  if (applied) {
    statusWriter.writeStatus(status);
  }
  return applied;
};
```

5. Use that helper for pre-launch failures:

```ts
const msg = err instanceof Error ? err.message : String(err);
transitionWorker("failed", msg);
tryCloseLogWriter();
throw new Error(msg);
```

6. Write the initial `running` status immediately before `rpcClient.start()` and return both file paths on success:

```ts
statusWriter.writeStatus("running");
rpcClient.start();
rpcClient.send({ type: "prompt", message: params.task });
```

Return:

```ts
return {
  content: [{ type: "text" as const, text: `Worker ${taskId} started. Use delegate_check("${taskId}") to monitor progress.` }],
  details: {
    task_id: taskId,
    status: "running",
    progress_file: logWriter.getFilePath(),
    status_file: statusWriter.getFilePath(),
  },
};
```

7. Replace the `catch` block around `rpcClient.start()` / `send()` with:

```ts
} catch (err) {
  tryCleanupTempFile();
  const message = err instanceof Error ? err.message : String(err);
  transitionWorker("failed", message);
  tryCloseLogWriter();
  throw new Error(`Failed to start worker ${taskId}: ${message}`);
}
```

- [ ] **Step 3.4: Re-run the start-status tests and commit**

Run:

```bash
cd extensions/delegate
npx vitest run tests/index.delegate-anchor.test.ts tests/index.inherit-context.test.ts tests/index.delegate-status-start.test.ts
```

Expected: PASS.

Commit:

```bash
git add extensions/delegate/index.ts extensions/delegate/tests/index.delegate-anchor.test.ts extensions/delegate/tests/index.inherit-context.test.ts extensions/delegate/tests/index.delegate-status-start.test.ts
git commit -m "feat(delegate): add start-time status file wiring"
```

---

### Task 4: Cover terminal lifecycle regressions in `index.ts`

**Files:**
- Modify: `extensions/delegate/index.ts:233-299,462-488`
- Create: `extensions/delegate/tests/index.delegate-status-lifecycle.test.ts`

- [ ] **Step 4.1: Add failing lifecycle tests for `agent_end`, `onError`, timeout, and terminal non-regression**

Create `extensions/delegate/tests/index.delegate-status-lifecycle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

const managerState = vi.hoisted(() => {
  const entry = {
    taskId: "w1",
    status: "running",
    params: { task: "Do work.", model: "gpt-5.5", provider: "openai-codex" },
    startedAt: Date.now(),
    timeoutTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  };

  return {
    entry,
    canStart: vi.fn(() => true),
    activeWorkerDescriptions: vi.fn(() => []),
    nextTaskId: vi.fn(() => "w1"),
    register: vi.fn(() => entry),
    get: vi.fn(() => entry),
    setStatus: vi.fn(() => true),
    disposeAll: vi.fn(async () => {}),
  };
});

const rpcClientState = vi.hoisted(() => ({
  start: vi.fn(),
  send: vi.fn(),
  sendAndWait: vi.fn(async () => null as unknown),
  kill: vi.fn(async () => {}),
  closeStdin: vi.fn(),
  isAlive: vi.fn(() => true),
}));

const visibilityState = vi.hoisted(() => ({
  writeStatus: vi.fn(),
  appendText: vi.fn(),
  appendToolCall: vi.fn(),
  close: vi.fn(),
}));

const callbackState = vi.hoisted(() => ({
  onEvent: undefined as ((event: Record<string, unknown>) => void) | undefined,
  onExit: undefined as ((code: number | null, signal: string | null) => void) | undefined,
  onError: undefined as ((err: string) => void) | undefined,
}));

vi.mock("../worker-manager", () => ({
  WorkerManager: vi.fn().mockImplementation(() => ({
    canStart: managerState.canStart,
    activeWorkerDescriptions: managerState.activeWorkerDescriptions,
    nextTaskId: managerState.nextTaskId,
    register: managerState.register,
    get: managerState.get,
    setStatus: managerState.setStatus,
    disposeAll: managerState.disposeAll,
  })),
}));

vi.mock("../rpc-client", () => ({
  RPCClient: vi.fn().mockImplementation((_options, callbacks) => {
    callbackState.onEvent = callbacks.onEvent;
    callbackState.onExit = callbacks.onExit;
    callbackState.onError = callbacks.onError;
    return {
      start: rpcClientState.start,
      send: rpcClientState.send,
      sendAndWait: rpcClientState.sendAndWait,
      kill: rpcClientState.kill,
      closeStdin: rpcClientState.closeStdin,
      isAlive: rpcClientState.isAlive,
    };
  }),
}));

vi.mock("../visibility", () => ({
  ProgressLogWriter: vi.fn().mockImplementation(() => ({
    appendText: visibilityState.appendText,
    appendToolCall: visibilityState.appendToolCall,
    close: visibilityState.close,
    getFilePath: () => "/tmp/w1.progress.md",
  })),
  StatusFileWriter: vi.fn().mockImplementation(() => ({
    writeStatus: visibilityState.writeStatus,
    getFilePath: () => "/tmp/w1.status",
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
  }>;
};

function createFakePi() {
  const registeredTools: RegisteredTool[] = [];

  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;

  return {
    pi,
    getTool: (name: string) => registeredTools.find((tool) => tool.name === name),
  };
}

describe("delegate status lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    managerState.entry.status = "running";
    managerState.entry.startedAt = Date.now();
    managerState.setStatus.mockReturnValue(true);
    rpcClientState.start.mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["stop", "completed"],
    ["aborted", "aborted"],
    ["error", "failed"],
  ])("maps agent_end stopReason %s to %s", async (stopReason, expectedStatus) => {
    const fake = createFakePi();
    delegate(fake.pi);

    await fake.getTool("delegate_start")!.execute("call-start", {
      task: "Do work.",
      model: "gpt-5.5",
      provider: "openai-codex",
      timeout: 60,
    });

    callbackState.onEvent?.({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason, content: [] }],
    });

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", expectedStatus, undefined);
    expect(visibilityState.writeStatus).toHaveBeenLastCalledWith(expectedStatus);
    expect(rpcClientState.closeStdin).toHaveBeenCalledTimes(1);
    expect(visibilityState.close).toHaveBeenCalledTimes(1);
  });

  it("writes failed on transport errors while the worker is still running", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    await fake.getTool("delegate_start")!.execute("call-start", {
      task: "Do work.",
      model: "gpt-5.5",
      provider: "openai-codex",
      timeout: 60,
    });

    callbackState.onError?.("stderr pipe broke");

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", "failed", "stderr pipe broke");
    expect(visibilityState.writeStatus).toHaveBeenLastCalledWith("failed");
  });

  it("writes aborted and kills the worker on timeout", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    await fake.getTool("delegate_start")!.execute("call-start", {
      task: "Do work.",
      model: "gpt-5.5",
      provider: "openai-codex",
      timeout: 1,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", "aborted", "Timed out after 1s");
    expect(visibilityState.writeStatus).toHaveBeenLastCalledWith("aborted");
    expect(rpcClientState.kill).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite an aborted status when a later agent_end arrives", async () => {
    managerState.setStatus.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const fake = createFakePi();
    delegate(fake.pi);

    await fake.getTool("delegate_start")!.execute("call-start", {
      task: "Do work.",
      model: "gpt-5.5",
      provider: "openai-codex",
      timeout: 60,
    });

    await fake.getTool("delegate_abort")!.execute("call-abort", { task_id: "w1" });

    callbackState.onEvent?.({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "stop", content: [] }],
    });

    expect(visibilityState.writeStatus.mock.calls).toEqual([
      ["running"],
      ["aborted"],
    ]);
  });
});
```

- [ ] **Step 4.2: Run the lifecycle test file to verify it fails**

Run:

```bash
cd extensions/delegate
npx vitest run tests/index.delegate-status-lifecycle.test.ts
```

Expected: FAIL because `index.ts` still hard-codes `completed` on `agent_end`, does not gate terminal file writes on successful transitions, and does not write status on `onError` / timeout / manual abort.

- [ ] **Step 4.3: Implement lifecycle-gated status writes in `index.ts`**

Make these exact changes in `extensions/delegate/index.ts`.

1. In the `onEvent` callback, replace the `agent_end` branch with:

```ts
if (event.type === "agent_end") {
  const nextStatus = statusFromAgentEndMessages((event as { messages?: unknown[] }).messages);
  transitionWorker(nextStatus);
  rpcClient.closeStdin();
  tryCloseLogWriter();
  if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
}
```

2. In `onExit`, gate the failed write through `transitionWorker` and always clean up timers/log state:

```ts
onExit(code, _signal) {
  tryCleanupTempFile();
  transitionWorker("failed", `Process exited unexpectedly (code ${code})`);
  tryCloseLogWriter();
  if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
}
```

3. In `onError`, do the same:

```ts
onError(err) {
  tryCleanupTempFile();
  transitionWorker("failed", err);
  tryCloseLogWriter();
  if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
}
```

4. In the timeout callback, only kill the worker when the abort transition actually applied:

```ts
entry.timeoutTimer = setTimeout(async () => {
  const applied = transitionWorker("aborted", `Timed out after ${timeout}s`);
  if (applied) {
    await rpcClient.kill();
  }
  tryCloseLogWriter();
}, timeout * 1000);
```

5. In `delegate_abort`, replace the terminal transition block with:

```ts
const applied = manager.setStatus(params.task_id, "aborted", "Aborted by orchestrator");
if (!applied) {
  return {
    content: [{ type: "text" as const, text: `Worker ${params.task_id} is already ${entry.status}.` }],
    details: { success: false },
  };
}

entry.statusWriter?.writeStatus("aborted");
if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);

if (entry.rpcClient) {
  await entry.rpcClient.kill();
}
entry.logWriter?.close();
```

- [ ] **Step 4.4: Re-run the lifecycle tests and commit**

Run:

```bash
cd extensions/delegate
npx vitest run tests/index.delegate-status-lifecycle.test.ts
```

Expected: PASS.

Commit:

```bash
git add extensions/delegate/index.ts extensions/delegate/tests/index.delegate-status-lifecycle.test.ts
git commit -m "fix(delegate): gate lifecycle status file writes on real transitions"
```

---

### Task 5: Verify the real delegate extension writes status files end-to-end

**Files:**
- Modify: `extensions/delegate/tests/integration.test.ts:1-200`

- [ ] **Step 5.1: Extend the integration test to assert the status file path and file contents**

In `extensions/delegate/tests/integration.test.ts`, add the sibling status path and stronger assertions:

```ts
const statusPath = path.join(logDir, "w1.status");
```

Replace the `startResult.details` expectation with:

```ts
expect(startResult.details).toEqual({
  task_id: "w1",
  status: "running",
  progress_file: logPath,
  status_file: statusPath,
});
```

Right after the start call, add:

```ts
await waitForValue(
  "status file creation",
  () => {
    if (!fs.existsSync(statusPath)) return undefined;
    const content = fs.readFileSync(statusPath, "utf8");
    return content === "running\n" ? content : undefined;
  },
  30_000,
);
```

After the worker completes, add:

```ts
await waitForValue(
  "terminal status file",
  () => {
    if (!fs.existsSync(statusPath)) return undefined;
    const content = fs.readFileSync(statusPath, "utf8");
    return content === "completed\n" ? content : undefined;
  },
  60_000,
);
```

And in `finally`, remove the status file with the log directory cleanup that already exists:

```ts
fs.rmSync(logDir, { recursive: true, force: true });
```

- [ ] **Step 5.2: Run the mandatory unit suite and typecheck**

Run:

```bash
cd extensions/delegate
npm test
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 5.3: Run the optional real-worker integration test if local credentials are already configured**

Run:

```bash
cd extensions/delegate
DELEGATE_INTEGRATION=1 npm test -- tests/integration.test.ts
```

Expected: PASS if the local environment already has a working provider/model configuration for delegate integration tests. If that environment is not configured, the test file remains skipped and this step does not block the branch.

- [ ] **Step 5.4: Commit the verification changes**

```bash
git add extensions/delegate/tests/integration.test.ts
git commit -m "test(delegate): verify status files in integration coverage"
```
