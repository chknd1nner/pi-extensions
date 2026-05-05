# Context Inheritance & Session Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add context inheritance to `delegate_start`, a `delegate_anchor` tool for session position bookmarking, and a new `extensions/session/` extension exposing `session_entries()`.

**Architecture:** A new `extensions/session/` extension exposes `session_entries()` as a standalone, general-purpose tool with no dependency on delegate. The delegate extension gains an in-factory `anchorMap: Map<string, string | null>`, a `delegate_anchor` tool, an `inherit_context` parameter on `delegate_start`, a `buildSessionSnapshot()` helper in a new `snapshot.ts` file, `sessionPath` in `RPCClientOptions`, and temp-file cleanup wired into `onExit`/`onError` unconditionally.

**Tech Stack:** TypeScript, Vitest, TypeBox, `@mariozechner/pi-coding-agent`, `node:fs`, `node:os`, `node:crypto`

**Spec:** `docs/superpowers/specs/2026-05-04-delegate-context-inheritance-design.md`

---

## File Map

**New**
- `extensions/session/package.json`
- `extensions/session/tsconfig.json`
- `extensions/session/index.ts`
- `extensions/session/tests/index.session-entries.test.ts`
- `extensions/delegate/snapshot.ts`
- `extensions/delegate/tests/snapshot.test.ts`
- `extensions/delegate/tests/index.delegate-anchor.test.ts`
- `extensions/delegate/tests/index.inherit-context.test.ts`

**Modified**
- `extensions/delegate/types.ts` — add `inherit_context?: boolean | string` to `DelegateStartParams`
- `extensions/delegate/worker-manager.ts` — add `tempFilePath?: string` to `WorkerEntry`
- `extensions/delegate/rpc-client.ts` — add `sessionPath?` to `RPCClientOptions`, expose `buildArgs()` as public, swap `--no-session`/`--session`
- `extensions/delegate/index.ts` — add imports, `anchorMap`, `delegate_anchor` tool, update `DELEGATE_TOOLS`, wire `inherit_context` into `delegate_start`, add `tryCleanupTempFile` to `onExit`/`onError`

---

## Task 1: Scaffold `extensions/session/`

**Files:**
- Create: `extensions/session/package.json`
- Create: `extensions/session/tsconfig.json`
- Create: `extensions/session/index.ts`

- [ ] **Step 1.1: Create `extensions/session/package.json`**

```json
{
  "name": "session-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "typebox": "latest",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 1.2: Create `extensions/session/tsconfig.json`**

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

- [ ] **Step 1.3: Create stub `extensions/session/index.ts`**

```typescript
import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function session(pi: ExtensionAPI) {
  pi.registerTool({
    name: "session_entries",
    label: "Session Entries",
    description:
      "Return all entries on the current session branch, root to leaf. Use to identify entry IDs for delegate_anchor.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      return {
        content: [{ type: "text" as const, text: "[]" }],
        details: { entries: [] },
      };
    },
  });
}
```

- [ ] **Step 1.4: Install dependencies and typecheck**

```bash
cd extensions/session && npm install && npm run typecheck
```

Expected: no errors.

- [ ] **Step 1.5: Commit**

```bash
cd ../.. && git add extensions/session/
git commit -m "feat(session): scaffold session extension with stub session_entries tool"
```

---

## Task 2: Implement `session_entries()` with unit tests

**Files:**
- Create: `extensions/session/tests/index.session-entries.test.ts`
- Modify: `extensions/session/index.ts`

- [ ] **Step 2.1: Create the tests directory and write the failing tests**

```bash
mkdir -p extensions/session/tests
```

Create `extensions/session/tests/index.session-entries.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import session from "../index";

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
  } as unknown as ExtensionAPI;
  return {
    pi,
    getTool: (name: string) => registeredTools.find((t) => t.name === name),
  };
}

function makeCtx(branch: object[]) {
  return { sessionManager: { getBranch: vi.fn(() => branch) } };
}

describe("session_entries", () => {
  it("registers the session_entries tool", () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    expect(getTool("session_entries")).toBeDefined();
  });

  it("returns an empty array when the branch has no entries", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx([]));
    expect((result.details as { entries: unknown[] }).entries).toEqual([]);
  });

  it("maps a user message entry to the correct shape", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "a1b2c3d4",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:00:00.000Z",
      message: { role: "user", content: "Hello, please read the spec" },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect(entries).toEqual([{
      id: "a1b2c3d4",
      entry_type: "message",
      message_role: "user",
      timestamp: "2026-05-04T10:00:00.000Z",
      preview: "Hello, please read the spec",
    }]);
  });

  it("omits message_role for non-message entries", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "b2c3d4e5",
      type: "compaction",
      parentId: "a1b2c3d4",
      timestamp: "2026-05-04T10:05:00.000Z",
      summary: "User read the spec and sharded tickets",
      tokensBefore: 50000,
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect(entries).toEqual([{
      id: "b2c3d4e5",
      entry_type: "compaction",
      message_role: undefined,
      timestamp: "2026-05-04T10:05:00.000Z",
      preview: "[compaction] User read the spec and sharded tickets",
    }]);
  });

  it("previews model_change entries as provider/modelId", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "c3d4e5f6",
      type: "model_change",
      parentId: "b2c3d4e5",
      timestamp: "2026-05-04T10:10:00.000Z",
      provider: "anthropic",
      modelId: "claude-opus-4-5",
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toBe("anthropic/claude-opus-4-5");
  });

  it("previews assistant messages with only tool calls using [tool: name]", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "d4e5f6g7",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:15:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } }],
      },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toBe("[tool: bash]");
  });

  it("truncates long text previews to 120 characters", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "e5f6g7h8",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:20:00.000Z",
      message: { role: "user", content: "a".repeat(200) },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toHaveLength(120);
  });

  it("serialises entries to JSON in content[0].text", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "a1b2c3d4",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:00:00.000Z",
      message: { role: "user", content: "Hi" },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("a1b2c3d4");
  });
});
```

- [ ] **Step 2.2: Run the tests to confirm they fail**

```bash
cd extensions/session && npm test
```

Expected: FAIL — stub returns `[]` and doesn't shape entries.

- [ ] **Step 2.3: Implement `session_entries()` in `extensions/session/index.ts`**

```typescript
import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type SessionEntry = Record<string, unknown>;

