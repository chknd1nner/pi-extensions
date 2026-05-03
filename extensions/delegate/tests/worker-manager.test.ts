import { describe, expect, it, beforeEach } from "vitest";
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

  it("reads max workers from env var", () => {
    const envManager = new WorkerManager({ maxWorkers: 2, projectRoot: "/tmp", maxWorkersEnv: "5" });
    for (let i = 1; i <= 5; i++) {
      envManager.register(`w${i}`, baseParams);
    }
    expect(envManager.canStart()).toBe(false);
    expect(envManager.activeCount()).toBe(5);
  });
});
