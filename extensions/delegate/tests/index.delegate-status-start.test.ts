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
