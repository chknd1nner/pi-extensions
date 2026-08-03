import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { languageToLang, resolveCodeAnchor } from "../resolve-code.js";
import type { CodeAnchor } from "../types.js";

const cwd = join(__dirname, "fixtures", "ts");

describe("languageToLang", () => {
  it("maps typescript and throws on unknown", () => {
    expect(() => languageToLang("typescript")).not.toThrow();
    expect(() => languageToLang("cobol")).toThrow(/unsupported language/i);
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
