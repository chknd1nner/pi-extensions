import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import type { LogEvent, RawConfig, RawRule, RuleCondition, ScopeConfig, ScopeName } from "./types";

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
  const events: LogEvent[] = [];

  for (const rawRule of config.rules ?? []) {
    const { rule: normalized, event } = normalizeRawRule(rawRule, scope);
    if (event) {
      events.push(event);
    }
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
    events,
  };
}

function getRawConfig(loaded: { default?: RawConfig } | RawConfig): RawConfig {
  if (loaded && typeof loaded === "object" && "default" in loaded) {
    return loaded.default ?? {};
  }

  return loaded as RawConfig;
}

function normalizeRawRule(
  rawRule: RawRule,
  scope: ScopeName,
): { rule: ScopeConfig["rules"][number] | null; event?: LogEvent } {
  if (!rawRule || typeof rawRule !== "object") {
    return { rule: null };
  }

  if (typeof rawRule.id !== "string" || !kebabCaseId.test(rawRule.id)) {
    return { rule: null };
  }

  if (rawRule.enabled === false) {
    return { rule: { id: rawRule.id, enabled: false } };
  }

  if (rawRule.condition !== undefined && typeof rawRule.condition !== "function") {
    return {
      rule: null,
      event: { level: "warn", message: "invalid condition; expected function", ruleId: rawRule.id },
    };
  }

  const condition = rawRule.condition as RuleCondition | undefined;

  const mode = rawRule.mode ?? "first";
  if (mode !== "first" && mode !== "all") {
    return { rule: null };
  }

  const hasInlineReplacement = rawRule.replacement !== undefined;
  const hasFileReplacement = rawRule.replacementFile !== undefined;
  if (hasInlineReplacement === hasFileReplacement) {
    return { rule: null };
  }

  if (rawRule.type === "literal") {
    if (typeof rawRule.target !== "string" || rawRule.target === "") {
      return { rule: null };
    }

    const replacementSource = hasFileReplacement
      ? { kind: "file" as const, value: rawRule.replacementFile! }
      : { kind: "inline" as const, value: rawRule.replacement ?? "" };

    return {
      rule: {
        id: rawRule.id,
        enabled: true,
        type: "literal",
        target: rawRule.target,
        replacementSource,
        mode,
        sourceScope: scope,
        condition,
      },
    };
  }

  if (rawRule.type === "regex") {
    if (!(rawRule.target instanceof RegExp)) {
      return { rule: null };
    }

    const replacementSource = hasFileReplacement
      ? { kind: "file" as const, value: rawRule.replacementFile! }
      : { kind: "inline" as const, value: rawRule.replacement ?? "" };

    return {
      rule: {
        id: rawRule.id,
        enabled: true,
        type: "regex",
        target: rawRule.target,
        replacementSource,
        mode,
        sourceScope: scope,
        condition,
      },
    };
  }

  return { rule: null };
}

export function selectLogPath(dirs: { projectDir: string | null; globalDir: string | null }): string | null {
  const baseDir = dirs.projectDir ?? dirs.globalDir;
  return baseDir ? path.join(baseDir, "replace-prompt.log") : null;
}
