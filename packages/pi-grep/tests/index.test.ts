import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piGrep from "../index";

type FakePi = {
  activeTools: string[];
  availableTools: string[];
  activeToolUpdates: string[][];
  registeredTools: unknown[];
  sessionStart?: () => void;
};

function createFakePi(
  availableTools: string[],
  activeTools: string[],
): FakePi {
  const fake: FakePi = {
    activeTools: [...activeTools],
    availableTools,
    activeToolUpdates: [],
    registeredTools: [],
  };

  const api = {
    on(event: string, handler: () => void) {
      if (event === "session_start") fake.sessionStart = handler;
    },
    getAllTools() {
      return fake.availableTools.map((name) => ({ name }));
    },
    getActiveTools() {
      return [...fake.activeTools];
    },
    setActiveTools(names: string[]) {
      fake.activeTools = [...names];
      fake.activeToolUpdates.push([...names]);
    },
    registerTool(tool: unknown) {
      fake.registeredTools.push(tool);
    },
  } as unknown as ExtensionAPI;

  piGrep(api);
  return fake;
}

describe("pi-grep", () => {
  it("activates the available built-in grep tool", () => {
    const fake = createFakePi(["read", "bash", "edit", "write", "grep"], [
      "read",
      "bash",
      "edit",
      "write",
    ]);

    fake.sessionStart?.();

    expect(fake.activeTools).toEqual(["read", "bash", "edit", "write", "grep"]);
    expect(fake.activeToolUpdates).toEqual([
      ["read", "bash", "edit", "write", "grep"],
    ]);
  });

  it("preserves all existing active tools and their order", () => {
    const fake = createFakePi(["grep", "bash", "read", "custom"], [
      "custom",
      "read",
      "bash",
    ]);

    fake.sessionStart?.();

    expect(fake.activeTools).toEqual(["custom", "read", "bash", "grep"]);
  });

  it("does not duplicate grep when it is already active", () => {
    const fake = createFakePi(["read", "grep", "bash"], ["read", "grep", "bash"]);

    fake.sessionStart?.();
    fake.sessionStart?.();

    expect(fake.activeTools).toEqual(["read", "grep", "bash"]);
    expect(fake.activeToolUpdates).toEqual([]);
  });

  it("does nothing when grep is unavailable", () => {
    const fake = createFakePi(["read", "bash", "edit", "write"], [
      "read",
      "bash",
      "edit",
      "write",
    ]);

    fake.sessionStart?.();

    expect(fake.activeTools).toEqual(["read", "bash", "edit", "write"]);
    expect(fake.activeToolUpdates).toEqual([]);
  });

  it("does not activate find or ls", () => {
    const fake = createFakePi(
      ["read", "bash", "edit", "write", "grep", "find", "ls"],
      ["read", "bash", "edit", "write"],
    );

    fake.sessionStart?.();

    expect(fake.activeTools).toEqual(["read", "bash", "edit", "write", "grep"]);
    expect(fake.activeTools).not.toContain("find");
    expect(fake.activeTools).not.toContain("ls");
  });

  it("registers no replacement tool definitions", () => {
    const fake = createFakePi(["grep"], []);

    fake.sessionStart?.();

    expect(fake.registeredTools).toEqual([]);
  });

  it("respects a tool allowlist that excludes grep", () => {
    const fake = createFakePi(["read", "bash"], ["read", "bash"]);

    fake.sessionStart?.();

    expect(fake.activeTools).toEqual(["read", "bash"]);
    expect(fake.activeToolUpdates).toEqual([]);
  });
});
