# Code Review — Task 2: Implement rule typing, validation, and merge behavior

## Findings

### Medium — Project configs cannot inherit global logging because `ScopeConfig` collapses “unset” and `false`
`ScopeConfig.logging` is modeled as a required `{ file: boolean }` in `extensions/replace-prompt/types.ts:35-39`, and `mergeScopeConfigs()` always prefers the entire project logging object when a project config exists (`extensions/replace-prompt/merge-rules.ts:21-26`). That means a project `rules.ts` file that omits `logging` becomes indistinguishable from an explicit `logging: { file: false }` once normalized, so the merged config will disable a global `logging.file: true` setting instead of inheriting it.

That does not match the design’s merged-config intent, where global and project configs are merged and project options win when provided (`docs/superpowers/specs/2026-04-24-replace-prompt-design.md:178-184`). As written, Task 4’s loader/runtime will have no way to preserve “no project override” for logging.

### Medium — The merged base-dir model loses the project install location when only the global config has rules
`MergedConfig.projectDir/globalDir/logBaseDir` are derived only from loaded scope configs (`extensions/replace-prompt/merge-rules.ts:21-26`). If the project-local extension directory exists but has no local `rules.ts`, `projectConfig` will be `null`, so the merge result drops the project directory entirely and later log-path selection will fall back to the global directory.

The design requires file logging to use the most specific installed extension directory, not just the most specific scope that happened to load a config (`docs/superpowers/specs/2026-04-24-replace-prompt-design.md:327-330`). This is a base-dir selection bug in the current merge model that will surface once logging is wired in Task 4/5.

## Review outcome

**Task 2 should not pass review as-is.**

The rule ordering/override behavior itself looks correct, but the merged config model currently bakes in incorrect semantics for logging inheritance and log base-dir selection.

## What looks good

- `mergeScopeConfigs()` does preserve inherited global rule order, replace matching IDs in place, and append project-only rules in declaration order.
- Disable-only overrides are represented cleanly enough for the planned apply phase.
- The targeted merge test passes: `cd extensions/replace-prompt && npm test -- tests/merge-rules.test.ts`.

## Task 3 impact

I do **not** see a blocker for Task 3’s rule-application work specifically.

These findings should be fixed before Task 4/5, though, because they affect merged config semantics and logging destination behavior.