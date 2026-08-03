import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

describe("pi-anchor-resolver package", () => {
  it("declares the anchor_resolve extension manifest", () => {
    expect(pkg.name).toBe("pi-anchor-resolver");
    expect(pkg.pi.extensions).toEqual(["./index.ts"]);
    expect(pkg.dependencies["@ast-grep/napi"]).toBeDefined();
    expect(pkg.dependencies.yaml).toBeDefined();
  });
});
