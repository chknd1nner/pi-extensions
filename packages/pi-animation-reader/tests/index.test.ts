import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.js";

type RegisteredTool = { name: string; parameters: unknown; execute: Function };

function fakePi() {
  const tools: RegisteredTool[] = [];
  const pi = {
    registerTool: (t: RegisteredTool) => tools.push(t),
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

describe("extension registration", () => {
  it("registers exactly the three animation tools", () => {
    const { pi, tools } = fakePi();
    extension(pi);
    expect(tools.map((t) => t.name)).toEqual(["animation_info", "animation_grid", "animation_frames"]);
  });

  it("every tool has a description, parameters schema, and execute", () => {
    const { pi, tools } = fakePi();
    extension(pi);
    for (const t of tools) {
      expect(t.parameters).toBeDefined();
      expect(typeof t.execute).toBe("function");
    }
  });
});
