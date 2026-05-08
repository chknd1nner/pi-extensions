import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

const capturedRpcOptions = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

const managerMocks = vi.hoisted(() => ({
  canStart: vi.fn(() => true),
  activeWorkerDescriptions: vi.fn(() => []),
  nextTaskId: vi.fn(() => "w1"),
  register: vi.fn(() => ({ taskId: "w1", status: "running", params: {}, startedAt: Date.now() })),
  setStatus: vi.fn(),
  get: vi.fn(),
}));

const rpcClientMocks = vi.hoisted(() => ({
  start: vi.fn(),
  send: vi.fn(),
  kill: vi.fn(async () => {}),
  closeStdin: vi.fn(),
  isAlive: vi.fn(() => true),
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
      start: rpcClientMocks.start,
      send: rpcClientMocks.send,
      kill: rpcClientMocks.kill,
      closeStdin: rpcClientMocks.closeStdin,
      isAlive: rpcClientMocks.isAlive,
    };
  }),
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

function createFakePi(toolNames: string[] = ["read", "bash"]) {
  const registeredTools: RegisteredTool[] = [];

  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => toolNames.map((name) => ({ name })),
  } as unknown as ExtensionAPI;

  return {
    pi,
    getTool: (name: string) => registeredTools.find((tool) => tool.name === name),
  };
}

function makeCtx({
  leafId = "abc12345" as string | null,
  branch = [{ id: "abc12345" }] as Array<{ id: string }>,
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
    const fake = createFakePi();
    delegate(fake.pi);

    expect(fake.getTool("delegate_anchor")).toBeDefined();
  });

  it("stores current leaf id under default when no args given", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const ctx = makeCtx({ leafId: "abc12345", branch: [{ id: "abc12345" }] });
    const result = await fake.getTool("delegate_anchor")!.execute("call-1", {}, undefined, undefined, ctx);

    expect(ctx.sessionManager.getLeafId).toHaveBeenCalled();
    expect(result.details?.name).toBe("default");
    expect(result.details?.entryId).toBe("abc12345");
  });

  it("stores under the given name", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const ctx = makeCtx({ leafId: "abc12345", branch: [{ id: "abc12345" }] });
    const result = await fake.getTool("delegate_anchor")!.execute(
      "call-1",
      { name: "foundation" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details?.name).toBe("foundation");
  });

  it("stores null when getLeafId returns null", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const ctx = makeCtx({ leafId: null, branch: [] });
    const result = await fake.getTool("delegate_anchor")!.execute(
      "call-1",
      { name: "start" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details?.entryId).toBeNull();
    expect(result.details?.entryCount).toBe(0);
  });

  it("stores a valid explicit entry_id", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const ctx = makeCtx({
      leafId: "leaf5678",
      branch: [{ id: "root1111" }, { id: "node2222" }, { id: "leaf5678" }],
    });
    const result = await fake.getTool("delegate_anchor")!.execute(
      "call-1",
      { name: "checkpoint", entry_id: "node2222" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details?.entryId).toBe("node2222");
  });

  it("throws when explicit entry_id is not on current branch", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const ctx = makeCtx({ leafId: "leaf5678", branch: [{ id: "root1111" }, { id: "leaf5678" }] });

    await expect(
      fake.getTool("delegate_anchor")!.execute(
        "call-1",
        { entry_id: "deadbeef" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow("Entry 'deadbeef' not found on current branch");
  });

  it("reports entry count in details", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const ctx = {
      sessionManager: {
        getLeafId: vi.fn(() => "c"),
        getBranch: vi.fn((_fromId?: string) => [{ id: "a" }, { id: "b" }, { id: "c" }]),
      },
    };

    const result = await fake.getTool("delegate_anchor")!.execute(
      "call-1",
      { name: "x" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details?.entryCount).toBe(3);
  });

  it("filters delegate_anchor from worker tool allowlists", async () => {
    const fake = createFakePi(["read", "bash", "delegate_anchor"]);
    delegate(fake.pi);

    await fake.getTool("delegate_start")!.execute(
      "call-1",
      { task: "do stuff", model: "m", provider: "p", tools: ["read", "bash", "delegate_anchor"] },
      undefined,
      undefined,
      makeCtx(),
    );

    const tools = capturedRpcOptions.value?.tools as string[] | undefined;
    expect(tools).toContain("read");
    expect(tools).not.toContain("delegate_anchor");
  });
});
