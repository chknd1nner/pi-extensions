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
  disposeAll: vi.fn(async () => {}),
}));

vi.mock("../worker-manager", () => ({
  WorkerManager: vi.fn().mockImplementation(() => ({
    canStart: managerMocks.canStart,
    activeWorkerDescriptions: managerMocks.activeWorkerDescriptions,
    nextTaskId: managerMocks.nextTaskId,
    register: managerMocks.register,
    setStatus: managerMocks.setStatus,
    get: managerMocks.get,
    disposeAll: managerMocks.disposeAll,
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

type RegisteredEventHandlers = {
  session_shutdown?: Array<() => Promise<void> | void>;
};

function createFakePi() {
  const registeredTools: RegisteredTool[] = [];
  const eventHandlers: RegisteredEventHandlers = {};

  const pi = {
    on: (event: string, handler: () => Promise<void> | void) => {
      if (event === "session_shutdown") {
        eventHandlers.session_shutdown ??= [];
        eventHandlers.session_shutdown.push(handler);
      }
    },
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;

  return {
    pi,
    getTool: (name: string) => registeredTools.find((tool) => tool.name === name),
    async shutdown() {
      for (const handler of eventHandlers.session_shutdown ?? []) {
        await handler();
      }
    },
  };
}

describe("delegate_result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers delegate_result", () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_result");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("delegate_result");
  });

  it("throws for unknown task IDs", async () => {
    managerMocks.get.mockReturnValue(undefined);

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_result");
    expect(tool).toBeDefined();

    await expect(tool!.execute("call-1", { task_id: "w999" })).rejects.toThrow(
      "Unknown task ID: w999",
    );
  });

  it("throws when the worker is still running", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "running",
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_result");
    expect(tool).toBeDefined();

    await expect(tool!.execute("call-1", { task_id: "w1" })).rejects.toThrow(
      'Worker w1 is still running. Use delegate_check to monitor progress, or delegate_abort to stop it.',
    );
  });

  it("returns assistant text from final messages for terminal workers", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "completed",
      progress: {
        getFullTranscript: () => "transcript fallback",
        getFinalMessages: () => [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "irrelevant" },
              { type: "text", text: "final answer" },
            ],
          },
        ],
      },
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_result");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", { task_id: "w1" });

    expect(result.content[0].text).toBe("final answer");
    expect(result.details).toEqual({
      status: "completed",
      result: "final answer",
    });
  });

  it("falls back to the transcript when there is no final assistant text", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "aborted",
      progress: {
        getFullTranscript: () => "partial transcript",
        getFinalMessages: () => [],
      },
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_result");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", { task_id: "w1" });

    expect(result.content[0].text).toBe("partial transcript");
    expect(result.details).toEqual({
      status: "aborted",
      result: "partial transcript",
    });
  });

  it("includes error details and stderr tail for failed workers", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "failed",
      error: "Process exited unexpectedly (code 1)",
      progress: {
        getFullTranscript: () => "",
        getFinalMessages: () => [],
      },
      rpcClient: {
        getStderr: () => "worker stderr output",
      },
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_result");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", { task_id: "w1" });

    expect(result.content[0].text).toContain("Worker w1 failed with no output.");
    expect(result.content[0].text).toContain("Error: Process exited unexpectedly (code 1)");
    expect(result.details).toEqual({
      status: "failed",
      result: "",
      error: "Process exited unexpectedly (code 1)",
      stderr: "worker stderr output",
    });
  });
});

describe("delegate extension shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disposes all workers on session shutdown", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    await fake.shutdown();

    expect(managerMocks.disposeAll).toHaveBeenCalledTimes(1);
  });
});
