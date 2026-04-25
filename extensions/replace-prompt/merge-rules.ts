import type { MergedConfig, NormalizedRule, ScopeConfig } from "./types";

export function mergeScopeConfigs(
  globalConfig: ScopeConfig | null,
  projectConfig: ScopeConfig | null,
  installedDirs: { projectDir: string | null; globalDir: string | null } = {
    projectDir: projectConfig?.baseDir ?? null,
    globalDir: globalConfig?.baseDir ?? null,
  },
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
    logging: {
      file: projectConfig?.logging.file ?? globalConfig?.logging.file ?? false,
    },
    rules: mergedRules,
    events: [...(globalConfig?.events ?? []), ...(projectConfig?.events ?? [])],
    projectDir: installedDirs.projectDir,
    globalDir: installedDirs.globalDir,
    logBaseDir: installedDirs.projectDir ?? installedDirs.globalDir,
  };
}
