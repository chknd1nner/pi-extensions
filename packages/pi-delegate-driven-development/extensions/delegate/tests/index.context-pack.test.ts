import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
  readFileSync: vi.fn(() => "PACK FILE CONTENT"),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

const packMocks = vi.hoisted(() => ({
  resolvePackPath: vi.fn(() => "/resolved/packs/impl.jsonl"),
  parsePackFile: vi.fn(() => ({
    header: { type: "pack", version: 1, name: "impl", timestamp: "t", sources: [] },
    entries: [{ type: "message", id: "pack-0", parentId: null }],
  })),
  buildPackFile: vi.fn(() => ""),
  PACK_NAME_PATTERN: /^[a-z0-9][a-z0-9_-]*$/,
}));

const visibilityMocks = vi.hoisted(() => ({
  progressFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.progress.md",
  statusFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.status",
  appendText: vi.fn(),
  appendToolCall: vi.fn(),
  close: vi.fn(),
  writeStatus: vi.fn(),
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

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: fsMock.writeFileSync,
    rmSync: fsMock.rmSync,
    readFileSync: fsMock.readFileSync,
    existsSync: fsMock.existsSync,
    mkdirSync: fsMock.mkdirSync,
  };
});

vi.mock("../pack", () => ({
  resolvePackPath: packMocks.resolvePackPath,
  parsePackFile: packMocks.parsePackFile,
  buildPackFile: packMocks.buildPackFile,
  PACK_NAME_PATTERN: packMocks.PACK_NAME_PATTERN,
}));

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
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
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

describe("delegate_start context_pack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcOptions.value = null;
    managerMocks.canStart.mockReturnValue(true);
    managerMocks.nextTaskId.mockReturnValue("w1");
    managerMocks.setStatus.mockReturnValue(true);
    managerMocks.register.mockReturnValue({
      taskId: "w1", status: "running", params: {}, startedAt: Date.now(),
    });
    fsMock.readFileSync.mockReturnValue("PACK FILE CONTENT");
    packMocks.resolvePackPath.mockReturnValue("/resolved/packs/impl.jsonl");
    packMocks.parsePackFile.mockReturnValue({
      header: { type: "pack", version: 1, name: "impl", timestamp: "t", sources: [] },
      entries: [{ type: "message", id: "pack-0", parentId: null }],
    });
  });

  it("pack without anchor builds a snapshot from a null manager plus pack entries", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", context_pack: "impl" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(packMocks.resolvePackPath).toHaveBeenCalledWith(expect.any(String), "impl", expect.any(String));
    expect(fsMock.readFileSync).toHaveBeenCalledWith("/resolved/packs/impl.jsonl", "utf8");
    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(
      null,
      expect.any(String),
      null,
      [{ type: "message", id: "pack-0", parentId: null }],
    );
    expect(capturedRpcOptions.value?.sessionPath).toEqual(expect.stringContaining("pi-worker-w1-"));
  });

  it("anchor plus pack passes both the session manager and pack entries", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: "leaf9999" });

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", inherit_context: true, context_pack: "impl" },
      undefined,
      undefined,
      ctx,
    );

    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(
      ctx.sessionManager,
      expect.any(String),
      "leaf9999",
      [{ type: "message", id: "pack-0", parentId: null }],
    );
  });

  it("reports the resolved pack path in details", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    const result = await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", context_pack: "impl" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.details?.context_pack_path).toBe("/resolved/packs/impl.jsonl");
  });

  it("unresolvable pack fails pre-start and does not start the RPC client", async () => {
    packMocks.resolvePackPath.mockImplementationOnce(() => {
      throw new Error("No context pack named 'impl'");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", context_pack: "impl" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow("No context pack named 'impl'");

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.stringContaining("No context pack"));
    expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("corrupt pack file fails pre-start", async () => {
    packMocks.parsePackFile.mockImplementationOnce(() => {
      throw new Error("Unsupported pack version: 2 (expected 1)");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", context_pack: "impl" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow(/pack version/);

    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("no pack and no anchor leaves sessionPath undefined (unchanged behavior)", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(snapshotMock.buildSessionSnapshot).not.toHaveBeenCalled();
    expect(capturedRpcOptions.value?.sessionPath).toBeUndefined();
  });
});

describe("delegate_start system_prompt_file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcOptions.value = null;
    managerMocks.canStart.mockReturnValue(true);
    managerMocks.nextTaskId.mockReturnValue("w1");
    managerMocks.setStatus.mockReturnValue(true);
    managerMocks.register.mockReturnValue({
      taskId: "w1", status: "running", params: {}, startedAt: Date.now(),
    });
    fsMock.readFileSync.mockReturnValue("ROLE PROMPT CONTENT");
  });

  it("reads the file and forwards its content as the RPC systemPrompt", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", system_prompt_file: "refs/implementer-prompt.md" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(fsMock.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("refs/implementer-prompt.md"),
      "utf8",
    );
    expect(capturedRpcOptions.value?.systemPrompt).toBe("ROLE PROMPT CONTENT");
  });

  it("resolves the path against the worker cwd when params.cwd is set", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", cwd: "/worker/tree", system_prompt_file: "refs/p.md" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(fsMock.readFileSync).toHaveBeenCalledWith("/worker/tree/refs/p.md", "utf8");
  });

  it("rejects when both system_prompt and system_prompt_file are set, before registering a worker", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", system_prompt: "inline", system_prompt_file: "refs/p.md" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow(/both 'system_prompt' and 'system_prompt_file'/);

    expect(managerMocks.register).not.toHaveBeenCalled();
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("unreadable file fails the worker pre-start and names the path", async () => {
    fsMock.readFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", system_prompt_file: "refs/missing.md" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow(/refs\/missing\.md/);

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.stringContaining("refs/missing.md"));
    expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("unreadable file cleans up an already-written pack temp file", async () => {
    fsMock.readFileSync
      .mockReturnValueOnce("PACK FILE CONTENT") // pack read succeeds
      .mockImplementationOnce(() => {
        throw new Error("ENOENT"); // system prompt file read fails
      });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", context_pack: "impl", system_prompt_file: "refs/missing.md" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow();

    expect(fsMock.rmSync).toHaveBeenCalledWith(expect.stringContaining("pi-worker-w1-"), { force: true });
  });
});
