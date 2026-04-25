import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import type { RawConfig, RawRule, ScopeConfig, ScopeName } from "./types";

const kebabCaseId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadScopeConfig(scope: ScopeName, baseDir: string): Promise<ScopeConfig | null> {
  const rulesPath = path.join(baseDir, "rules.ts");
  if (!fs.existsSync(rulesPath)) {
    return null;
  }

  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  const loaded = (await jiti.import(rulesPath)) as { default?: RawConfig } | RawConfig;
  const config = getRawConfig(loaded);
  const seen = new Set<string>();
  const rules: ScopeConfig["rules"] = [];

  for (const rawRule of config.rules ?? []) {
    const normalized = normalizeRawRule(rawRule, scope);
    if (!normalized) {
      continue;
    }

    if (seen.has(normalized.id)) {
      continue;
    }

    seen.add(normalized.id);
    rules.push(normalized);
  }

  return {
    scope,
    baseDir,
    logging: { file: config.logging?.file },
    rules,
  };
}

function getRawConfig(loaded: { default?: RawConfig } | RawConfig): RawConfig {
  if (loaded && typeof loaded === "object" && "default" in loaded) {
    return loaded.default ?? {};
  }

  return loaded ?? {};
}

function normalizeRawRule(rawRule: RawRule, scope: ScopeName): ScopeConfig["rules"][number] | null {
  if (!rawRule || typeof rawRule !== "object") {
    return null;
  }

  if (typeof rawRule.id !== "string" || !kebabCaseId.test(rawRule.id)) {
    return null;
  }

  if (rawRule.enabled === false) {
    return { id: rawRule.id, enabled: false };
  }

  const mode = rawRule.mode ?? "first";
  if (mode !== "first" && mode !== "all") {
    return null;
  }

  const hasInlineReplacement = rawRule.replacement !== undefined;
  const hasFileReplacement = rawRule.replacementFile !== undefined;
  if (hasInlineReplacement === hasFileReplacement) {
    return null;
  }

  const replacementSource = hasFileReplacement
    ? { kind: "file" as const, value: rawRule.replacementFile }
    : { kind: "inline" as const, value: rawRule.replacement ?? "" };

  if (rawRule.type === "literal") {
    if (typeof rawRule.target !== "string" || rawRule.target === "") {
      return null;
    }

    return {
      id: rawRule.id,
      enabled: true,
      type: "literal",
      target: rawRule.target,
      replacementSource,
      mode,
      sourceScope: scope,
    };
  }

  if (rawRule.type === "regex") {
    if (!(rawRule.target instanceof RegExp)) {
      return null;
    }

    return {
      id: rawRule.id,
      enabled: true,
      type: "regex",
      target: rawRule.target,
      replacementSource,
      mode,
      sourceScope: scope,
    };
  }

  return null;
}

export function selectLogPath(dirs: { projectDir: string | null; globalDir: string | null }): string | null {
  const baseDir = dirs.projectDir ?? dirs.globalDir;
  return baseDir ? path.join(baseDir, "replace-prompt.log") : null;
}