function buildPreview(entry: SessionEntry): string {
  const type = entry.type as string;

  if (type === "message") {
    const msg = entry.message as { role: string; content: unknown };
    const { content } = msg;
    if (typeof content === "string") return content.slice(0, 120);
    if (Array.isArray(content)) {
      const textBlock = content.find((b) => (b as { type: string }).type === "text") as
        | { text?: string }
        | undefined;
      if (textBlock?.text) return textBlock.text.slice(0, 120);
      const toolCall = content.find((b) => (b as { type: string }).type === "toolCall") as
        | { name?: string }
        | undefined;
      if (Array.isArray(content)) {
        const toolCalls = content.filter((b) => (b as { type: string }).type === "toolCall") as
          Array<{ name?: string }>;
        if (toolCalls.length > 0) {
          return `[tool: ${toolCalls.map((t) => t.name ?? "unknown").join(", ")}]`;
        }
      }
    }
    return "";
  }

  if (type === "compaction") {
    return `[compaction] ${((entry.summary as string) ?? "").slice(0, 100)}`;
  }
  if (type === "model_change") return `${entry.provider}/${entry.modelId}`;
  if (type === "thinking_level_change") return `thinking: ${entry.thinkingLevel}`;
  if (type === "label") return `label "${entry.label}" on ${entry.targetId}`;
  if (type === "session_info") return `name: ${entry.name}`;
  if (type === "branch_summary") {
    return `[branch_summary] ${((entry.summary as string) ?? "").slice(0, 100)}`;
  }
  if (type === "custom_message") {
    const content = entry.content;
    if (typeof content === "string") return content.slice(0, 120);
    if (Array.isArray(content)) {
      const textBlock = content.find((b) => (b as { type: string }).type === "text") as
        | { text?: string }
        | undefined;
      if (textBlock?.text) return textBlock.text.slice(0, 120);
    }
  }
  return "";
}

export default function session(pi: ExtensionAPI) {
  pi.registerTool({
    name: "session_entries",
    label: "Session Entries",
    description:
      "Return all entries on the current session branch, root to leaf. Use to identify entry IDs for delegate_anchor.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionManager = (ctx as { sessionManager: { getBranch(): SessionEntry[] } })
        .sessionManager;
      const branch = sessionManager.getBranch();

      const entries = branch.map((entry) => ({
        id: entry.id as string,
        entry_type: entry.type as string,
        message_role:
          entry.type === "message"
            ? ((entry.message as { role: string }).role as string)
            : undefined,
        timestamp: entry.timestamp as string,
        preview: buildPreview(entry),
      }));

      const text = JSON.stringify(entries, null, 2);
      return {
        content: [{ type: "text" as const, text }],
        details: { entries },
      };
    },
  });
}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
cd extensions/session && npm test
```

Expected: all 8 tests PASS.

- [ ] **Step 2.5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2.6: Commit**

```bash
cd ../.. && git add extensions/session/
git commit -m "feat(session): implement session_entries with type-aware previews"
```

---

## Task 3: Add `sessionPath` to `RPCClientOptions` and expose `buildArgs()`

**Files:**
- Modify: `extensions/delegate/rpc-client.ts`
- Modify: `extensions/delegate/tests/rpc-client.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Append to `extensions/delegate/tests/rpc-client.test.ts`:

```typescript
describe("RPCClient.buildArgs", () => {
  it("emits --no-session when sessionPath is not set", () => {
    const client = new RPCClient(
      { model: "claude-sonnet-4-5", provider: "anthropic", cwd: "/tmp" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    expect(args).toContain("--no-session");
    expect(args).not.toContain("--session");
  });

  it("emits --session <path> when sessionPath is set", () => {
    const client = new RPCClient(
      { model: "claude-sonnet-4-5", provider: "anthropic", cwd: "/tmp", sessionPath: "/tmp/snap.jsonl" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    const idx = args.indexOf("--session");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/tmp/snap.jsonl");
    expect(args).not.toContain("--no-session");
  });

  it("always includes --model and --provider", () => {
    const client = new RPCClient(
      { model: "gpt-5.4", provider: "github-copilot", cwd: "/tmp" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.4");
    expect(args[args.indexOf("--provider") + 1]).toBe("github-copilot");
  });

  it("includes --thinking when set", () => {
    const client = new RPCClient(
      { model: "m", provider: "p", cwd: "/tmp", thinking: "high" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    expect(args[args.indexOf("--thinking") + 1]).toBe("high");
  });
});
```

