import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { findParseErrors, languageToLang, resolveCodeAnchor } from "../resolve-code.js";
import type { CodeAnchor } from "../types.js";

const cwd = join(__dirname, "fixtures", "ts");
const swiftCwd = join(__dirname, "fixtures", "swift");
const parseCwd = join(__dirname, "fixtures", "parse");

describe("languageToLang", () => {
  it("maps typescript and throws on unknown", () => {
    expect(() => languageToLang("typescript")).not.toThrow();
    expect(() => languageToLang("cobol")).toThrow(/unsupported language/i);
  });

  it("maps swift (case-insensitive)", () => {
    expect(() => languageToLang("swift")).not.toThrow();
    expect(() => languageToLang("Swift")).not.toThrow();
  });
});

describe("resolveCodeAnchor (swift)", () => {
  it("resolves a Swift struct to file, 1-indexed line, and symbol", () => {
    const anchor: CodeAnchor = {
      language: "swift",
      rule: { kind: "class_declaration", has: { field: "name", regex: "^Envelope$" } },
      files: ["sample.swift"],
    };
    const locs = resolveCodeAnchor(anchor, swiftCwd);
    expect(locs).toHaveLength(1);
    expect(locs[0].file).toBe("sample.swift");
    expect(locs[0].startLine).toBe(9);
    expect(locs[0].symbol).toBe("Envelope");
  });

  it("resolves a Swift final class via the same class_declaration kind", () => {
    const anchor: CodeAnchor = {
      language: "swift",
      rule: { kind: "class_declaration", has: { field: "name", regex: "^TranscriptStore$" } },
      files: ["sample.swift"],
    };
    const locs = resolveCodeAnchor(anchor, swiftCwd);
    expect(locs).toHaveLength(1);
    expect(locs[0].symbol).toBe("TranscriptStore");
    expect(locs[0].startLine).toBe(3);
  });

  it("returns zero matches when the rule matches nothing (dangling case)", () => {
    const anchor: CodeAnchor = {
      language: "swift",
      rule: { kind: "class_declaration", has: { field: "name", regex: "^DoesNotExist$" } },
      files: ["sample.swift"],
    };
    expect(resolveCodeAnchor(anchor, swiftCwd)).toHaveLength(0);
  });
});

describe("resolveCodeAnchor", () => {
  it("resolves a single class match with symbol and 1-indexed lines", () => {
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "class_declaration", has: { field: "name", regex: "^SessionTimeline$" } },
      files: ["*.ts"],
    };
    const locs = resolveCodeAnchor(anchor, cwd);
    expect(locs).toHaveLength(1);
    expect(locs[0].file).toBe("session.ts");
    expect(locs[0].startLine).toBe(1);
    expect(locs[0].symbol).toBe("SessionTimeline");
  });

  it("returns zero matches when the rule matches nothing (dangling case)", () => {
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "class_declaration", has: { field: "name", regex: "^DoesNotExist$" } },
      files: ["*.ts"],
    };
    expect(resolveCodeAnchor(anchor, cwd)).toHaveLength(0);
  });

  it("finds nested matches (recursive walk, not root-only): a method inside a class", () => {
    // Regression guard: an earlier design walked only the tree root and silently missed
    // headings/nodes nested inside other nodes. `openSession` lives inside the class body.
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "method_definition", has: { field: "name", regex: "^openSession$" } },
      files: ["session.ts"],
    };
    const locs = resolveCodeAnchor(anchor, cwd);
    expect(locs).toHaveLength(1);
    expect(locs[0].startLine).toBe(2); // 1-indexed, nested below the class declaration
    expect(locs[0].symbol).toBe("openSession");
  });

  it("omits symbol for anonymous nodes with no `name` field (deeply nested)", () => {
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "return_statement" }, // nested 3 levels deep; has no name field
      files: ["session.ts"],
    };
    const locs = resolveCodeAnchor(anchor, cwd);
    expect(locs).toHaveLength(1);
    expect(locs[0].startLine).toBe(3);
    expect(locs[0].symbol).toBeUndefined();
    expect("symbol" in locs[0]).toBe(false); // key omitted entirely, not set to undefined
  });

  it("returns multiple matches for an over-broad rule (loose case)", () => {
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "function_declaration" },
      files: ["split.ts"],
    };
    expect(resolveCodeAnchor(anchor, cwd).length).toBeGreaterThan(1);
  });
});

describe("findParseErrors", () => {
  it("reports the file + first error line for a Swift `#if` inside a type body (0 matches, real repro)", () => {
    // The tree-sitter-swift #if-in-type-body bug: error recovery swallows the whole
    // struct, so a `class_declaration` anchor to it yields 0 matches. The ERROR nodes
    // are what distinguishes this parse failure from a genuine rename.
    const anchor: CodeAnchor = { language: "swift", rule: { kind: "class_declaration" }, files: ["struct-ifdef.swift"] };
    expect(resolveCodeAnchor(anchor, parseCwd)).toHaveLength(0);
    expect(findParseErrors(anchor, parseCwd)).toEqual([{ file: "struct-ifdef.swift", line: 3 }]);
  });

  it("detects ERROR nodes language-agnostically (broken TypeScript, universal ERROR kind)", () => {
    // Not Swift-specific: the mechanism is the universal tree-sitter ERROR node.
    const anchor: CodeAnchor = { language: "typescript", rule: { kind: "class_declaration" }, files: ["broken.ts"] };
    expect(findParseErrors(anchor, parseCwd)).toEqual([{ file: "broken.ts", line: 3 }]);
  });

  it("returns no errors for a cleanly-parsing Swift file", () => {
    const anchor: CodeAnchor = { language: "swift", rule: { kind: "class_declaration" }, files: ["sample.swift"] };
    expect(findParseErrors(anchor, swiftCwd)).toEqual([]);
  });

  it("returns no errors for a cleanly-parsing TypeScript file", () => {
    const anchor: CodeAnchor = { language: "typescript", rule: { kind: "class_declaration" }, files: ["session.ts"] };
    expect(findParseErrors(anchor, cwd)).toEqual([]);
  });
});
