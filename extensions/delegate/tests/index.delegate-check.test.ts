import { beforeEach, describe, expect, it, vi } from "vitest";
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
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    lastAssistantInput: number | null;
  },
  summary?: Partial<{
    tool_calls: number;
    last_activity_seconds_ago: number;
    recent_activity: string[];
    transcript: string;
  }>,
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
    expect(result.details?.context_usage_percent).toBe(25);
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
      rpcClient: { isAlive: () => false, sendAndWait: rpcClientMocks.sendAndWait },
    });

    const fake = createFakePi(() => ({ contextWindow: 200000 }));
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check")!;
    const result = await tool.execute("call-1", { task_id: "w1" }, undefined, undefined, fake.ctx);

    expect(result.details?.status).toBe("failed");
    expect(result.details?.input_tokens).toBe(800);
    expect(result.details?.output_tokens).toBe(120);
    expect(result.details?.context_usage_percent).toBe(15);
    expect(result.details?.error).toBe("Process exited unexpectedly (code 1)");
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

    const fake = createFakePi(() => undefined);
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check")!;
    const result = await tool.execute("call-1", { task_id: "w1" }, undefined, undefined, fake.ctx);

    expect(result.details?.context_usage_percent).toBeNull();
    expect(result.details?.input_tokens).toBe(100);
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
    const result = await tool.execute(
      "call-1",
      { task_id: "w1", detail: "full" },
      undefined,
      undefined,
      fake.ctx,
    );

    expect(result.content[0].text).toContain("transcript:\nhello world");
  });
});
