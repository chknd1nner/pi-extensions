import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.js";

type RegisteredTool = { name: string; execute: (...args: unknown[]) => Promise<unknown> };

function fakePi() {
  const tools: RegisteredTool[] = [];
  const handlers: Record<string, Function[]> = {};
  const appendEntry = vi.fn();
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    on: (event: string, handler: Function) => { handlers[event] = [...(handlers[event] ?? []), handler]; },
    appendEntry
  } as unknown as ExtensionAPI;
  return { pi, tools, handlers, appendEntry };
}

describe("brightdata extension", () => {
  it("registers three Bright Data tools", () => {
    const { pi, tools } = fakePi();
    extension(pi);
    expect(tools.map((tool) => tool.name).sort()).toEqual(["brightdata_fetch", "brightdata_get_content", "brightdata_search"]);
  });

  it("registers a session_start restore handler", () => {
    const { pi, handlers } = fakePi();
    extension(pi);
    expect(handlers.session_start).toHaveLength(1);
  });
});
