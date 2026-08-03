import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { runResolve } from "../resolve.js";

const fx = (name: string) => join(__dirname, "fixtures", name);
const repo = fx("repo");

describe("runResolve", () => {
  it("full mode resolves code + behavior with no drift", () => {
    const res = runResolve({ mode: "full" }, repo);
    expect(res.sections["daemon/session-lifecycle"].locations[0].symbol).toBe("SessionTimeline");
    expect(res.sections["daemon/reducer-determinism"].type).toBe("behavior");
    expect(res.drift.dangling).toEqual([]);
    expect(res.drift.unresolvedBehavior).toEqual([]);
  });

  it("section mode resolves only the requested id", () => {
    const res = runResolve({ mode: "section", section: "daemon/session-lifecycle" }, repo);
    expect(Object.keys(res.sections)).toEqual(["daemon/session-lifecycle"]);
  });

  it("section mode throws on an unknown id", () => {
    expect(() => runResolve({ mode: "section", section: "daemon/nope" }, repo)).toThrow(/unknown section/i);
  });

  it("changed mode returns only sections resolving into the changed files (tolerates ./ and native separators)", () => {
    const res = runResolve({ mode: "changed", changed: ["./src/session.ts"] }, repo);
    expect(Object.keys(res.sections)).toEqual(["daemon/session-lifecycle"]);
    const none = runResolve({ mode: "changed", changed: ["src/other.ts"] }, repo);
    expect(Object.keys(none.sections)).toEqual([]);
  });

  it("integration: a rule matching nothing is DANGLING; a rule matching many is LOOSE(count)", () => {
    const res = runResolve({ mode: "full" }, fx("repo-drift"));
    expect(res.drift.dangling.map((d) => d.section)).toContain("daemon/dangling-class");
    const loose = res.drift.loose.find((l) => l.section === "daemon/loose-funcs");
    expect(loose?.count).toBe(2);
  });

  it("throws on a duplicate heading slug in a referenced doc", () => {
    expect(() => runResolve({ mode: "full" }, fx("repo-dup"))).toThrow(/duplicate heading slug/i);
  });

  it("throws when a referenced living doc is missing", () => {
    expect(() => runResolve({ mode: "full" }, fx("repo-nodoc"))).toThrow(/living doc not found/i);
  });

  it("throws when a section id's slug is not an actual heading", () => {
    expect(() => runResolve({ mode: "full" }, fx("repo-badheading"))).toThrow(/no matching heading/i);
  });
});
