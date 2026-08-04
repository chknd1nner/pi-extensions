import { describe, expect, it } from "vitest";
import { buildSections, classifyDrift, formatReport } from "../drift.js";
import type { AnchorResolution } from "../types.js";

const codeAnchor = (label: string) => ({ kind: "code" as const, label, code: { language: "typescript", rule: {}, files: [] } });
const behaviorAnchor = (label: string) => ({ kind: "behavior" as const, label, behavior: { raw: label, path: "p", testName: "t" } });

describe("classifyDrift", () => {
  it("flags a code anchor with zero matches as dangling", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [] }];
    expect(classifyDrift(r).dangling).toEqual([{ section: "d/a", anchor: "R" }]);
  });
  it("flags a code anchor with >1 match as loose with count", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [
      { file: "a.ts", startLine: 1, endLine: 1 }, { file: "b.ts", startLine: 2, endLine: 2 }] }];
    expect(classifyDrift(r).loose).toEqual([{ section: "d/a", anchor: "R", count: 2 }]);
  });
  it("flags an unresolved behavior anchor", () => {
    const r: AnchorResolution[] = [{ section: "d/b", anchor: behaviorAnchor("p::t"), locations: [] }];
    expect(classifyDrift(r).unresolvedBehavior).toEqual([{ section: "d/b", id: "p::t" }]);
  });
  it("reports no drift for a clean single-match resolution", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [{ file: "a.ts", startLine: 1, endLine: 3 }] }];
    const d = classifyDrift(r);
    expect([d.dangling, d.loose, d.unresolvedBehavior, d.unparseable]).toEqual([[], [], [], []]);
  });
  it("classifies a 0-match code anchor with parse errors as unparseable, not dangling", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [], parseErrors: [{ file: "x.swift", line: 3 }] }];
    const d = classifyDrift(r);
    expect(d.dangling).toEqual([]);
    expect(d.unparseable).toEqual([{ section: "d/a", anchor: "R", file: "x.swift", line: 3 }]);
  });
  it("still classifies a 0-match code anchor with no parse errors as dangling (genuine rename)", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [], parseErrors: [] }];
    const d = classifyDrift(r);
    expect(d.unparseable).toEqual([]);
    expect(d.dangling).toEqual([{ section: "d/a", anchor: "R" }]);
  });
});

describe("buildSections", () => {
  it("marks a section with both anchor kinds as mixed and merges locations", () => {
    const r: AnchorResolution[] = [
      { section: "d/a", anchor: codeAnchor("R"), locations: [{ file: "a.ts", startLine: 1, endLine: 3 }] },
      { section: "d/a", anchor: behaviorAnchor("p::t"), locations: [{ file: "p", startLine: 5, endLine: 5 }] },
    ];
    const s = buildSections(r);
    expect(s["d/a"].type).toBe("mixed");
    expect(s["d/a"].locations).toHaveLength(2);
  });
  it("marks pure code and pure behavior sections", () => {
    const s = buildSections([
      { section: "c", anchor: codeAnchor("R"), locations: [] },
      { section: "b", anchor: behaviorAnchor("p::t"), locations: [] },
    ]);
    expect(s.c.type).toBe("code");
    expect(s.b.type).toBe("behavior");
  });
});

describe("formatReport", () => {
  it("summarizes every drift kind and section locations", () => {
    const text = formatReport({
      responseId: "r1",
      sections: { "d/a": { type: "code", locations: [{ file: "a.ts", startLine: 1, endLine: 3, symbol: "X" }] } },
      drift: {
        dangling: [{ section: "d/z", anchor: "R" }],
        loose: [{ section: "d/l", anchor: "F", count: 3 }],
        unresolvedBehavior: [{ section: "d/b", id: "p::t" }],
        unparseable: [{ section: "d/u", anchor: "S", file: "T.swift", line: 3 }],
      },
    });
    expect(text).toContain("DANGLING d/z");
    expect(text).toContain("LOOSE d/l");
    expect(text).toContain("3 matches");
    expect(text).toContain("UNRESOLVED d/b");
    expect(text).toContain("a.ts:1 (X)");
    // unparseable is a distinct signal, names file+line, and is counted in the summary total.
    expect(text).toContain("UNPARSEABLE d/u");
    expect(text).toContain("0 matches for `S`");
    expect(text).toContain("T.swift:3");
    expect(text).toContain("4 drift signal(s)");
  });
  it("states clean and (none) when there is no drift and no sections", () => {
    const text = formatReport({ responseId: "r1", sections: {}, drift: { dangling: [], loose: [], unresolvedBehavior: [], unparseable: [] } });
    expect(text).toMatch(/no drift/i);
    expect(text).toContain("(none)");
  });
  it("renders an unresolved location as (unresolved)", () => {
    const text = formatReport({
      responseId: "r1",
      sections: { "d/a": { type: "code", locations: [] } },
      drift: { dangling: [], loose: [], unresolvedBehavior: [], unparseable: [] },
    });
    expect(text).toContain("(unresolved)");
  });
});
