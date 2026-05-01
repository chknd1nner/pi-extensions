import { describe, expect, it } from "vitest";
import { buildTreePage, formatSessionList } from "../src/core/session-view";

describe("formatSessionList", () => {
  it("uses the explicit session name when present", () => {
    const items = formatSessionList([
      {
        id: "abc123",
        path: "/tmp/session.jsonl",
        cwd: "/tmp/project",
        name: "Refactor auth",
        parentSessionPath: undefined,
        created: new Date("2026-04-30T10:00:00Z"),
        modified: new Date("2026-04-30T12:30:00Z"),
        messageCount: 8,
        firstMessage: "hello",
        allMessagesText: "hello world",
      },
    ]);

    expect(items[0]).toEqual({
      id: "abc123",
      path: "/tmp/session.jsonl",
      title: "Refactor auth",
      subtitle: "2026-04-30 12:30 • 8 msgs",
    });
  });
});

describe("buildTreePage", () => {
  it("renders documented ASCII tree glyphs with numeric indices", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "message",
          id: "a1",
          parentId: "u1",
          timestamp: "2026-04-30T10:01:00.000Z",
          message: { role: "assistant", content: "Sure" },
        },
        {
          type: "message",
          id: "u2",
          parentId: "a1",
          timestamp: "2026-04-30T10:02:00.000Z",
          message: { role: "user", content: "Try plan B" },
        },
        {
          type: "message",
          id: "u3",
          parentId: "u1",
          timestamp: "2026-04-30T10:03:00.000Z",
          message: { role: "user", content: "Try plan C" },
        },
      ] as any,
      "u3",
      "default",
      0,
      10,
      () => undefined,
    );

    expect(page.text).toContain("├──[2]");
    expect(page.text).toContain("│  └──[3]");
    expect(page.text).toContain("└──[4]");
  });

  it("uses Pi's documented labeled-only filter name", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "message",
          id: "u2",
          parentId: "u1",
          timestamp: "2026-04-30T10:02:00.000Z",
          message: { role: "user", content: "Try plan B" },
        },
      ] as any,
      "u2",
      "labeled-only",
      0,
      10,
      (entryId) => (entryId === "u2" ? "checkpoint" : undefined),
    );

    expect(page.entries.map((entry) => entry.entryId)).toEqual(["u2"]);
    expect(page.text).toContain("checkpoint");
  });

  it("treats default as Pi's documented non-settings tree mode", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "label",
          id: "l1",
          parentId: "u1",
          timestamp: "2026-04-30T10:01:00.000Z",
          label: "checkpoint",
        },
      ] as any,
      "u1",
      "default",
      0,
      10,
      () => undefined,
    );

    expect(page.entries.map((entry) => entry.entryId)).toEqual(["u1"]);
  });
});
