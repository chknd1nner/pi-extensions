# Code Review — Task 4 Re-review 02

## Findings

No remaining issues found in the reviewed Task 4 scope.

## Review outcome

**Task 4 should now pass review.**

The remaining soft-failure finding is fully resolved:

- **`applyRulesToPrompt` callback type widened to `string | null`** — `apply-rules.ts` now declares the `resolveReplacement` parameter as `(rule) => string | null`, accepting the contract that `resolveReplacementText` introduced in the prior fix.
- **Null handled as skip + warn inside the loop** — when the callback returns `null`, `applyRulesToPrompt` emits a `warn` event (`"replacement file not found"`) and `continue`s, leaving the prompt unchanged for that rule. `normalizeLineEndings` is only called on the non-null resolved string.
- **Regression test added** — `"skips a rule and records a warning when replacement resolution returns null"` directly covers the new path: the prompt is unchanged, `changed` is `false`, and the warn event is present with the correct `ruleId`.
- **Soft-failure chain is closed end-to-end** — `resolveReplacementText` returns `null` on missing/unreadable file → `applyRulesToPrompt` skips the rule and logs a warning → `before_agent_start` is not disrupted.

## All prior findings status

| Finding | Status |
|---|---|
| `resolveReplacementText` throws on missing file | ✅ Resolved (prior fix) |
| Three `tsc --noEmit` errors in `load-config.ts` | ✅ Resolved (prior fix) |
| `null` return not handled in `applyRulesToPrompt` | ✅ Resolved (this fix) |

## Validation

```bash
cd extensions/replace-prompt && npm test -- tests/load-config.test.ts tests/apply-rules.test.ts tests/merge-rules.test.ts tests/index.test.ts
```
- All 4 test files passed, 18 tests total.

```bash
cd extensions/replace-prompt && npx tsc --noEmit
```
- Exits 0, no errors.
