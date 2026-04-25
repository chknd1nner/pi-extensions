# Code Review — Task 4: Implement config loading, validation, replacement resolution, and file logging

## Findings

### Medium — `resolveReplacementText` throws on a missing replacement file; spec requires soft failure

`resolve-replacement.ts` ends with `throw new Error(\`Replacement file not found for rule ${rule.id}\`)` when neither the project nor global directory contains the referenced file. The design spec is unambiguous:

- *"If no matching file is found or a file cannot be read, the rule is skipped and the issue is logged."* (spec line 227)
- *"invalid rules are skipped and logged rather than crashing the extension"* (spec line 174)
- *"The extension should fail softly and avoid disrupting Pi startup or normal prompt handling."* (spec line 355)

The plan's Task 5 `index.ts` passes `resolveReplacementText` directly as the `resolveReplacement` callback to `applyRulesToPrompt` with no surrounding try/catch. The throw will propagate through `applyRulesToPrompt` (which also has no catch) and surface as an uncaught error in `before_agent_start`, crashing the hook entirely rather than skipping the one offending rule.

There is no test covering this path, so the behavior is both wrong and untested.

The fix needs to be coordinated: `resolveReplacementText` should return `string | null` on a missing file (and the caller should treat null as "skip this rule and emit a warn event"), **or** Task 5's callback should catch the thrown error and handle it as a skip+log. Either way, the fix belongs before Task 5 is written so it doesn't inherit the wrong contract.

### Low — Three TypeScript errors in `load-config.ts` under the existing strict tsconfig

Running `tsc --noEmit` against the extension's own `tsconfig.json` (which has `"strict": true`) reports three errors:

**`load-config.ts:88` and `:104`** — `replacementFile` narrowing:
```ts
const hasFileReplacement = rawRule.replacementFile !== undefined;
// ...
{ kind: "file" as const, value: rawRule.replacementFile }
//                                ^^^^^^^^^^^^^^^^^^^^^^ string | undefined, not string
```
After the boolean check, TypeScript does not narrow `rawRule.replacementFile` from `string | undefined` to `string`. Fix: `rawRule.replacementFile!` or inline the undefined check.

**`load-config.ts:47`** — `getRawConfig` return type:
```ts
function getRawConfig(loaded: { default?: RawConfig } | RawConfig): RawConfig {
  // ...
  return loaded ?? {}; // ← loaded is still the full union here; not assignable to RawConfig
}
```
TypeScript cannot narrow the union from `"default" in loaded` being false. Fix: cast the return (`return (loaded ?? {}) as RawConfig`) or restructure the function.

Vitest/jiti strips types so tests pass regardless, but the codebase fails `tsc --noEmit`.

## Review outcome

**Task 4 should not pass review as-is** due to the missing-file throw behavior which violates the spec's soft-failure contract and will become a silent Task 5 trap.

## What looks good

- `loadScopeConfig` correctly preserves `logging.file: undefined` for omitted logging vs `false` for an explicit opt-out — the Task 2 fix flows through correctly.
- Duplicate ID detection (first wins) and empty literal target rejection both work correctly and are tested.
- `selectLogPath` correctly prefers `projectDir` over `globalDir`.
- Project replacement files resolve before global replacement files in `resolveReplacementText`.
- `appendLog` is silent when `logPath` is null or the events list is empty, matching the "silent by default" requirement.
- The `RawRule` / `RawConfig` type additions in `types.ts` are accurate and complete.
- All 16 tests across 4 test files pass.
- No Task 5 structural blockers beyond the missing-file issue noted above.
