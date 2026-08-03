import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAnchors } from "../anchors.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "anchors-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function write(yaml: string): string {
  const p = join(dir, "anchors.yml");
  writeFileSync(p, yaml);
  return p;
}

describe("loadAnchors", () => {
  it("parses code and behavior anchors", () => {
    const p = write([
      "daemon/session-lifecycle:",
      "  - code:",
      "      language: typescript",
      "      rule: { kind: class_declaration, has: { field: name, regex: '^SessionTimeline$' } }",
      "      files: [\"src/**/*.ts\"]",
      "daemon/reducer-determinism:",
      "  - behavior: \"test/reducer.test.ts::deterministic replay\"",
    ].join("\n"));
    const reg = loadAnchors(p);
    const code = reg.sections.get("daemon/session-lifecycle");
    expect(code?.[0].kind).toBe("code");
    if (code?.[0].kind === "code") {
      expect(code[0].code.language).toBe("typescript");
      expect(code[0].code.files).toEqual(["src/**/*.ts"]);
    }
    const beh = reg.sections.get("daemon/reducer-determinism");
    expect(beh?.[0].kind).toBe("behavior");
    if (beh?.[0].kind === "behavior") {
      expect(beh[0].behavior.path).toBe("test/reducer.test.ts");
      expect(beh[0].behavior.testName).toBe("deterministic replay");
    }
  });

  it("throws when the file is missing", () => {
    expect(() => loadAnchors(join(dir, "nope.yml"))).toThrow(/not found/i);
  });

  it("throws on malformed YAML", () => {
    const p = write("daemon/x:\n  - code: [unclosed");
    expect(() => loadAnchors(p)).toThrow();
  });

  it("throws when a section value is not a list", () => {
    const p = write("daemon/x: 42\n");
    expect(() => loadAnchors(p)).toThrow(/must be a list/i);
  });

  it("throws when an anchor is neither code nor behavior", () => {
    const p = write("daemon/x:\n  - note: hi\n");
    expect(() => loadAnchors(p)).toThrow(/code.*behavior/i);
  });

  it("throws on a code anchor missing files", () => {
    const p = write("daemon/x:\n  - code:\n      language: typescript\n      rule: { kind: x }\n");
    expect(() => loadAnchors(p)).toThrow(/files/i);
  });

  it("throws on a behavior anchor without ::", () => {
    const p = write('daemon/x:\n  - behavior: "no-separator"\n');
    expect(() => loadAnchors(p)).toThrow(/path::testName/i);
  });

  it("throws when rule is an array (arrays are typeof object)", () => {
    const p = write('daemon/x:\n  - code:\n      language: typescript\n      rule: []\n      files: ["a.ts"]\n');
    expect(() => loadAnchors(p)).toThrow(/rule/i);
  });

  it("throws when a files entry is empty or absolute", () => {
    const blank = write('daemon/x:\n  - code:\n      language: typescript\n      rule: { kind: x }\n      files: [""]\n');
    expect(() => loadAnchors(blank)).toThrow(/files/i);
    const abs = write('daemon/x:\n  - code:\n      language: typescript\n      rule: { kind: x }\n      files: ["/etc/passwd"]\n');
    expect(() => loadAnchors(abs)).toThrow(/relative/i);
  });

  it("throws on an empty anchor list for a section", () => {
    const p = write("daemon/x: []\n");
    expect(() => loadAnchors(p)).toThrow(/at least one anchor/i);
  });

  it("throws on a malformed id (not <domain>/<slug>)", () => {
    for (const bad of ["daemon", "/slug", "daemon/", "daemon/a/b"]) {
      const p = write(`${bad}:\n  - behavior: "a.test.ts::t"\n`);
      expect(() => loadAnchors(p)).toThrow(/id must be/i);
    }
  });

  it("throws when an anchor has both code and behavior", () => {
    const p = write('daemon/x:\n  - code: { language: typescript, rule: { kind: x }, files: ["a.ts"] }\n    behavior: "a.test.ts::t"\n');
    expect(() => loadAnchors(p)).toThrow(/exactly one/i);
  });
});
