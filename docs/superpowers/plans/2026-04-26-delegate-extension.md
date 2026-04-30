# Delegate Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi extension that registers five `delegate_*` tools for spawning, monitoring, steering, and aborting worker agents running as isolated Pi RPC subprocesses.

**Architecture:** Modular extension at `extensions/delegate/`. A worker manager tracks active workers and enforces concurrency. Each worker is a `pi --mode rpc` subprocess wrapped by an RPC client that handles JSONL framing. A progress accumulator consumes the event stream and exposes queryable summaries. A visibility module writes progress logs to disk. All five tools are thin wrappers that route to these modules.

**Tech Stack:** TypeScript, Pi extension API (`@mariozechner/pi-coding-agent`), Typebox schemas, `StringEnum` from `@mariozechner/pi-ai`, `node:child_process` for spawning, vitest for testing.

**Spec:** `docs/superpowers/specs/2026-04-26-delegate-extension-design.md`

---

## File Structure

```
extensions/delegate/
├── index.ts              # Extension entry: resolve project root, register 5 tools
├── rpc-client.ts         # Spawn pi --mode rpc, JSONL framing, send/receive/kill
├── worker-manager.ts     # Track workers, enforce concurrency cap, route tool calls
├── progress.ts           # Accumulate RPC events, expose summary + transcript
├── visibility.ts         # Write progress log to disk
├── types.ts              # Shared interfaces and type definitions
├── package.json
├── tsconfig.json
└── tests/
    ├── rpc-client.test.ts
    ├── worker-manager.test.ts
    ├── progress.test.ts
    └── visibility.test.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `extensions/delegate/package.json`
- Create: `extensions/delegate/tsconfig.json`
- Create: `extensions/delegate/types.ts`
- Create: `extensions/delegate/index.ts` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "delegate-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "@mariozechner/pi-ai": "latest",
    "typebox": "latest",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `types.ts`**

```typescript
export type WorkerStatus = "running" | "completed" | "failed" | "aborted";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type DelegateStartParams = {
  task: string;
  model: string;
  provider: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  denied_tools?: string[];
  timeout?: number;
  visibility?: string;
  system_prompt?: string;
  cwd?: string;
};

export type ToolCallRecord = {
  name: string;
  args: string;
  result?: string;
  startedAt: number;
  endedAt?: number;
};

export type WorkerResult = {
  status: WorkerStatus;
  result: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost?: number;
  };
};

export type RPCCommand = {
  type: string;
  id?: string;
  message?: string;
  [key: string]: unknown;
};

export type RPCEvent = {
  type: string;
  [key: string]: unknown;
};
```

- [ ] **Step 4: Create stub `index.ts`**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function delegate(pi: ExtensionAPI) {
  // Tools will be registered in subsequent tasks
}
```

- [ ] **Step 5: Install dependencies**

Run: `cd extensions/delegate && npm install`
Expected: `node_modules/` created with pi-coding-agent, pi-ai, typebox, typescript, vitest

- [ ] **Step 6: Verify typecheck passes**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add extensions/delegate/package.json extensions/delegate/tsconfig.json extensions/delegate/types.ts extensions/delegate/index.ts
git commit -m "feat(delegate): scaffold extension with types and project config"
```

---

### Task 2: RPC Client — Core JSONL Framing and Process Lifecycle

**Files:**
- Create: `extensions/delegate/rpc-client.ts`
- Create: `extensions/delegate/tests/rpc-client.test.ts`

- [ ] **Step 1: Write failing tests for JSONL parsing**

Create `tests/rpc-client.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseJsonlBuffer, RPCClient } from "../rpc-client";