- [ ] **Step 3.2: Run to confirm the tests fail**

```bash
cd extensions/delegate && npm test -- rpc-client
```

Expected: FAIL — `buildArgs` is private and not callable from outside.

- [ ] **Step 3.3: Update `extensions/delegate/rpc-client.ts`**

Add `sessionPath?: string` to `RPCClientOptions`:

```typescript
export type RPCClientOptions = {
  model: string;
  provider: string;
  thinking?: string;
  tools?: string[];
  systemPrompt?: string;
  cwd: string;
  allToolNames?: string[];
  deniedTools?: string[];
  sessionPath?: string;
};
```

Change `private buildArgs()` to `buildArgs()` (remove `private`) and swap the session flag logic:

```typescript
  buildArgs(): string[] {
    const args = [
      "--mode", "rpc",
      "--model", this.options.model,
      "--provider", this.options.provider,
    ];
    if (this.options.sessionPath) {
      args.push("--session", this.options.sessionPath);
    } else {
      args.push("--no-session");
    }
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
    if (this.options.systemPrompt) {
      args.push("--append-system-prompt", this.options.systemPrompt);
    }
    return args;
  }
```

- [ ] **Step 3.4: Run tests to confirm they pass**

```bash
cd extensions/delegate && npm test -- rpc-client
```

Expected: all tests PASS.

- [ ] **Step 3.5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3.6: Commit**

```bash
cd ../.. && git add extensions/delegate/rpc-client.ts extensions/delegate/tests/rpc-client.test.ts
git commit -m "feat(delegate): add sessionPath to RPCClientOptions, expose buildArgs() as public"
```

---

## Task 4: Extract `buildSessionSnapshot()` helper

**Files:**
- Create: `extensions/delegate/snapshot.ts`
- Create: `extensions/delegate/tests/snapshot.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `extensions/delegate/tests/snapshot.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "fixed-test-uuid"),
}));

import { buildSessionSnapshot } from "../snapshot";

function makeMgr(branch: object[]) {
  return { getBranch: vi.fn((_fromId?: string) => branch) };
}

