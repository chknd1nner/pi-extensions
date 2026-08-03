import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMdedit, mdeditHeadings } from "../mdedit.js";
import { headingSlugs, lintDoc } from "../doc-lint.js";

// These tests exercise the REAL mdedit binary (the single source of heading identity).
// mdedit must be on PATH — same posture as pi-grep's tests requiring `rg`. doc-lint takes
// doc PATHS, so each case writes a temp .md file first.
let dir: string;
const write = (name: string, content: string): string => {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
};
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "anchor-doclint-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("ensureMdedit (capability preflight)", () => {
  it("passes when the real mdedit CLI is present with --json support", () => {
    expect(() => ensureMdedit()).not.toThrow();
  });
  // The negative branches use vi.doMock + vi.resetModules to get a FRESH module instance
  // (the real ensureMdedit caches success in a module-level `checked` flag) with spawnSync stubbed.
  it("throws a build-mdedit error when the CLI is absent (ENOENT)", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync: () => ({ error: Object.assign(new Error("spawn mdedit ENOENT"), { code: "ENOENT" }) }),
    }));
    const { ensureMdedit: fresh } = await import("../mdedit.js");
    expect(() => fresh()).toThrow(/not found on PATH/i);
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });
  it("throws when mdedit is present but lacks `headings --json`", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync: () => ({ status: 0, stdout: "List headings\n\nUsage: mdedit headings <FILE>\n", stderr: "" }),
    }));
    const { ensureMdedit: fresh } = await import("../mdedit.js");
    expect(() => fresh()).toThrow(/rebuild it/i);
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });
});

describe("mdeditHeadings", () => {
  it("renders inline markdown to GitHub slugs and flags addressability", () => {
    const p = write("h.md", "# Daemon\n\n## [Session](#x) flow\n\nb\n\n> ## Quoted\n\nb\n");
    const hs = mdeditHeadings(p);
    expect(hs.map((h) => h.slug)).toEqual(["daemon", "session-flow", "quoted"]);
    expect(hs.find((h) => h.slug === "session-flow")!.addressable).toBe(true);
    expect(hs.find((h) => h.slug === "quoted")!.addressable).toBe(false); // nested in a block quote
  });
});

describe("headingSlugs", () => {
  it("returns slugs of addressable headings, rendering inline markup like GitHub", () => {
    const p = write("s.md", [
      "# Daemon",
      "## [Session](#d) flow",
      "## `openSession` contract",
      "## A <span>HTML</span> heading",
      "## __Strong__ here",
    ].join("\n\n"));
    expect(headingSlugs(p)).toEqual(new Set([
      "daemon", "session-flow", "opensession-contract", "a-html-heading", "strong-here",
    ]));
  });
  it("excludes non-addressable headings (block quotes, list items) from section ids", () => {
    const p = write("n.md", "# Daemon\n\n## Real Section\n\nb\n\n> ## Quoted Aside\n\nb\n\n- # Listed Aside\n\nb\n");
    expect(headingSlugs(p)).toEqual(new Set(["daemon", "real-section"]));
  });
});

describe("lintDoc", () => {
  it("passes when all heading slugs are unique", () => {
    const p = write("ok.md", "# One\n\n## Two Words\n");
    expect(() => lintDoc(p, "daemon.md")).not.toThrow();
  });
  it("throws on a duplicate heading-slug (distinct text, same slug)", () => {
    const p = write("dup.md", "## Session Lifecycle\n\n## session lifecycle\n");
    expect(() => lintDoc(p, "daemon.md")).toThrow(/duplicate heading slug/i);
  });
  it("detects collisions across nesting and raw-HTML spellings (mdedit considers every heading)", () => {
    const q = write("q.md", "> ## Same\n\n## same\n");
    expect(() => lintDoc(q, "daemon.md")).toThrow(/duplicate heading slug/i);
    const h = write("hh.md", "## <span>Same</span>\n\n## Same\n");
    expect(() => lintDoc(h, "daemon.md")).toThrow(/duplicate heading slug/i);
  });
});
