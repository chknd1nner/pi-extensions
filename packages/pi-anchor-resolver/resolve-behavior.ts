import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BehaviorAnchor, ResolvedLocation } from "./types.js";

export function resolveBehaviorAnchor(anchor: BehaviorAnchor, cwd: string): ResolvedLocation | null {
  const abs = join(cwd, anchor.path);
  if (!existsSync(abs)) return null;
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(anchor.testName)) {
      return { file: anchor.path, startLine: i + 1, endLine: i + 1, symbol: anchor.testName };
    }
  }
  return null;
}