describe("buildSessionSnapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("first line is a fresh session header with correct fields", () => {
    const mgr = makeMgr([]);
    const output = buildSessionSnapshot(mgr, "/workspace/project", null);
    const header = JSON.parse(output.trim().split("\n")[0]);
    expect(header.type).toBe("session");
    expect(header.version).toBe(3);
    expect(header.id).toBe("fixed-test-uuid");
    expect(header.cwd).toBe("/workspace/project");
    expect(header.timestamp).toBe("2026-05-04T12:00:00.000Z");
  });

  it("uses workerCwd in header, not any inherited cwd", () => {
    const mgr = makeMgr([]);
    const output = buildSessionSnapshot(mgr, "/worker/dir", null);
    expect(JSON.parse(output.trim().split("\n")[0]).cwd).toBe("/worker/dir");
  });

  it("produces only the header line when anchorEntryId is null", () => {
    const mgr = makeMgr([]);
    const output = buildSessionSnapshot(mgr, "/workspace", null);
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(mgr.getBranch).not.toHaveBeenCalled();
  });

  it("appends branch entries after the header when anchorEntryId is a string", () => {
    const branch = [
      { id: "root1111", type: "message", parentId: null, timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "node2222", type: "message", parentId: "root1111", timestamp: "2026-01-01T00:00:01.000Z" },
    ];
    const mgr = makeMgr(branch);
    const output = buildSessionSnapshot(mgr, "/workspace", "node2222");
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 entries
    expect(mgr.getBranch).toHaveBeenCalledWith("node2222");
    expect(JSON.parse(lines[1]).id).toBe("root1111");
    expect(JSON.parse(lines[2]).id).toBe("node2222");
  });

  it("output always ends with a trailing newline", () => {
    expect(buildSessionSnapshot(makeMgr([]), "/workspace", null).endsWith("\n")).toBe(true);
  });

  it("every line is valid JSON", () => {
    const branch = [{ id: "aabbccdd", type: "message", parentId: null }];
    const output = buildSessionSnapshot(makeMgr(branch), "/workspace", "aabbccdd");
    for (const line of output.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
```

- [ ] **Step 4.2: Run to confirm the tests fail**

```bash
cd extensions/delegate && npm test -- snapshot
```

Expected: FAIL — module `../snapshot` does not exist.

- [ ] **Step 4.3: Create `extensions/delegate/snapshot.ts`**

```typescript
import { randomUUID } from "node:crypto";

export interface SnapshotSessionManager {
  getBranch(fromId?: string): object[];
}

export function buildSessionSnapshot(
  sessionManager: SnapshotSessionManager,
  workerCwd: string,
  anchorEntryId: string | null,
): string {
  const header = {
    type: "session",
    version: 3,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: workerCwd,
  };

  const lines: string[] = [JSON.stringify(header)];

  if (anchorEntryId !== null) {
    const branch = sessionManager.getBranch(anchorEntryId);
    for (const entry of branch) {
      lines.push(JSON.stringify(entry));
    }
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4.4: Run tests to confirm they pass**

```bash
cd extensions/delegate && npm test -- snapshot
```

Expected: all 6 tests PASS. (Task 4 has 6 test cases.)

- [ ] **Step 4.5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4.6: Commit**

```bash
cd ../.. && git add extensions/delegate/snapshot.ts extensions/delegate/tests/snapshot.test.ts
git commit -m "feat(delegate): add buildSessionSnapshot helper with fresh-header JSONL serialisation"
```

---

## Task 5: Update `types.ts` and `worker-manager.ts`

**Files:**
- Modify: `extensions/delegate/types.ts`
- Modify: `extensions/delegate/worker-manager.ts`

No new tests — type-only changes. Existing tests catch regressions.

- [ ] **Step 5.1: Add `inherit_context` to `DelegateStartParams` in `types.ts`**

```typescript
export type DelegateStartParams = {
  task: string;
  model: string;
  provider: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  denied_tools?: string[];
  timeout?: number;
  visibility?: "log";
  system_prompt?: string;
  cwd?: string;
  inherit_context?: boolean | string;
};
```

- [ ] **Step 5.2: Add `tempFilePath` to `WorkerEntry` in `worker-manager.ts`**

```typescript
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
  tempFilePath?: string;
};
```

- [ ] **Step 5.3: Typecheck and run all tests**

```bash
cd extensions/delegate && npm run typecheck && npm test
```

Expected: no TypeScript errors, all existing tests PASS.

- [ ] **Step 5.4: Commit**

```bash
cd ../.. && git add extensions/delegate/types.ts extensions/delegate/worker-manager.ts
git commit -m "feat(delegate): add inherit_context to DelegateStartParams, tempFilePath to WorkerEntry"
```

---

## Task 6: Add `anchorMap` and `delegate_anchor` tool

**Files:**
- Modify: `extensions/delegate/index.ts`
- Create: `extensions/delegate/tests/index.delegate-anchor.test.ts`

- [ ] **Step 6.1: Write the failing tests**

Create `extensions/delegate/tests/index.delegate-anchor.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

const capturedRpcOptions = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock("../worker-manager", () => ({
  WorkerManager: vi.fn().mockImplementation(() => ({
    canStart: vi.fn(() => true),
    activeWorkerDescriptions: vi.fn(() => []),
    nextTaskId: vi.fn(() => "w1"),
    register: vi.fn(() => ({ taskId: "w1", status: "running", params: {}, startedAt: Date.now() })),
    setStatus: vi.fn(),
    get: vi.fn(),
  })),
}));

vi.mock("../rpc-client", () => ({
  RPCClient: vi.fn().mockImplementation((options: Record<string, unknown>) => {
    capturedRpcOptions.value = options;
    return {
      start: vi.fn(),
      send: vi.fn(),
      kill: vi.fn(async () => {}),
      closeStdin: vi.fn(),
      isAlive: vi.fn(() => true),
    };
  }),
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
    registerTool: (tool: RegisteredTool) => { registeredTools.push(tool); },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;
  return { pi, getTool: (name: string) => registeredTools.find((t) => t.name === name) };
}

function makeCtx({
  leafId = "abc12345" as string | null,
  branch = [{ id: "abc12345" }] as object[],
} = {}) {
  return {
    sessionManager: {
      getLeafId: vi.fn(() => leafId),
      getBranch: vi.fn((_fromId?: string) => branch),
    },
  };
}

describe("delegate_anchor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcOptions.value = null;
  });

  it("registers delegate_anchor", () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    expect(getTool("delegate_anchor")).toBeDefined();
  });

  it("stores current leaf id under 'default' when no args given", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: "abc12345", branch: [{ id: "abc12345" }] });
    const result = await getTool("delegate_anchor")!.execute("c1", {}, undefined, undefined, ctx);
    expect(ctx.sessionManager.getLeafId).toHaveBeenCalled();
    expect(result.details?.name).toBe("default");
    expect(result.details?.entryId).toBe("abc12345");
  });

  it("stores under the given name", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: "abc12345", branch: [{ id: "abc12345" }] });
    const result = await getTool("delegate_anchor")!.execute("c1", { name: "foundation" }, undefined, undefined, ctx);
    expect(result.details?.name).toBe("foundation");
  });

  it("stores null when getLeafId returns null (start of session)", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: null, branch: [] });
    const result = await getTool("delegate_anchor")!.execute("c1", { name: "start" }, undefined, undefined, ctx);
    expect(result.details?.entryId).toBeNull();
    expect(result.details?.entryCount).toBe(0);
  });

  it("stores a valid explicit entry_id", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({
      leafId: "leaf5678",
      branch: [{ id: "root1111" }, { id: "node2222" }, { id: "leaf5678" }],
    });
    const result = await getTool("delegate_anchor")!.execute(
      "c1", { name: "checkpoint", entry_id: "node2222" }, undefined, undefined, ctx,
    );
    expect(result.details?.entryId).toBe("node2222");
  });

  it("throws when explicit entry_id is not on current branch", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: "leaf5678", branch: [{ id: "root1111" }, { id: "leaf5678" }] });
    await expect(
      getTool("delegate_anchor")!.execute("c1", { entry_id: "deadbeef" }, undefined, undefined, ctx),
    ).rejects.toThrow("Entry 'deadbeef' not found on current branch");
  });

  it("reports entry count in the return value", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = {
      sessionManager: {
        getLeafId: vi.fn(() => "c"),
        getBranch: vi.fn((_fromId?: string) => [{ id: "a" }, { id: "b" }, { id: "c" }]),
      },
    };
    const result = await getTool("delegate_anchor")!.execute("c1", { name: "x" }, undefined, undefined, ctx);
    expect(result.details?.entryCount).toBe(3);
  });

  it("filters delegate_anchor from worker tool allowlists", async () => {
    const { pi, getTool } = createFakePi();
    // Include delegate_anchor in getAllTools so the denylist filter has something to act on
    (pi as Record<string, unknown>).getAllTools = () => [
      { name: "read" },
      { name: "bash" },
      { name: "delegate_anchor" },
    ];
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "do stuff", model: "m", provider: "p", tools: ["read", "bash", "delegate_anchor"] },
      undefined, undefined, makeCtx(),
    );

    const tools = capturedRpcOptions.value?.tools as string[] | undefined;
    expect(tools).toContain("read");
    expect(tools).not.toContain("delegate_anchor");
  });
});
```

- [ ] **Step 6.2: Run to confirm the tests fail**

```bash
cd extensions/delegate && npm test -- delegate-anchor
```

Expected: FAIL — `delegate_anchor` is not registered.

- [ ] **Step 6.3: Update `extensions/delegate/index.ts`**

**6.3a — Add new imports** at the top of the file:

```typescript
import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { RPCClient } from "./rpc-client";
import { ProgressAccumulator } from "./progress";
import { ProgressLogWriter } from "./visibility";
import { WorkerManager } from "./worker-manager";
import { buildSessionSnapshot } from "./snapshot";
import type { DelegateStartParams } from "./types";
```

**6.3b — Add `delegate_anchor` to `DELEGATE_TOOLS`:**

```typescript
const DELEGATE_TOOLS = [
  "delegate_start",
  "delegate_check",
  "delegate_steer",
  "delegate_abort",
  "delegate_result",
  "delegate_anchor",
];
```

**6.3c — Add `anchorMap` inside the factory function**, immediately after the `manager` declaration:

```typescript
const anchorMap = new Map<string, string | null>();
```

**6.3d — Register `delegate_anchor`** after the `delegate_start` tool registration block and before `delegate_check`:

```typescript
  pi.registerTool({
    name: "delegate_anchor",
    label: "Delegate Anchor",
    description:
      "Record the current session position as a named anchor for context inheritance. Workers spawned with inherit_context: 'name' will start from this fixed point.",
    promptGuidelines: [
      "Call delegate_anchor after loading specs/tickets and before spawning multiple workers.",
      "Workers spawned with inherit_context: 'name' branch from this fixed point regardless of later orchestrator context growth.",
      "Pass entry_id (from session_entries()) to anchor retroactively at a past entry.",
    ],
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({ description: 'Anchor name (default: "default")', default: "default" }),
      ),
      entry_id: Type.Optional(
        Type.String({
          description:
            "Entry ID to anchor at. Omit to anchor at current leaf. Use session_entries() to discover IDs.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const anchorName = (params.name as string | undefined) ?? "default";
      const sessionManager = (
        ctx as {
          sessionManager: {
            getLeafId(): string | null;
            getBranch(fromId?: string): Array<{ id: string }>;
          };
        }
      ).sessionManager;

      let entryId: string | null;

      if (params.entry_id !== undefined) {
        const branch = sessionManager.getBranch();
        const found = branch.some((e) => e.id === params.entry_id);
        if (!found) {
          throw new Error(
            `Entry '${params.entry_id as string}' not found on current branch. Use session_entries() to list valid IDs.`,
          );
        }
        entryId = params.entry_id as string;
      } else {
        entryId = sessionManager.getLeafId();
      }

      anchorMap.set(anchorName, entryId);

      const entryCount = entryId !== null ? sessionManager.getBranch(entryId).length : 0;

      return {
        content: [
          {
            type: "text" as const,
            text: `Anchor '${anchorName}' set to entry ${entryId ?? "null"} (${entryCount} entries in snapshot).`,
          },
        ],
        details: { name: anchorName, entryId, entryCount },
      };
    },
  });
```

- [ ] **Step 6.4: Run anchor tests to confirm they pass**

```bash
cd extensions/delegate && npm test -- delegate-anchor
```

Expected: all 8 tests PASS.

- [ ] **Step 6.5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6.6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6.7: Commit**

```bash
cd ../.. && git add extensions/delegate/index.ts extensions/delegate/tests/index.delegate-anchor.test.ts
git commit -m "feat(delegate): add anchorMap and delegate_anchor tool with branch-membership validation"
```

---

## Task 7: Wire `inherit_context` into `delegate_start` + add temp file cleanup

**Files:**
- Modify: `extensions/delegate/index.ts`
- Create: `extensions/delegate/tests/index.inherit-context.test.ts`

- [ ] **Step 7.1: Write the failing tests**

Create `extensions/delegate/tests/index.inherit-context.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const managerMocks = vi.hoisted(() => ({
  canStart: vi.fn(() => true),
  activeWorkerDescriptions: vi.fn(() => []),
  nextTaskId: vi.fn(() => "w1"),
  register: vi.fn(() => ({ taskId: "w1", status: "running", params: {}, startedAt: Date.now() })),
  setStatus: vi.fn(),
  get: vi.fn(),
}));

const capturedRpcOptions = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

const rpcMocks = vi.hoisted(() => ({
  start: vi.fn(),
  send: vi.fn(),
  kill: vi.fn(async () => {}),
  closeStdin: vi.fn(),
  isAlive: vi.fn(() => true),
}));

const snapshotMock = vi.hoisted(() => ({
  buildSessionSnapshot: vi.fn(
    () => '{"type":"session","version":3,"id":"t","timestamp":"t","cwd":"/w"}\n',
  ),
}));

const fsMock = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
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
  RPCClient: vi.fn().mockImplementation((options: Record<string, unknown>) => {
    capturedRpcOptions.value = options;
    return {
      start: rpcMocks.start,
      send: rpcMocks.send,
      kill: rpcMocks.kill,
      closeStdin: rpcMocks.closeStdin,
      isAlive: rpcMocks.isAlive,
    };
  }),
}));

vi.mock("../snapshot", () => ({
  buildSessionSnapshot: snapshotMock.buildSessionSnapshot,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: fsMock.writeFileSync, rmSync: fsMock.rmSync };
});

import delegate from "../index";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }>;
};

function createFakePi() {
  const registeredTools: RegisteredTool[] = [];
  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => { registeredTools.push(tool); },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;
  return { pi, getTool: (name: string) => registeredTools.find((t) => t.name === name) };
}

function makeCtx({
  leafId = "abc12345" as string | null,
  branch = [{ id: "abc12345", type: "message" }] as object[],
} = {}) {
  return {
    sessionManager: {
      getLeafId: vi.fn(() => leafId),
      getBranch: vi.fn((_fromId?: string) => branch),
    },
  };
}

describe("delegate_start with inherit_context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcOptions.value = null;
    managerMocks.canStart.mockReturnValue(true);
    managerMocks.nextTaskId.mockReturnValue("w1");
    managerMocks.register.mockReturnValue({
      taskId: "w1", status: "running", params: {}, startedAt: Date.now(),
    });
  });

  it("does not build snapshot when inherit_context is absent", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    await getTool("delegate_start")!.execute(
      "c1", { task: "do stuff", model: "m", provider: "p" },
      undefined, undefined, makeCtx(),
    );
    expect(snapshotMock.buildSessionSnapshot).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(capturedRpcOptions.value?.sessionPath).toBeUndefined();
  });

  it("does not build snapshot when inherit_context is false", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    await getTool("delegate_start")!.execute(
      "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: false },
      undefined, undefined, makeCtx(),
    );
    expect(snapshotMock.buildSessionSnapshot).not.toHaveBeenCalled();
    expect(capturedRpcOptions.value?.sessionPath).toBeUndefined();
  });

  it("builds snapshot from current leaf when inherit_context is true", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: "abc12345" });
    await getTool("delegate_start")!.execute(
      "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: true },
      undefined, undefined, ctx,
    );
    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(
      ctx.sessionManager, expect.any(String), "abc12345",
    );
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    expect(capturedRpcOptions.value?.sessionPath).toBeDefined();
  });

  it("builds snapshot from named anchor when inherit_context is a string", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    // Set the anchor first via delegate_anchor
    const anchorCtx = makeCtx({ leafId: "anchor111", branch: [{ id: "anchor111" }] });
    await getTool("delegate_anchor")!.execute("c0", { name: "foundation" }, undefined, undefined, anchorCtx);

    // Spawn with that anchor
    const ctx = makeCtx();
    await getTool("delegate_start")!.execute(
      "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: "foundation" },
      undefined, undefined, ctx,
    );
    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(
      ctx.sessionManager, expect.any(String), "anchor111",
    );
    expect(capturedRpcOptions.value?.sessionPath).toBeDefined();
  });

  it("throws and marks worker failed when named anchor is not found", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    await expect(
      getTool("delegate_start")!.execute(
        "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: "missing" },
        undefined, undefined, makeCtx(),
      ),
    ).rejects.toThrow("No anchor named 'missing'");
    expect(managerMocks.setStatus).toHaveBeenCalledWith(
      "w1", "failed", expect.stringContaining("missing"),
    );
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("throws and marks worker failed when temp file write fails", async () => {
    fsMock.writeFileSync.mockImplementationOnce(() => { throw new Error("disk full"); });
    const { pi, getTool } = createFakePi();
    delegate(pi);
    await expect(
      getTool("delegate_start")!.execute(
        "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: true },
        undefined, undefined, makeCtx(),
      ),
    ).rejects.toThrow("disk full");
    expect(managerMocks.setStatus).toHaveBeenCalledWith(
      "w1", "failed", expect.stringContaining("disk full"),
    );
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("cleans up partial temp file when writeFileSync fails", async () => {
    fsMock.writeFileSync.mockImplementationOnce(() => { throw new Error("disk full"); });
    const { pi, getTool } = createFakePi();
    delegate(pi);
    await expect(
      getTool("delegate_start")!.execute(
        "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: true },
        undefined, undefined, makeCtx(),
      ),
    ).rejects.toThrow();
    // rmSync should be called with force: true to clean up partial file
    expect(fsMock.rmSync).toHaveBeenCalledWith(expect.stringContaining("pi-worker-"), { force: true });
  });

  it("throws and marks worker failed when sessionManager is unavailable", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    // ctx with no sessionManager — simulates sessionManager unavailable
    const badCtx = {};
    await expect(
      getTool("delegate_start")!.execute(
        "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: true },
        undefined, undefined, badCtx,
      ),
    ).rejects.toThrow();
    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.any(String));
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("resolves null anchor correctly (header-only snapshot, no branch entries)", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    // Set a null anchor (session start)
    const anchorCtx = makeCtx({ leafId: null, branch: [] });
    await getTool("delegate_anchor")!.execute("c0", { name: "start" }, undefined, undefined, anchorCtx);

    // Spawn using null anchor
    const ctx = makeCtx();
    await getTool("delegate_start")!.execute(
      "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: "start" },
      undefined, undefined, ctx,
    );
    // buildSessionSnapshot should be called with null anchorEntryId
    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(
      ctx.sessionManager, expect.any(String), null,
    );
  });

  it("calls rmSync in onExit even when worker status is already completed", async () => {
    let capturedOnExit: ((code: number | null, signal: string | null) => void) | undefined;
    const { RPCClient } = await import("../rpc-client");
    (RPCClient as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (options: Record<string, unknown>, callbacks: { onExit: typeof capturedOnExit }) => {
        capturedRpcOptions.value = options;
        capturedOnExit = callbacks.onExit;
        return {
          start: rpcMocks.start,
          send: rpcMocks.send,
          kill: rpcMocks.kill,
          closeStdin: rpcMocks.closeStdin,
          isAlive: rpcMocks.isAlive,
        };
      },
    );

    const { pi, getTool } = createFakePi();
    delegate(pi);
    await getTool("delegate_start")!.execute(
      "c1", { task: "do stuff", model: "m", provider: "p", inherit_context: true },
      undefined, undefined, makeCtx(),
    );

    // Simulate agent_end having already set status to completed
    managerMocks.get.mockReturnValue({ taskId: "w1", status: "completed" });

    // Fire onExit — cleanup must happen unconditionally despite completed status
    capturedOnExit?.(0, null);
    expect(fsMock.rmSync).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7.2: Run to confirm the tests fail**

```bash
cd extensions/delegate && npm test -- inherit-context
```

Expected: FAIL — `inherit_context` is not yet wired up.

- [ ] **Step 7.3: Update `extensions/delegate/index.ts`**

Make all of the following changes:

**7.3a — Add `inherit_context` to the `delegate_start` TypeBox schema** (add inside the `parameters: Type.Object({...})` block, after the `cwd` entry):

```typescript
      inherit_context: Type.Optional(
        Type.Union([Type.Boolean(), Type.String({ minLength: 1 })], {
          description:
            'false/absent = ephemeral (--no-session). true = inherit current session context. "name" = inherit from named anchor set by delegate_anchor.',
        }),
      ),
```

**7.3b — Rename `_ctx` to `ctx`** in the `delegate_start` execute signature:

```typescript
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
```

**7.3c — Add `tryCleanupTempFile` closure** inside the execute function, immediately after the `tryCloseLogWriter` closure (which is defined after the logWriter setup):

```typescript
      const tryCleanupTempFile = () => {
        if (!entry.tempFilePath) return;
        try {
          rmSync(entry.tempFilePath, { force: true });
        } catch {
          // ignore
        }
      };
```

**7.3d — Add snapshot-building block** after the `tryCleanupTempFile` definition and before the `const rpcClient = new RPCClient(...)` call.

Key design points:
- Use `=== true` / `typeof === "string"` explicit checks — not a truthy guard — so `false` and `undefined` are correctly excluded
- `tmpPath` is declared **before** `writeFileSync` so the catch can clean up a partially-created file even if `entry.tempFilePath` was never set
- The single outer `try/catch` covers `sessionManager` access, `getLeafId()`, anchor lookup, snapshot build, and file write — any failure marks the worker failed and closes the log writer

```typescript
      let sessionPath: string | undefined;

      if (params.inherit_context === true || typeof params.inherit_context === "string") {
        let tmpPath: string | undefined;

        try {
          const sessionManager = (
            ctx as {
              sessionManager: {
                getLeafId(): string | null;
                getBranch(fromId?: string): object[];
              };
            }
          ).sessionManager;

          let anchorEntryId: string | null;

          if (params.inherit_context === true) {
            anchorEntryId = sessionManager.getLeafId();
          } else {
            const anchorName = params.inherit_context as string;
            if (!anchorMap.has(anchorName)) {
              throw new Error(
                `No anchor named '${anchorName}'. Call delegate_anchor({ name: '${anchorName}' }) first.`,
              );
            }
            anchorEntryId = anchorMap.get(anchorName)!;
          }

          tmpPath = `${tmpdir()}/pi-worker-${taskId}-${Date.now()}.jsonl`;
          const snapshot = buildSessionSnapshot(sessionManager, workerCwd, anchorEntryId);
          writeFileSync(tmpPath, snapshot, "utf8");
          entry.tempFilePath = tmpPath;
          sessionPath = tmpPath;
        } catch (err) {
          if (tmpPath) {
            try { rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
          }
          const msg = err instanceof Error ? err.message : String(err);
          manager.setStatus(taskId, "failed", msg);
          tryCloseLogWriter();
          throw new Error(msg);
        }
      }
```

**7.3e — Pass `sessionPath` to `RPCClient`** by adding it to the options object in `new RPCClient({...}, ...)` (alongside `cwd`):

```typescript
          cwd: workerCwd,
          sessionPath,
```

**7.3f — Add `tryCleanupTempFile()` at the top of `onExit` and `onError`** (before any status check in each callback), and also to the **outer startup `try/catch`** that wraps `rpcClient.start()` + `rpcClient.send()`. That catch currently calls `tryCloseLogWriter()` but not `tryCleanupTempFile()` — without it, a synchronous start failure after snapshot creation leaks the temp file:

```typescript
      // Outer startup catch (already exists — add tryCleanupTempFile() call):
      try {
        rpcClient.start();
        rpcClient.send({ type: "prompt", message: params.task });
      } catch (err) {
        tryCleanupTempFile();                                    // ← add this
        manager.setStatus(taskId, "failed", err instanceof Error ? err.message : String(err));
        tryCloseLogWriter();
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to start worker ${taskId}: ${message}`);
      }
```

Callbacks:

```typescript
          onExit(code, _signal) {
            tryCleanupTempFile();
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", `Process exited unexpectedly (code ${code})`);
              tryCloseLogWriter();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onError(err) {
            tryCleanupTempFile();
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", err);
              tryCloseLogWriter();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
```

- [ ] **Step 7.4: Run the inherit-context tests to confirm they pass**

```bash
cd extensions/delegate && npm test -- inherit-context
```

Expected: all 11 tests PASS (6 original + 5 added: partial-write cleanup, sessionManager unavailable, null anchor, onExit-after-completion).

- [ ] **Step 7.5: Run the full test suite**

```bash
npm test
```

Expected: all tests PASS with no regressions.

- [ ] **Step 7.6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7.7: Commit**

```bash
cd ../.. && git add extensions/delegate/index.ts extensions/delegate/tests/index.inherit-context.test.ts
git commit -m "feat(delegate): wire inherit_context into delegate_start with snapshot, temp-file lifecycle, and pre-start failure handling"
```

---

## Self-Review

**Spec coverage:**
- `session_entries()` return shape with `entry_type`, `message_role`, `preview` (incl. multi-tool and block-array custom_message) — Task 2 ✓
- `extensions/session/` as standalone extension — Task 1 ✓
- `delegate_anchor` with `name`, `entry_id`, null-leaf support, branch-membership validation — Task 6 ✓
- `anchorMap: Map<string, string | null>` inside factory — Task 6 ✓
- `delegate_anchor` in `DELEGATE_TOOLS` denylist, verified by behavioural test — Task 6 ✓
- `inherit_context?: boolean | string` with `minLength: 1` — Task 7 ✓
- Explicit type-check branching (`=== true` / `typeof === "string"`, not truthy guard) — Task 7 ✓
- `sessionPath` in `RPCClientOptions` — Task 3 ✓
- `buildSessionSnapshot()` with fresh header, null anchor = header only, `tmpPath` pre-computed before write — Task 4 ✓
- `tempFilePath` on `WorkerEntry` — Task 5 ✓
- `tryCleanupTempFile` at top of `onExit` unconditionally (covers completed + failed + aborted workers) — Task 7 ✓
- `tryCleanupTempFile` in `onError` unconditionally — Task 7 ✓
- `tryCleanupTempFile` in outer startup catch (covers `rpcClient.start()` / `send()` failures) — Task 7 ✓
- Pre-start failure: broad try/catch covers `sessionManager` access, `getLeafId()`, anchor lookup, snapshot, file write — Task 7 ✓
- Pre-start failure: partial temp file cleaned up via pre-computed `tmpPath` in catch — Task 7 ✓
- Pre-start failure: worker never starts (`rpcClient.start()` not called) — Task 7 ✓

**Placeholder scan:** None found.

**Type consistency:**
- `anchorMap: Map<string, string | null>` used consistently in anchor set and delegate_start lookup ✓
- `buildSessionSnapshot(sessionManager, workerCwd, anchorEntryId)` signature matches usage ✓
- `RPCClientOptions.sessionPath?: string` passed through to `buildArgs()` ✓
- `WorkerEntry.tempFilePath?: string` set in delegate_start and read in `tryCleanupTempFile` ✓
- `DelegateStartParams.inherit_context?: boolean | string` matches TypeBox schema ✓

**TDD exceptions acknowledged:**
- Task 1 (scaffold): type-only file creation, no logic to test — typecheck serves as verification
- Task 5 (types): type-only changes, no runtime behaviour — existing tests catch regressions; new fields are exercised by Tasks 6 and 7 tests