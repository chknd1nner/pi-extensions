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

describe("delegate_steer and delegate_abort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcClientMocks.isAlive.mockReturnValue(true);
    rpcClientMocks.sendAndWait.mockResolvedValue(null as unknown);
  });

  it("registers delegate_steer and delegate_abort", () => {
    const fake = createFakePi();
    delegate(fake.pi);

    expect(fake.getTool("delegate_steer")).toBeDefined();
    expect(fake.getTool("delegate_abort")).toBeDefined();
  });

  it("sends steer messages to a running worker", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "running",
      rpcClient: {
        isAlive: rpcClientMocks.isAlive,
        sendAndWait: rpcClientMocks.sendAndWait,
      },
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_steer");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", {
      task_id: "w1",
      message: "Please focus on tests.",
    });

    expect(rpcClientMocks.sendAndWait).toHaveBeenCalledWith({
      type: "steer",
      message: "Please focus on tests.",
    });
    expect(result.details).toEqual({ success: true });
    expect(result.content[0].text).toContain("Steering message sent to w1");
  });

  it("throws when steer is rejected by the worker", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "running",
      rpcClient: {
        isAlive: rpcClientMocks.isAlive,
        sendAndWait: rpcClientMocks.sendAndWait,
      },
    });
    rpcClientMocks.sendAndWait.mockResolvedValue({
      success: false,
      error: "worker not actively streaming",
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_steer");
    expect(tool).toBeDefined();

    await expect(
      tool!.execute("call-1", {
        task_id: "w1",
        message: "Please focus on tests.",
      }),
    ).rejects.toThrow("Steer rejected by w1: worker not actively streaming. Retry shortly.");
  });

  it("aborts a running worker", async () => {
    const timeoutTimer = setTimeout(() => undefined, 1000);
    const close = vi.fn();
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "running",
      timeoutTimer,
      rpcClient: {
        kill: rpcClientMocks.kill,
      },
      logWriter: { close },
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_abort");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", { task_id: "w1" });

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "aborted", "Aborted by orchestrator");
    expect(rpcClientMocks.kill).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(result.details).toEqual({ success: true });
    expect(result.content[0].text).toContain("Worker w1 aborted.");
  });

  it("returns a no-op result when abort targets an already terminal worker", async () => {
    managerMocks.get.mockReturnValue({
      taskId: "w1",
      status: "completed",
      rpcClient: {
        kill: rpcClientMocks.kill,
      },
    });

    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_abort");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", { task_id: "w1" });

    expect(managerMocks.setStatus).not.toHaveBeenCalled();
    expect(rpcClientMocks.kill).not.toHaveBeenCalled();
    expect(result.details).toEqual({ success: false });
    expect(result.content[0].text).toContain("Worker w1 is already completed.");
  });
});
