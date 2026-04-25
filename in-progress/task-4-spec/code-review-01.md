# Code Review — Task 4 Re-review 01

## Findings

### Medium — `resolveReplacementText` returns `string | null` but `applyRulesToPrompt`'s callback contract still requires `string`; null propagation crashes rather than skips

The throw was replaced with `return null`, which is the right direction. But the fix is incomplete because the type contract was not closed end-to-end:

- `applyRulesToPrompt` (`apply-rules.ts:16`) declares its callback as `(rule) => string`.
- `applyRulesToPrompt` (`apply-rules.ts:28`) passes the callback result directly to `normalizeLineEndings(resolveReplacement(rule))`.
- `normalizeLineEndings` calls `.replace()` on its argument. Passing `null` throws `Cannot read properties of null (reading 'replace')` — confirmed with a live Node probe.

This means the behaviour on a missing replacement file has changed from **"throw a named Error"** to **"throw a TypeError mid-loop"**, which still crashes `before_agent_start` instead of skipping the rule and logging a warning, as the spec requires:

> *"If no matching file is found or a file cannot be read, the rule is skipped and the issue is logged."* (spec line 227)
> *"The extension should fail softly and avoid disrupting Pi startup or normal prompt handling."* (spec line 355)

The plan's Task 5 `index.ts` passes `resolveReplacementText` as the callback with no null guard:
```ts
(rule) => resolveReplacementText(rule, { globalDir: merged.globalDir, projectDir: merged.projectDir })
```
TypeScript would flag this as a type error (callback returns `string | null`, parameter expects `string`), and at runtime any missing file would propagate a TypeError through `applyRulesToPrompt`.

The fix requires updating `applyRulesToPrompt` to accept a `(rule) => string | null` callback and treat `null` as "skip this rule + emit a `warn` event". That is a one-line type change to the parameter plus a null-check inside the loop:

```ts
// apply-rules.ts — callback type
resolveReplacement: (rule: Exclude<NormalizedRule, { enabled: false }>) => string | null

// apply-rules.ts — inside the loop, after resolveReplacement call
const replacement = resolveReplacement(rule);
if (replacement === null) {
  events.push({ level: "warn", message: "replacement file not found", ruleId: rule.id });
  continue;
}
```

## Previous findings status

| Finding | Status |
|---|---|
| `resolveReplacementText` throws on missing file | Partially addressed — no longer throws, but null propagation is not handled downstream |
| Three `tsc --noEmit` errors in `load-config.ts` | ✅ Resolved — `tsc --noEmit` exits 0 |

## Review outcome

**Task 4 should not pass review as-is.** The soft-failure contract is still not complete: the null return is introduced but the module that consumes it (`applyRulesToPrompt`) has not been updated to handle it, so a missing replacement file still crashes the hook.

## Validation

```bash
cd extensions/replace-prompt && npm test -- tests/load-config.test.ts tests/apply-rules.test.ts tests/merge-rules.test.ts tests/index.test.ts
```
- All 4 test files pass, 17 tests total.

```bash
cd extensions/replace-prompt && npx tsc --noEmit
```
- Exits 0, no errors.
