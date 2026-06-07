import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(testDir, "..");
const fixturePath = path.join(testDir, "fixtures", "typed-rules-config.ts");
const require = createRequire(import.meta.url);
const tscPath = require.resolve("typescript/bin/tsc");

describe("RawConfig typing", () => {
  it("contextually types condition callbacks in rules config", () => {
    expect(() =>
      execFileSync(
        tscPath,
        [
          "--noEmit",
          fixturePath,
          "--target",
          "ES2022",
          "--module",
          "ESNext",
          "--moduleResolution",
          "Bundler",
          "--strict",
          "--esModuleInterop",
          "--skipLibCheck",
          "--types",
          "vitest/globals,node",
        ],
        {
          cwd: packageDir,
          stdio: "pipe",
        },
      ),
    ).not.toThrow();
  });
});