describe("parseJsonlBuffer", () => {
  it("extracts complete lines and returns remainder", () => {
    const { lines, remainder } = parseJsonlBuffer(
      '{"type":"agent_start"}\n{"type":"message_update"}\npartial'
    );
    expect(lines).toEqual(['{"type":"agent_start"}', '{"type":"message_update"}']);
    expect(remainder).toBe("partial");
  });

  it("returns empty lines for buffer with no newline", () => {
    const { lines, remainder } = parseJsonlBuffer("no-newline-yet");
    expect(lines).toEqual([]);
    expect(remainder).toBe("no-newline-yet");
  });

  it("handles empty buffer", () => {
    const { lines, remainder } = parseJsonlBuffer("");
    expect(lines).toEqual([]);
    expect(remainder).toBe("");
  });

  it("handles trailing newline with no remainder", () => {
    const { lines, remainder } = parseJsonlBuffer('{"type":"done"}\n');
    expect(lines).toEqual(['{"type":"done"}']);
    expect(remainder).toBe("");
  });

  it("splits only on LF, not Unicode line separators", () => {
    const unicodeLine = `{"text":"has   and   inside"}\n`;
    const { lines, remainder } = parseJsonlBuffer(unicodeLine);
    expect(lines).toEqual([`{"text":"has   and   inside"}`]);
    expect(remainder).toBe("");
  });

  it("strips trailing CR from CRLF lines", () => {
    const { lines, remainder } = parseJsonlBuffer('{"type":"ok"}\r\n');
    expect(lines).toEqual(['{"type":"ok"}']);
    expect(remainder).toBe("");
  });
});

