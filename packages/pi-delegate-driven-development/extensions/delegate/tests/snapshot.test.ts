import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "fixed-test-uuid"),
}));

import { buildSessionSnapshot } from "../snapshot";

function makeMgr(branch: object[]) {
  return { getBranch: vi.fn((_fromId?: string) => branch) };
}

describe("buildSessionSnapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("first line is a fresh session header with correct fields", () => {
    const mgr = makeMgr([]);
    const output = buildSessionSnapshot(mgr, "/workspace/project", null);
    const header = JSON.parse(output.trim().split("\n")[0]);

    expect(header.type).toBe("session");
    expect(header.version).toBe(3);
    expect(header.id).toBe("fixed-test-uuid");
    expect(header.cwd).toBe("/workspace/project");
    expect(header.timestamp).toBe("2026-05-04T12:00:00.000Z");
  });

  it("uses workerCwd in header, not any inherited cwd", () => {
    const mgr = makeMgr([]);
    const output = buildSessionSnapshot(mgr, "/worker/dir", null);

    expect(JSON.parse(output.trim().split("\n")[0]).cwd).toBe("/worker/dir");
  });

  it("produces only the header line when anchorEntryId is null", () => {
    const mgr = makeMgr([]);
    const output = buildSessionSnapshot(mgr, "/workspace", null);
    const lines = output.trim().split("\n");

    expect(lines).toHaveLength(1);
    expect(mgr.getBranch).not.toHaveBeenCalled();
  });

  it("appends branch entries after the header when anchorEntryId is a string", () => {
    const branch = [
      { id: "root1111", type: "message", parentId: null, timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "node2222", type: "message", parentId: "root1111", timestamp: "2026-01-01T00:00:01.000Z" },
    ];
    const mgr = makeMgr(branch);
    const output = buildSessionSnapshot(mgr, "/workspace", "node2222");
    const lines = output.trim().split("\n");

    expect(lines).toHaveLength(3);
    expect(mgr.getBranch).toHaveBeenCalledWith("node2222");
    expect(JSON.parse(lines[1]).id).toBe("root1111");
    expect(JSON.parse(lines[2]).id).toBe("node2222");
  });

  it("output always ends with a trailing newline", () => {
    expect(buildSessionSnapshot(makeMgr([]), "/workspace", null).endsWith("\n")).toBe(true);
  });

  it("every line is valid JSON", () => {
    const branch = [{ id: "aabbccdd", type: "message", parentId: null }];
    const output = buildSessionSnapshot(makeMgr(branch), "/workspace", "aabbccdd");

    for (const line of output.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
