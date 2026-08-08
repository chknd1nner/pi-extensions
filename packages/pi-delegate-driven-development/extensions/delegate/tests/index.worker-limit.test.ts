import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import delegate from "../index";

const workerManagerCtor = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    disposeAll: vi.fn(async () => {}),
  })),
);

vi.mock("../worker-manager", () => ({
  WorkerManager: workerManagerCtor,
}));

describe("delegate worker limit", () => {
  beforeEach(() => {
    workerManagerCtor.mockClear();
  });

  it("configures five workers as the default concurrency limit", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
    } as unknown as ExtensionAPI;

    delegate(pi);

    expect(workerManagerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ maxWorkers: 5 }),
    );
  });
});
