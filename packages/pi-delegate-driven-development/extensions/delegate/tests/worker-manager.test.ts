import { describe, expect, it, beforeEach, vi } from "vitest";
import { WorkerManager } from "../worker-manager";
import type { DelegateStartParams } from "../types";

const baseParams: DelegateStartParams = {
  task: "Review the code",
  model: "claude-sonnet-4-6",
  provider: "anthropic",
};

describe("WorkerManager", () => {
  let manager: WorkerManager;

  beforeEach(() => {
    manager = new WorkerManager({ maxWorkers: 2, projectRoot: "/tmp/test" });
  });

  it("generates sequential task IDs", () => {
    expect(manager.nextTaskId()).toBe("w1");
    expect(manager.nextTaskId()).toBe("w2");
    expect(manager.nextTaskId()).toBe("w3");
  });

  it("tracks a registered worker", () => {
    manager.register("w1", baseParams);
    const worker = manager.get("w1");
    expect(worker).toBeDefined();
    expect(worker!.status).toBe("running");
    expect(worker!.params.task).toBe("Review the code");
  });

  it("returns undefined for unknown task ID", () => {
    expect(manager.get("w99")).toBeUndefined();
  });

  it("reports active worker count", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    expect(manager.activeCount()).toBe(2);
  });

  it("enforces concurrency cap", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    expect(manager.canStart()).toBe(false);
    expect(manager.activeWorkerDescriptions()).toEqual([
      { taskId: "w1", task: "Review the code" },
      { taskId: "w2", task: "Review the code" },
    ]);
  });

  it("allows new workers after one completes", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    manager.setStatus("w1", "completed");
    expect(manager.canStart()).toBe(true);
    expect(manager.activeCount()).toBe(1);
  });

  it("keeps completed workers readable", () => {
    manager.register("w1", baseParams);
    manager.setStatus("w1", "completed");
    const worker = manager.get("w1");
    expect(worker).toBeDefined();
    expect(worker!.status).toBe("completed");
  });

  it("rejects transitions out of terminal states", () => {
    manager.register("w1", baseParams);
    manager.setStatus("w1", "completed");
    manager.setStatus("w1", "running");
    expect(manager.get("w1")!.status).toBe("completed");
  });

  it("returns whether a transition was applied", () => {
    manager.register("w1", baseParams);

    expect(manager.setStatus("w1", "completed")).toBe(true);
    expect(manager.setStatus("w1", "failed", "late failure")).toBe(false);
    expect(manager.get("w1")!.status).toBe("completed");
  });

  it("marks running workers aborted during disposeAll and writes the aborted status file", async () => {
    const kill = vi.fn(async () => {});
    const writeStatus = vi.fn();
    const close = vi.fn();

    const entry = manager.register("w1", baseParams);
    entry.rpcClient = { kill } as never;
    entry.statusWriter = { writeStatus, getFilePath: () => "/tmp/w1.status" } as never;
    entry.logWriter = { close } as never;

    await manager.disposeAll();

    expect(entry.status).toBe("aborted");
    expect(entry.error).toBe("Aborted during session shutdown");
    expect(writeStatus).toHaveBeenCalledWith("aborted");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not kill workers that were already terminal before disposeAll", async () => {
    const kill = vi.fn(async () => {});
    const close = vi.fn();

    const entry = manager.register("w1", baseParams);
    entry.rpcClient = { kill } as never;
    entry.logWriter = { close } as never;
    manager.setStatus("w1", "completed");

    await manager.disposeAll();

    expect(kill).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["5", 5],
    [" 5 ", 5],
    ["", 3],
    ["0", 3],
    ["-1", 3],
    ["garbage", 3],
    ["5workers", 3],
    ["1.5", 3],
    ["1e2", 3],
    ["9007199254740992", 3],
  ])("uses only complete positive integer env values (%j)", (maxWorkersEnv, expectedLimit) => {
    const envManager = new WorkerManager({
      maxWorkers: 3,
      projectRoot: "/tmp",
      maxWorkersEnv,
    });

    for (let i = 1; i <= expectedLimit; i++) {
      expect(envManager.canStart()).toBe(true);
      envManager.register(`w${i}`, baseParams);
    }

    expect(envManager.canStart()).toBe(false);
    expect(envManager.activeCount()).toBe(expectedLimit);
  });
});
