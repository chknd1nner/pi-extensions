import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  getStderr: vi.fn(() => ""),
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
      getStderr: rpcClientState.getStderr,
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
    // clearAllMocks clears call history but NOT implementations, so a
    // mockReturnValue set by one test leaks into every later test.
    rpcClientState.getStderr.mockReturnValue("");
    managerState.entry.status = "running";
    managerState.entry.startedAt = Date.now();
    managerState.setStatus.mockReturnValue(true);
    rpcClientState.start.mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function startWorker(fake: ReturnType<typeof createFakePi>) {
    await fake.getTool("delegate_start")!.execute("call-start", {
      task: "Do work.",
      model: "gpt-5.5",
      provider: "openai-codex",
      timeout: 60,
    });
  }

  it.each([
    ["stop", "completed"],
    ["aborted", "aborted"],
    ["error", "failed"],
  ])("maps agent_end stopReason %s to %s once agent_settled arrives", async (stopReason, expectedStatus) => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason, content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", expectedStatus, undefined);
    expect(visibilityState.writeStatus).toHaveBeenLastCalledWith(expectedStatus);
    expect(rpcClientState.closeStdin).toHaveBeenCalledTimes(1);
    expect(visibilityState.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the worker running when agent_end says another run is scheduled", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: true,
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "529 overloaded", content: [] }],
    });

    expect(managerState.setStatus).not.toHaveBeenCalled();
    expect(rpcClientState.closeStdin).not.toHaveBeenCalled();
    expect(visibilityState.writeStatus).toHaveBeenLastCalledWith("running");
  });

  it("finalizes as completed when agent_settled arrives without a preceding agent_end", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", "completed", undefined);
  });

  it("records the assistant errorMessage as the worker error when settling after an error", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "529 overloaded", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", "failed", "529 overloaded");
  });

  it("falls back to the worker stderr when the errored turn carries no message", async () => {
    rpcClientState.getStderr.mockReturnValue("socket hang up");

    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "error", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", "failed", "socket hang up");
  });

  it("logs a retry line to the progress file when a retry is scheduled", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "529 overloaded",
    });

    const retryLines = visibilityState.appendText.mock.calls
      .map(([text]) => text as string)
      .filter((text) => text.includes("[RETRY"));
    expect(retryLines).toEqual(["\n[RETRY 1/3 in 2000ms: 529 overloaded]\n"]);
  });

  it("logs a resolved retry line to the progress file when a retry succeeds", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({ type: "auto_retry_end", success: true, attempt: 2 });

    const retryLines = visibilityState.appendText.mock.calls
      .map(([text]) => text as string)
      .filter((text) => text.includes("[RETRY"));
    expect(retryLines).toEqual(["\n[RETRY resolved after 2 attempts]\n"]);
  });

  it("logs an exhausted retry line to the progress file when retries run out", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: "connection reset",
    });

    const retryLines = visibilityState.appendText.mock.calls
      .map(([text]) => text as string)
      .filter((text) => text.includes("[RETRY"));
    expect(retryLines).toEqual(["\n[RETRY exhausted after 3 attempts: connection reset]\n"]);
  });

  it("writes the failure reason to the progress log when the worker fails", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "529 overloaded", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    const failureLines = visibilityState.appendText.mock.calls
      .map(([text]) => text as string)
      .filter((text) => text.includes("[FAILED"));
    expect(failureLines).toEqual(["\n[FAILED] 529 overloaded\n"]);
  });

  it("reports completed when a retried run succeeds, not the first failed run", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: true,
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "529 overloaded", content: [] }],
    });
    callbackState.onEvent?.({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "529 overloaded",
    });
    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] }],
    });
    callbackState.onEvent?.({ type: "auto_retry_end", success: true, attempt: 1 });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenCalledTimes(1);
    expect(managerState.setStatus).toHaveBeenCalledWith("w1", "completed", undefined);
    const appended = visibilityState.appendText.mock.calls.map(([text]) => text as string);
    expect(appended.filter((text) => text.includes("[FAILED"))).toEqual([]);
  });

  it("reports completed when overflow recovery follows an errored run", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "prompt is too long", content: [] }],
    });

    expect(managerState.setStatus).not.toHaveBeenCalled();
    expect(rpcClientState.closeStdin).not.toHaveBeenCalled();

    callbackState.onEvent?.({ type: "compaction_start", reason: "overflow" });
    callbackState.onEvent?.({ type: "compaction_end", willRetry: true });
    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "stop", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenCalledTimes(1);
    expect(managerState.setStatus).toHaveBeenCalledWith("w1", "completed", undefined);
  });

  it("reports the last run's failure when a continuation fails after a clean run", async () => {
    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "stop", content: [] }],
    });
    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", "failed", "boom");
  });

  it("does not abort the worker after it has settled", async () => {
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
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "stop", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(rpcClientState.kill).not.toHaveBeenCalled();
    expect(managerState.setStatus).toHaveBeenCalledTimes(1);
    expect(managerState.setStatus).toHaveBeenCalledWith("w1", "completed", undefined);
  });

  it("prefers the assistant error message over non-empty stderr", async () => {
    rpcClientState.getStderr.mockReturnValue("unrelated deprecation warning");

    const fake = createFakePi();
    delegate(fake.pi);
    await startWorker(fake);

    callbackState.onEvent?.({
      type: "agent_end",
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "529 overloaded", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(managerState.setStatus).toHaveBeenLastCalledWith("w1", "failed", "529 overloaded");
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

  it("does not overwrite an aborted status when a later agent_settled arrives", async () => {
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
      willRetry: false,
      messages: [{ role: "assistant", stopReason: "stop", content: [] }],
    });
    callbackState.onEvent?.({ type: "agent_settled" });

    expect(visibilityState.writeStatus.mock.calls).toEqual([
      ["running"],
      ["aborted"],
    ]);
  });
});
