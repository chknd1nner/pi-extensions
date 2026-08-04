import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.js";

type RegisteredTool = { name: string; promptGuidelines?: string[]; execute: (...a: unknown[]) => Promise<any> };

function fakePi() {
  const tools: RegisteredTool[] = [];
  const handlers: Record<string, Function[]> = {};
  const appendEntry = vi.fn();
  const pi = {
    registerTool: (t: RegisteredTool) => tools.push(t),
    on: (e: string, h: Function) => { handlers[e] = [...(handlers[e] ?? []), h]; },
    appendEntry,
  } as unknown as ExtensionAPI;
  return { pi, tools, handlers, appendEntry };
}

const repo = join(__dirname, "fixtures", "repo"); // created in Task 7

describe("anchor-resolver extension", () => {
  it("registers exactly one anchor_resolve tool", () => {
    const { pi, tools } = fakePi();
    extension(pi);
    expect(tools.map((t) => t.name)).toEqual(["anchor_resolve"]);
  });

  it("names the tool in its promptGuidelines and registers no session_start handler (stateless)", () => {
    const { pi, tools, handlers } = fakePi();
    extension(pi);
    expect(tools[0].promptGuidelines?.some((g) => g.includes("anchor_resolve"))).toBe(true);
    expect(handlers.session_start).toBeUndefined();
  });

  it("executes the tool: report text + full details, terse report:false, and never appendEntry (stateless)", async () => {
    const { pi, tools, appendEntry } = fakePi();
    extension(pi);
    const full = await tools[0].execute("id", { mode: "full" }, undefined, undefined, { cwd: repo });
    expect(full.content[0].text).toContain("anchor_resolve");
    expect(full.details.responseId).toMatch(/^anchor_/);
    expect(Object.keys(full.details.sections)).toContain("daemon/session-lifecycle");
    expect(full.details.drift).toEqual({ dangling: [], loose: [], unresolvedBehavior: [], unparseable: [] });
    const terse = await tools[0].execute("id", { mode: "full", report: false }, undefined, undefined, { cwd: repo });
    expect(terse.content[0].text).toMatch(/section\(s\) resolved/);
    expect(appendEntry).not.toHaveBeenCalled();
  });
});
