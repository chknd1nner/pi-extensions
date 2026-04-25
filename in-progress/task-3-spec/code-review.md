# Code Review — Task 3: Implement prompt application with line-ending normalization and regex mode control

## Findings

### Medium — Literal `mode: "first"` interprets `$` in replacement strings as substitution patterns

`applyRulesToPrompt` uses `nextPrompt.replace(target, replacement)` for literal rules with `mode: "first"` (`extensions/replace-prompt/apply-rules.ts:36-38`). `String.prototype.replace(string, string)` treats several `$` sequences in the second argument as special:

| Pattern in replacement | Inserts |
|---|---|
| `$$` | `$` |
| `$&` | the matched substring |
| `$'` | portion of string after the match |
| `` $` `` | portion of string before the match |

This means a literal replacement text like `"Hi $& there"` silently expands to `"Hi Hello there"` instead of `"Hi $& there"`, and `"$$5.00"` is silently reduced to `"$5.00"`.

The `mode: "all"` path (`split/join`) is not affected. Regex rules are not affected (capture-group references in replacement are expected behavior for regex mode).

**Evidence:**
```
Input:       "Hello World"
Target:      "Hello"
Replacement: "Hi $& there"
Output:      "Hi Hello there World"   ← actual
Expected:    "Hi $& there World"      ← what the user intended

Replacement: "$$5.00 price"
Output:      "$5.00 price World"      ← actual
Expected:    "$$5.00 price World"     ← what the user intended
```

**Fix:** Replace the string form with a function replacement to suppress `$` expansion:

```ts
// before
nextPrompt.replace(target, replacement);

// after
nextPrompt.replace(target, () => replacement);
```

`String.prototype.replace` with a function callback never applies `$` substitution to the return value.

## Review outcome

**Task 3 should not pass review as-is** due to the literal `mode: "first"` `$`-expansion bug.

## What looks good

- Line-ending normalization (`/\r\n?/g → "\n"`) is correct and applied consistently to both input and replacement text.
- `cloneRegexForMode` correctly strips any existing `g` flag and adds it only when `mode === "all"`, giving `mode` full authority over repeat behavior.
- The `changed` field is computed against the correctly normalized original, so CRLF-only differences are not falsely reported as changes.
- Literal `mode: "all"` uses `split/join` which is both correct and free of `$` special-char issues.
- Disabled rule events and miss events are emitted correctly.
- All 4 plan-specified tests pass and cover the required scenarios.
- `LogEvent` and `ApplyResult` types added to `types.ts` are correct and will compose cleanly with Task 4's logging and config loading.
- No blockers for Task 4.
