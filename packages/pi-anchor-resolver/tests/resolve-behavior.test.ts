import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBehaviorAnchor } from "../resolve-behavior.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "behavior-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("resolveBehaviorAnchor", () => {
  it("locates the line declaring the named test", () => {
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "test", "reducer.test.ts"),
      ["import x;", 'it("deterministic replay", () => {', "  expect(1).toBe(1);", "});"].join("\n"));
    const loc = resolveBehaviorAnchor({ raw: "", path: "test/reducer.test.ts", testName: "deterministic replay" }, dir);
    expect(loc).not.toBeNull();
    expect(loc?.file).toBe("test/reducer.test.ts");
    expect(loc?.startLine).toBe(2);
    expect(loc?.symbol).toBe("deterministic replay");
  });

  it("returns null when the file does not exist", () => {
    expect(resolveBehaviorAnchor({ raw: "", path: "missing.test.ts", testName: "x" }, dir)).toBeNull();
  });

  it("returns null when the test name is not present", () => {
    writeFileSync(join(dir, "a.test.ts"), 'it("other", () => {});');
    expect(resolveBehaviorAnchor({ raw: "", path: "a.test.ts", testName: "nope" }, dir)).toBeNull();
  });
});
