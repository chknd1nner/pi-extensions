import type { MergedConfig, NormalizedRule, ScopeConfig } from "./types";

export function mergeScopeConfigs(
  globalConfig: ScopeConfig | null,
  projectConfig: ScopeConfig | null,
): MergedConfig {
  const inheritedRules = [...(globalConfig?.rules ?? [])];
  const mergedRules: NormalizedRule[] = [...inheritedRules];
  const indexById = new Map(inheritedRules.map((rule, index) => [rule.id, index]));

  for (const rule of projectConfig?.rules ?? []) {
    const inheritedIndex = indexById.get(rule.id);
    if (inheritedIndex === undefined) {
      mergedRules.push(rule);
      continue;
    }

    mergedRules[inheritedIndex] = rule;
  }

  return {
    logging: projectConfig?.logging ?? globalConfig?.logging ?? { file: false },
    rules: mergedRules,
    projectDir: projectConfig?.baseDir ?? null,
    globalDir: globalConfig?.baseDir ?? null,
    logBaseDir: projectConfig?.baseDir ?? globalConfig?.baseDir ?? null,
  };
}
