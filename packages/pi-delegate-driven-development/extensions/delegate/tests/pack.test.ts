import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPackFile, listPackNames, parsePackFile, PACK_NAME_PATTERN, resolvePackPath } from "../pack";
import type { PackItem } from "../pack";

describe("PACK_NAME_PATTERN", () => {
  it("accepts lowercase alphanumeric with dashes/underscores", () => {
    expect(PACK_NAME_PATTERN.test("plan-foundation")).toBe(true);
    expect(PACK_NAME_PATTERN.test("impl_v2")).toBe(true);
    expect(PACK_NAME_PATTERN.test("a")).toBe(true);
  });

  it("rejects uppercase, leading separators, slashes, and empty", () => {
    expect(PACK_NAME_PATTERN.test("Plan")).toBe(false);
    expect(PACK_NAME_PATTERN.test("-x")).toBe(false);
    expect(PACK_NAME_PATTERN.test("a/b")).toBe(false);
    expect(PACK_NAME_PATTERN.test("")).toBe(false);
  });
});

describe("buildPackFile", () => {
  const items: PackItem[] = [
    { kind: "file", path: "docs/spec.md", content: "SPEC BODY" },
    { kind: "file", path: "docs/plan.md", content: "PLAN BODY" },
    { kind: "note", content: "Reviewer: be strict." },
  ];

  it("first line is a pack header with name, version 1, and sources metadata", () => {
    const lines = buildPackFile("plan-foundation", items).trim().split("\n");
    const header = JSON.parse(lines[0]);

    expect(header.type).toBe("pack");
    expect(header.version).toBe(1);
    expect(header.name).toBe("plan-foundation");
    expect(typeof header.timestamp).toBe("string");
    expect(header.sources).toEqual([
      { path: "docs/spec.md", bytes: 9 },
      { path: "docs/plan.md", bytes: 9 },
      { note: true, bytes: 20 },
    ]);
  });

  it("emits one user-message entry per item, in order, with framing headers", () => {
    const lines = buildPackFile("plan-foundation", items).trim().split("\n");
    const entries = lines.slice(1).map((l) => JSON.parse(l));

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.type).toBe("message");
      expect(entry.message.role).toBe("user");
      expect(entry.message.content).toHaveLength(1);
      expect(entry.message.content[0].type).toBe("text");
    }
    expect(entries[0].message.content[0].text).toBe(
      "[context-pack:plan-foundation] File: docs/spec.md\n\nSPEC BODY",
    );
    expect(entries[1].message.content[0].text).toBe(
      "[context-pack:plan-foundation] File: docs/plan.md\n\nPLAN BODY",
    );
    expect(entries[2].message.content[0].text).toBe(
      "[context-pack:plan-foundation] Note from orchestrator:\n\nReviewer: be strict.",
    );
  });

  it("chains placeholder parentIds (first is null)", () => {
    const lines = buildPackFile("p", items).trim().split("\n");
    const entries = lines.slice(1).map((l) => JSON.parse(l));

    expect(entries[0].parentId).toBeNull();
    expect(entries[1].parentId).toBe(entries[0].id);
    expect(entries[2].parentId).toBe(entries[1].id);
  });

  it("produces byte-identical message payloads for identical inputs", () => {
    const a = buildPackFile("p", items).trim().split("\n").slice(1)
      .map((l) => JSON.stringify(JSON.parse(l).message.content));
    const b = buildPackFile("p", items).trim().split("\n").slice(1)
      .map((l) => JSON.stringify(JSON.parse(l).message.content));
    expect(a).toEqual(b);
  });
});

describe("parsePackFile", () => {
  it("round-trips buildPackFile output", () => {
    const content = buildPackFile("p", [{ kind: "file", path: "a.md", content: "A" }]);
    const { header, entries } = parsePackFile(content);

    expect(header.name).toBe("p");
    expect(entries).toHaveLength(1);
    expect(entries[0].message.content[0].text).toContain("File: a.md");
  });

  it("rejects an empty file", () => {
    expect(() => parsePackFile("")).toThrow(/empty/i);
  });

  it("rejects a non-pack header", () => {
    expect(() => parsePackFile('{"type":"session","version":3}\n')).toThrow(/not a pack/i);
  });

  it("rejects an unsupported version", () => {
    expect(() => parsePackFile('{"type":"pack","version":2,"name":"p","timestamp":"t","sources":[]}\n')).toThrow(
      /version/i,
    );
  });

  it("rejects invalid JSON entries", () => {
    const content = '{"type":"pack","version":1,"name":"p","timestamp":"t","sources":[]}\nnot-json\n';
    expect(() => parsePackFile(content)).toThrow(/invalid JSON/i);
  });

  it("rejects non-message entries", () => {
    const content =
      '{"type":"pack","version":1,"name":"p","timestamp":"t","sources":[]}\n{"type":"model_change","id":"x"}\n';
    expect(() => parsePackFile(content)).toThrow(/entry type/i);
  });
});

describe("pack resolution", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pack-test-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writePack(date: string, name: string, marker: string): string {
    const dir = path.join(root, ".pi", "delegate", date, "packs");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${name}.jsonl`);
    fs.writeFileSync(p, marker, "utf8");
    return p;
  }

  it("resolves a bare name to the newest date dir containing it", () => {
    writePack("2026-06-09", "impl", "old");
    const newest = writePack("2026-06-10", "impl", "new");

    expect(resolvePackPath(root, "impl", "/anywhere")).toBe(newest);
  });

  it("falls back to older dates when newest lacks the name", () => {
    const only = writePack("2026-06-09", "impl", "x");
    writePack("2026-06-10", "other", "y");

    expect(resolvePackPath(root, "impl", "/anywhere")).toBe(only);
  });

  it("treats values containing '/' or ending in .jsonl as paths resolved against cwd", () => {
    const p = writePack("2026-06-10", "impl", "x");

    expect(resolvePackPath(root, p, "/anywhere")).toBe(p);
    expect(resolvePackPath(root, path.relative(root, p), root)).toBe(p);
  });

  it("throws for a path that does not exist", () => {
    expect(() => resolvePackPath(root, "./nope/missing.jsonl", root)).toThrow(/not found at path/i);
  });

  it("throws for an unknown name, listing available packs", () => {
    writePack("2026-06-09", "impl", "x");
    writePack("2026-06-10", "review", "y");

    expect(() => resolvePackPath(root, "missing", "/anywhere")).toThrow(
      /No context pack named 'missing'.*impl, review/s,
    );
  });

  it("throws helpfully when no packs exist at all", () => {
    expect(() => resolvePackPath(root, "missing", "/anywhere")).toThrow(/\(none\)/);
  });

  it("listPackNames returns sorted unique names across date dirs", () => {
    writePack("2026-06-09", "impl", "x");
    writePack("2026-06-10", "impl", "y");
    writePack("2026-06-10", "review", "z");

    expect(listPackNames(root)).toEqual(["impl", "review"]);
  });
});