describe("RPCClient.sendAndWait", () => {
  it("returns null on timeout when no response arrives", async () => {
    const client = new RPCClient(
      { model: "test", provider: "test", cwd: "/tmp" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    // Don't start — just test sendAndWait returns null when stdin isn't writable
    const result = await client.sendAndWait({ type: "get_session_stats" }, 100);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/delegate && npx vitest run tests/rpc-client.test.ts`
Expected: FAIL — `parseJsonlBuffer` not found

- [ ] **Step 3: Implement `rpc-client.ts`**

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import type { RPCCommand, RPCEvent } from "./types";

export function parseJsonlBuffer(buffer: string): { lines: string[]; remainder: string } {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === "\n") {
      let line = buffer.slice(start, i);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
      start = i + 1;
    }
  }
  return { lines, remainder: buffer.slice(start) };
}

export type RPCClientOptions = {
  model: string;
  provider: string;
  thinking?: string;
  tools?: string[];
  systemPrompt?: string;
  cwd: string;
  allToolNames?: string[];
  deniedTools?: string[];
};

export type RPCClientCallbacks = {
  onEvent: (event: RPCEvent) => void;
  onExit: (code: number | null, signal: string | null) => void;
  onError: (err: string) => void;
};

export class RPCClient {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private stderr = "";
  private exited = false;
  private exitPromise: Promise<void> | null = null;
  private callbacks: RPCClientCallbacks;
  private responseWaiters = new Map<string, (event: RPCEvent) => void>();
  private requestCounter = 0;

  constructor(
    private options: RPCClientOptions,
    callbacks: RPCClientCallbacks,
  ) {
    this.callbacks = callbacks;
  }

  start(): void {
    const args = this.buildArgs();
    this.proc = spawn("pi", args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.exitPromise = new Promise<void>((resolve) => {
      this.proc!.once("exit", (code, signal) => {
        this.exited = true;
        this.callbacks.onExit(code, signal);
        resolve();
      });
    });

    this.proc.on("error", (err) => {
      this.callbacks.onError(err.message);
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      const { lines, remainder } = parseJsonlBuffer(this.buffer);
      this.buffer = remainder;
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as RPCEvent;
          if (event.type === "response" && event.id) {
            const waiter = this.responseWaiters.get(event.id as string);
            if (waiter) {
              waiter(event);
              continue;
            }
          }
          this.callbacks.onEvent(event);
        } catch {
          // skip malformed lines
        }
      }
    });

    this.proc.stderr!.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
      if (this.stderr.length > 10_000) {
        this.stderr = this.stderr.slice(-5_000);
      }
    });
  }

  send(command: RPCCommand): void {
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify(command) + "\n");
  }

  getStderr(): string {
    return this.stderr;
  }

  async kill(): Promise<void> {
    if (!this.proc || this.exited) return;

    // Step 1: RPC abort for clean shutdown
    this.send({ type: "abort" });
    await Promise.race([this.exitPromise, new Promise((r) => setTimeout(r, 2000))]);
    if (this.exited) return;

    // Step 2: Close stdin to trigger process exit
    this.proc.stdin?.end();
    await Promise.race([this.exitPromise, new Promise((r) => setTimeout(r, 2000))]);
    if (this.exited) return;

    // Step 3: SIGTERM
    this.proc.kill("SIGTERM");
    await Promise.race([this.exitPromise, new Promise((r) => setTimeout(r, 3000))]);
    if (this.exited) return;

    // Step 4: SIGKILL
    this.proc.kill("SIGKILL");
  }

  async sendAndWait(command: RPCCommand, timeoutMs = 2000): Promise<RPCEvent | null> {
    const id = `req-${++this.requestCounter}`;
    const cmd = { ...command, id };

    return new Promise<RPCEvent | null>((resolve) => {
      const timer = setTimeout(() => {
        this.responseWaiters.delete(id);
        resolve(null);
      }, timeoutMs);

      this.responseWaiters.set(id, (event) => {
        clearTimeout(timer);
        this.responseWaiters.delete(id);
        resolve(event);
      });

      this.send(cmd);
    });
  }

  closeStdin(): void {
    this.proc?.stdin?.end();
  }

  isAlive(): boolean {
    return this.proc !== null && !this.exited;
  }

  private buildArgs(): string[] {
    const args = [
      "--mode", "rpc",
      "--no-session",
      "--model", this.options.model,
      "--provider", this.options.provider,
    ];
    // Workers load extensions normally so they can use the user's custom tools.
    // delegate_* tools are excluded via the --tools allowlist to prevent recursive delegation.
    if (this.options.thinking) {
      args.push("--thinking", this.options.thinking);
    }
    if (this.options.tools && this.options.tools.length > 0) {
      args.push("--tools", this.options.tools.join(","));
    } else if (this.options.deniedTools && this.options.deniedTools.length > 0 && this.options.allToolNames) {
      const denied = new Set(this.options.deniedTools);
      const allowed = this.options.allToolNames.filter((t) => !denied.has(t));
      if (allowed.length > 0) {
        args.push("--tools", allowed.join(","));
      } else {
        args.push("--no-tools");
      }
    }
    // Workers auto-load AGENTS.md and CLAUDE.md for project context.
    // Role-specific instructions can be addressed via @worker.md references in AGENTS.md.
    if (this.options.systemPrompt) {
      args.push("--append-system-prompt", this.options.systemPrompt);
    }
    return args;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/delegate && npx vitest run tests/rpc-client.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add extensions/delegate/rpc-client.ts extensions/delegate/tests/rpc-client.test.ts
git commit -m "feat(delegate): add RPC client with JSONL framing and process lifecycle"
```

---

### Task 3: Progress Accumulator

**Files:**
- Create: `extensions/delegate/progress.ts`
- Create: `extensions/delegate/tests/progress.test.ts`

- [ ] **Step 1: Write failing tests**

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/delegate && npx vitest run tests/progress.test.ts`
Expected: FAIL — `ProgressAccumulator` not found

- [ ] **Step 3: Implement `progress.ts`**

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/delegate && npx vitest run tests/progress.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add extensions/delegate/progress.ts extensions/delegate/tests/progress.test.ts
git commit -m "feat(delegate): add progress accumulator for RPC event stream"
```

---

### Task 4: Visibility — Progress Log Writer

**Files:**
- Create: `extensions/delegate/visibility.ts`
- Create: `extensions/delegate/tests/visibility.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/visibility.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProgressLogWriter } from "../visibility";

describe("ProgressLogWriter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-vis-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates nested directory structure and writes progress file", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.appendText("Hello world");
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("Hello world");
  });

  it("appends tool call markers", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.appendToolCall("bash", '{"command":"ls"}');
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("[TOOL: bash]");
    expect(content).toContain("ls");
  });

  it("appends multiple writes in order", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.appendText("first ");
    writer.appendText("second");
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    expect(fs.readFileSync(filePath, "utf8")).toBe("first second");
  });

  it("handles close when no writes occurred", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/delegate && npx vitest run tests/visibility.test.ts`
Expected: FAIL — `ProgressLogWriter` not found

- [ ] **Step 3: Implement `visibility.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";

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
    this.filePath = path.join(
      projectRoot, ".pi", "delegate", date, sessionId, `${taskId}.progress.md`,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/delegate && npx vitest run tests/visibility.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add extensions/delegate/visibility.ts extensions/delegate/tests/visibility.test.ts
git commit -m "feat(delegate): add progress log writer for disk visibility"
```

---

### Task 5: Worker Manager

**Files:**
- Create: `extensions/delegate/worker-manager.ts`
- Create: `extensions/delegate/tests/worker-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/worker-manager.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import { WorkerManager } from "../worker-manager";
import type { DelegateStartParams } from "../types";

const baseParams: DelegateStartParams = {
  task: "Review the code",
  model: "claude-sonnet-4-6",
  provider: "anthropic",
};

describe("WorkerManager", () => {
  let manager: WorkerManager;

  beforeEach(() => {
    manager = new WorkerManager({ maxWorkers: 2, projectRoot: "/tmp/test" });
  });

  it("generates sequential task IDs", () => {
    expect(manager.nextTaskId()).toBe("w1");
    expect(manager.nextTaskId()).toBe("w2");
    expect(manager.nextTaskId()).toBe("w3");
  });

  it("tracks a registered worker", () => {
    manager.register("w1", baseParams);
    const worker = manager.get("w1");
    expect(worker).toBeDefined();
    expect(worker!.status).toBe("running");
    expect(worker!.params.task).toBe("Review the code");
  });

  it("returns undefined for unknown task ID", () => {
    expect(manager.get("w99")).toBeUndefined();
  });

  it("reports active worker count", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    expect(manager.activeCount()).toBe(2);
  });

  it("enforces concurrency cap", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    expect(manager.canStart()).toBe(false);
    expect(manager.activeWorkerDescriptions()).toEqual([
      { taskId: "w1", task: "Review the code" },
      { taskId: "w2", task: "Review the code" },
    ]);
  });

  it("allows new workers after one completes", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    manager.setStatus("w1", "completed");
    expect(manager.canStart()).toBe(true);
    expect(manager.activeCount()).toBe(1);
  });

  it("keeps completed workers readable", () => {
    manager.register("w1", baseParams);
    manager.setStatus("w1", "completed");
    const worker = manager.get("w1");
    expect(worker).toBeDefined();
    expect(worker!.status).toBe("completed");
  });

  it("rejects transitions out of terminal states", () => {
    manager.register("w1", baseParams);
    manager.setStatus("w1", "completed");
    manager.setStatus("w1", "running");
    expect(manager.get("w1")!.status).toBe("completed");
  });

  it("reads max workers from env var", () => {
    const envManager = new WorkerManager({ maxWorkers: 2, projectRoot: "/tmp", maxWorkersEnv: "5" });
    for (let i = 1; i <= 5; i++) {
      envManager.register(`w${i}`, baseParams);
    }
    expect(envManager.canStart()).toBe(false);
    expect(envManager.activeCount()).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/delegate && npx vitest run tests/worker-manager.test.ts`
Expected: FAIL — `WorkerManager` not found

- [ ] **Step 3: Implement `worker-manager.ts`**

```typescript
import type { DelegateStartParams, WorkerStatus } from "./types";
import type { RPCClient } from "./rpc-client";
import type { ProgressAccumulator } from "./progress";
import type { ProgressLogWriter } from "./visibility";

export type WorkerEntry = {
  taskId: string;
  status: WorkerStatus;
  params: DelegateStartParams;
  startedAt: number;
  rpcClient?: RPCClient;
  progress?: ProgressAccumulator;
  logWriter?: ProgressLogWriter;
  error?: string;
  timeoutTimer?: ReturnType<typeof setTimeout>;
};

export type WorkerManagerOptions = {
  maxWorkers: number;
  projectRoot: string;
  maxWorkersEnv?: string;
};

export class WorkerManager {
  private workers = new Map<string, WorkerEntry>();
  private counter = 0;
  private maxWorkers: number;
  readonly projectRoot: string;

  constructor(options: WorkerManagerOptions) {
    this.projectRoot = options.projectRoot;
    const envMax = options.maxWorkersEnv;
    if (envMax) {
      const parsed = parseInt(envMax, 10);
      this.maxWorkers = parsed > 0 ? parsed : options.maxWorkers;
    } else {
      this.maxWorkers = options.maxWorkers;
    }
  }

  nextTaskId(): string {
    this.counter++;
    return `w${this.counter}`;
  }

  register(taskId: string, params: DelegateStartParams): WorkerEntry {
    const entry: WorkerEntry = {
      taskId,
      status: "running",
      params,
      startedAt: Date.now(),
    };
    this.workers.set(taskId, entry);
    return entry;
  }

  get(taskId: string): WorkerEntry | undefined {
    return this.workers.get(taskId);
  }

  setStatus(taskId: string, status: WorkerStatus, error?: string): void {
    const entry = this.workers.get(taskId);
    if (!entry) return;
    if (entry.status === "completed" || entry.status === "failed" || entry.status === "aborted") return;
    entry.status = status;
    if (error) entry.error = error;
  }

  activeCount(): number {
    let count = 0;
    for (const entry of this.workers.values()) {
      if (entry.status === "running") count++;
    }
    return count;
  }

  canStart(): boolean {
    return this.activeCount() < this.maxWorkers;
  }

  activeWorkerDescriptions(): { taskId: string; task: string }[] {
    const result: { taskId: string; task: string }[] = [];
    for (const entry of this.workers.values()) {
      if (entry.status === "running") {
        result.push({ taskId: entry.taskId, task: entry.params.task });
      }
    }
    return result;
  }

  async disposeAll(): Promise<void> {
    const kills: Promise<void>[] = [];
    for (const entry of this.workers.values()) {
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
      if (entry.status === "running" && entry.rpcClient) {
        kills.push(entry.rpcClient.kill());
      }
      entry.logWriter?.close();
    }
    await Promise.allSettled(kills);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/delegate && npx vitest run tests/worker-manager.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add extensions/delegate/worker-manager.ts extensions/delegate/tests/worker-manager.test.ts
git commit -m "feat(delegate): add worker manager with concurrency enforcement"
```

---

### Task 6: Wire Up `delegate_start` Tool

**Files:**
- Modify: `extensions/delegate/index.ts`

- [ ] **Step 1: Implement `delegate_start` tool registration in `index.ts`**

Replace the stub `index.ts` with:

```typescript
import { execSync } from "node:child_process";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { RPCClient } from "./rpc-client";
import { ProgressAccumulator } from "./progress";
import { ProgressLogWriter } from "./visibility";
import { WorkerManager } from "./worker-manager";
import type { DelegateStartParams } from "./types";

function resolveGitRoot(cwd: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return cwd;
  }
}

function todayDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

const DELEGATE_TOOLS = ["delegate_start", "delegate_check", "delegate_steer", "delegate_abort", "delegate_result"];

export default function delegate(pi: ExtensionAPI) {
  const initialCwd = process.cwd();
  const projectRoot = resolveGitRoot(initialCwd);

  // Session ID is resolved from ctx.sessionManager inside event handlers.
  // Cached here and updated on each session_start event.
  let sessionId = `run-${Date.now().toString(36)}`;

  pi.on("session_start", async (_event, ctx) => {
    try {
      const id = ctx.sessionManager.getSessionId?.();
      if (id) sessionId = id;
    } catch {}
  });

  const manager = new WorkerManager({
    maxWorkers: 2,
    projectRoot,
    maxWorkersEnv: process.env.DELEGATE_MAX_WORKERS,
  });

  pi.registerTool({
    name: "delegate_start",
    label: "Delegate Start",
    description: "Spawn a worker agent as an isolated Pi RPC subprocess to execute a task.",
    promptSnippet: "Spawn a worker agent to execute a task in an isolated subprocess.",
    promptGuidelines: [
      "Use delegate_start to offload tasks to a worker agent (code review, implementation, research).",
      "The worker runs as a separate Pi process with its own context window.",
      "Check progress with delegate_check, steer with delegate_steer, abort with delegate_abort, read result with delegate_result.",
      "Maximum 2 concurrent workers by default.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Prompt/instructions for the worker" }),
      model: Type.String({ description: 'Model ID, e.g. "claude-sonnet-4-6"' }),
      provider: Type.String({ description: 'Provider ID, e.g. "anthropic", "github-copilot"' }),
      thinking: Type.Optional(
        StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, {
          description: "Thinking level for the worker",
        }),
      ),
      tools: Type.Optional(
        Type.Array(Type.String(), { description: 'Tool allowlist — only these tools enabled. Mutually exclusive with denied_tools.' }),
      ),
      denied_tools: Type.Optional(
        Type.Array(Type.String(), { description: 'Tool deny list — all tools except these. Mutually exclusive with tools. delegate_* tools are always denied.' }),
      ),
      timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds (default 1800)", default: 1800 }),
      ),
      system_prompt: Type.Optional(
        Type.String({ description: "Additional system prompt appended to worker" }),
      ),
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the worker (default: project root)" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (params.tools && params.denied_tools) {
        return {
          content: [{ type: "text" as const, text: "Cannot specify both 'tools' (allowlist) and 'denied_tools' (denylist). Pick one." }],
          details: { error: "invalid_params" },
          isError: true,
        };
      }

      if (!manager.canStart()) {
        const active = manager.activeWorkerDescriptions();
        const desc = active.map((w) => `  ${w.taskId}: ${w.task.slice(0, 80)}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `Cannot start: ${active.length} workers already running.\n\nActive workers:\n${desc}\n\nAbort one with delegate_abort before starting a new task.` }],
          details: { error: "concurrency_limit" },
          isError: true,
        };
      }

      const taskId = manager.nextTaskId();
      const workerCwd = params.cwd ?? projectRoot;
      const timeout = params.timeout ?? 1800;

      // Resolve tool allowlist: always exclude delegate_* tools to prevent recursive delegation.
      let toolsAllowlist: string[] | undefined = params.tools;
      if (toolsAllowlist) {
        toolsAllowlist = toolsAllowlist.filter((t) => !DELEGATE_TOOLS.includes(t));
      }

      // For denied_tools mode, we need the full list of available tool names.
      const allToolNames = pi.getAllTools().map((t) => t.name);
      const deniedTools = params.denied_tools
        ? [...new Set([...params.denied_tools, ...DELEGATE_TOOLS])]
        : DELEGATE_TOOLS;

      const entry = manager.register(taskId, params as DelegateStartParams);

      const progress = new ProgressAccumulator();
      entry.progress = progress;

      const logWriter = new ProgressLogWriter(projectRoot, todayDate(), sessionId, taskId);
      entry.logWriter = logWriter;

      const rpcClient = new RPCClient(
        {
          model: params.model,
          provider: params.provider,
          thinking: params.thinking,
          tools: toolsAllowlist,
          deniedTools: toolsAllowlist ? undefined : deniedTools,
          allToolNames: toolsAllowlist ? undefined : allToolNames,
          systemPrompt: params.system_prompt,
          cwd: workerCwd,
        },
        {
          onEvent(event) {
            progress.handleEvent(event);

            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent as { type: string; delta?: string } | undefined;
              if (ame?.type === "text_delta" && ame.delta) {
                logWriter.appendText(ame.delta);
              }
            } else if (event.type === "tool_execution_start") {
              const args = JSON.stringify(event.args ?? {}).slice(0, 80);
              logWriter.appendToolCall(event.toolName as string, args);
            }

            if (event.type === "agent_end") {
              manager.setStatus(taskId, "completed");
              rpcClient.closeStdin();
              logWriter.close();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onExit(code, _signal) {
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", `Process exited unexpectedly (code ${code})`);
              logWriter.close();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onError(err) {
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", err);
              logWriter.close();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
        },
      );

      entry.rpcClient = rpcClient;
      rpcClient.start();
      rpcClient.send({ type: "prompt", message: params.task });

      entry.timeoutTimer = setTimeout(async () => {
        const current = manager.get(taskId);
        if (current && current.status === "running") {
          manager.setStatus(taskId, "aborted", `Timed out after ${timeout}s`);
          await rpcClient.kill();
          logWriter.close();
        }
      }, timeout * 1000);

      return {
        content: [{ type: "text" as const, text: `Worker ${taskId} started. Use delegate_check("${taskId}") to monitor progress.` }],
        details: { task_id: taskId, status: "running" },
      };
    },
  });

  // Remaining tools (delegate_check, delegate_steer, delegate_abort, delegate_result)
  // are registered in subsequent tasks.
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Smoke test with Pi**

Run: `pi -e extensions/delegate/index.ts --print "What tools do you have that start with delegate?"`
Expected: Pi lists `delegate_start` in its response.

- [ ] **Step 4: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): wire up delegate_start tool with full worker lifecycle"
```

---

### Task 7: Wire Up `delegate_check` Tool

**Files:**
- Modify: `extensions/delegate/index.ts`

- [ ] **Step 1: Add `delegate_check` registration after `delegate_start` in `index.ts`**

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

- [ ] **Step 2: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): add delegate_check tool for worker progress monitoring"
```

---

### Task 8: Wire Up `delegate_steer` and `delegate_abort` Tools

**Files:**
- Modify: `extensions/delegate/index.ts`

- [ ] **Step 1: Add `delegate_steer` registration in `index.ts`**

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
        return {
          content: [{ type: "text" as const, text: `Unknown task ID: ${params.task_id}` }],
          details: {},
          isError: true,
        };
      }

      if (entry.status !== "running") {
        return {
          content: [{ type: "text" as const, text: `Cannot steer ${params.task_id}: worker is ${entry.status}, not running.` }],
          details: { success: false },
          isError: true,
        };
      }

      if (!entry.rpcClient?.isAlive()) {
        return {
          content: [{ type: "text" as const, text: `Cannot steer ${params.task_id}: worker process is not alive.` }],
          details: { success: false },
          isError: true,
        };
      }

      // steer requires active streaming. During compaction the RPC layer may reject it.
      const resp = await entry.rpcClient.sendAndWait({ type: "steer", message: params.message });
      if (resp && (resp as any).success === false) {
        return {
          content: [{ type: "text" as const, text: `Steer rejected by ${params.task_id}: ${(resp as any).error ?? "worker not actively streaming (possibly mid-compaction)"}. Retry shortly.` }],
          details: { success: false },
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Steering message sent to ${params.task_id}.` }],
        details: { success: true },
      };
    },
  });
```

- [ ] **Step 2: Add `delegate_abort` registration in `index.ts`**

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
        return {
          content: [{ type: "text" as const, text: `Unknown task ID: ${params.task_id}` }],
          details: {},
          isError: true,
        };
      }

      if (entry.status !== "running") {
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

- [ ] **Step 3: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): add delegate_steer and delegate_abort tools"
```

---

### Task 9: Wire Up `delegate_result` Tool

**Files:**
- Modify: `extensions/delegate/index.ts`

- [ ] **Step 1: Add `delegate_result` registration in `index.ts`**

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
        return {
          content: [{ type: "text" as const, text: `Unknown task ID: ${params.task_id}` }],
          details: {},
          isError: true,
        };
      }

      if (entry.status === "running") {
        return {
          content: [{ type: "text" as const, text: `Worker ${params.task_id} is still running. Use delegate_check to monitor progress, or delegate_abort to stop it.` }],
          details: {},
          isError: true,
        };
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

- [ ] **Step 2: Remove the comment about remaining tools**

Delete the comment in `index.ts` that says:
```typescript
  // Remaining tools (delegate_check, delegate_steer, delegate_abort, delegate_result)
  // are registered in subsequent tasks.
```

- [ ] **Step 3: Add cleanup on extension unload**

At the end of the `delegate` function, before the closing brace, add:

```typescript
  pi.on("session_shutdown", async () => {
    await manager.disposeAll();
  });
```

- [ ] **Step 4: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): add delegate_result tool, complete all 5 tools"
```

---

### Task 10: Integration Test — Full Delegate Lifecycle

> **Note:** Task 10 was originally "Fix delegate_check Token Stats via RPC Response Handling" — that code has been collapsed into Tasks 2 (sendAndWait on RPCClient) and 7 (delegate_check uses sendAndWait directly).

**Files:**
- Create: `extensions/delegate/tests/integration.test.ts`

This tests the full lifecycle with a real `pi --mode rpc` process. Requires Pi to be installed and a provider to be configured. Mark as skippable in CI.

- [ ] **Step 1: Write integration test**

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

- [ ] **Step 2: Run integration test**

Run: `cd extensions/delegate && DELEGATE_INTEGRATION=1 npx vitest run tests/integration.test.ts`
Expected: PASS (requires working Pi + Anthropic API key)

- [ ] **Step 3: Run all unit tests (integration skipped by default)**

Run: `cd extensions/delegate && npx vitest run`
Expected: All unit tests PASS, integration test SKIPPED

- [ ] **Step 4: Commit**

```bash
git add extensions/delegate/tests/integration.test.ts
git commit -m "test(delegate): add integration test for full worker lifecycle"
```

---

### Task 11: Final Typecheck, Full Test Suite, and Smoke Test

**Files:**
- No new files; verification only.

- [ ] **Step 1: Run full typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run full unit test suite**

Run: `cd extensions/delegate && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Smoke test — load extension in Pi**

Run: `pi -e extensions/delegate/index.ts --print "List all tools whose names start with 'delegate'. For each one, show its name and a one-line description."`
Expected: Pi lists all 5 tools: `delegate_start`, `delegate_check`, `delegate_steer`, `delegate_abort`, `delegate_result`.

- [ ] **Step 4: Smoke test — spawn a real worker**

Run: `pi -e extensions/delegate/index.ts --print "Use delegate_start to spawn a worker with model claude-haiku-4-5, provider anthropic, task: 'Reply with exactly: SMOKE_TEST_OK'. Then wait 10 seconds and use delegate_check to check its status. Then use delegate_result to read the output."`
Expected: Pi spawns the worker, checks it, and reads the result containing `SMOKE_TEST_OK`.

- [ ] **Step 5: Verify progress log file was created**

Run: `ls -la .pi/delegate/$(date +%Y-%m-%d)/`
Expected: A directory with a session subfolder containing a `w1.progress.md` file.

- [ ] **Step 6: Commit (if any adjustments were needed)**

```bash
git add -A extensions/delegate/
git commit -m "fix(delegate): adjustments from smoke testing"
```

Only commit if changes were made during smoke testing. If everything passed clean, no commit needed.
