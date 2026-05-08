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

describe("delegate_start inherit_context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcOptions.value = null;
    managerMocks.canStart.mockReturnValue(true);
    managerMocks.nextTaskId.mockReturnValue("w1");
    managerMocks.setStatus.mockReturnValue(true);
    managerMocks.register.mockReturnValue({
      taskId: "w1", status: "running", params: {}, startedAt: Date.now(),
    });
  });

  it("absent inherit_context does not build snapshot and leaves sessionPath undefined", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    await getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p" }, undefined, undefined, makeCtx());

    expect(snapshotMock.buildSessionSnapshot).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(capturedRpcOptions.value?.sessionPath).toBeUndefined();
  });

  it("inherit_context false does not build snapshot", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    await getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: false }, undefined, undefined, makeCtx());

    expect(snapshotMock.buildSessionSnapshot).not.toHaveBeenCalled();
    expect(capturedRpcOptions.value?.sessionPath).toBeUndefined();
  });

  it("inherit_context true snapshots current leaf and writes temp file", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: "leaf9999" });

    await getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: true }, undefined, undefined, ctx);

    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), "leaf9999");
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("pi-worker-w1-"), expect.any(String), "utf8");
    expect(capturedRpcOptions.value?.sessionPath).toEqual(expect.stringContaining("pi-worker-w1-"));
  });

  it("string inherit_context uses named anchor from delegate_anchor", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_anchor")!.execute("a1", { name: "foundation" }, undefined, undefined, makeCtx({ leafId: "anchor1111", branch: [{ id: "anchor1111" }] }));

    const ctx = makeCtx();
    await getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: "foundation" }, undefined, undefined, ctx);

    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), "anchor1111");
  });

  it("missing named anchor fails pre-start, sets worker failed, does not write file or start RPC client", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: "missing" }, undefined, undefined, makeCtx())).rejects.toThrow(
      "No anchor named 'missing'. Call delegate_anchor({ name: 'missing' }) first.",
    );

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.stringContaining("No anchor named 'missing'"));
    expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("temp file write failure fails pre-start and does not start RPC client", async () => {
    fsMock.writeFileSync.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: true }, undefined, undefined, makeCtx())).rejects.toThrow("disk full");

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.stringContaining("disk full"));
    expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("partial temp file is cleaned up on write failure", async () => {
    fsMock.writeFileSync.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: true }, undefined, undefined, makeCtx())).rejects.toThrow("disk full");

    expect(fsMock.rmSync).toHaveBeenCalledWith(expect.stringContaining("pi-worker-w1-"), { force: true });
  });

  it("missing sessionManager fails pre-start", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: true }, undefined, undefined, {})).rejects.toThrow();

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.any(String));
    expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("null named anchor passes null to buildSessionSnapshot", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_anchor")!.execute("a1", { name: "start" }, undefined, undefined, makeCtx({ leafId: null, branch: [] }));

    const ctx = makeCtx();
    await getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: "start" }, undefined, undefined, ctx);

    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), null);
  });

  it("onExit cleans up temp file even when worker status is already completed", async () => {
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

    await getTool("delegate_start")!.execute("c1", { task: "x", model: "m", provider: "p", inherit_context: true }, undefined, undefined, makeCtx());

    managerMocks.get.mockReturnValue({ taskId: "w1", status: "completed" });
    capturedOnExit?.(0, null);

    expect(fsMock.rmSync).toHaveBeenCalledWith(expect.stringContaining("pi-worker-w1-"), { force: true });
  });
});
