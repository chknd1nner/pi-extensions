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
