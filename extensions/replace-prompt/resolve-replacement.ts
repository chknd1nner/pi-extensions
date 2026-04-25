import fs from "node:fs";
import path from "node:path";
import type { NormalizedLiteralRule, NormalizedRegexRule } from "./types";

export function resolveReplacementText(
  rule: NormalizedLiteralRule | NormalizedRegexRule,
  dirs: { projectDir: string | null; globalDir: string | null },
): string {
  if (rule.replacementSource.kind === "inline") {
    return rule.replacementSource.value;
  }

  const candidates = [dirs.projectDir, dirs.globalDir]
    .filter((value): value is string => Boolean(value))
    .map((baseDir) => path.join(baseDir, rule.replacementSource.value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }

  throw new Error(`Replacement file not found for rule ${rule.id}`);
}
