Re-review Task 3 for the replace-prompt implementation plan after follow-up fixes.

Scope:
- Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`
- Task: `Task 3: Implement prompt application with line-ending normalization and regex mode control`
- Branch: `feature/replace-prompt`
- Prior review: `in-progress/task-3-spec/code-review.md`
- Fix commit to review: `b3c2840` (`fix: preserve literal replacement dollar text`)

Files in scope:
- `extensions/replace-prompt/apply-rules.ts`
- `extensions/replace-prompt/tests/apply-rules.test.ts`

Please verify the previously reported issue is resolved:
- literal `mode: "first"` replacements now treat replacement text literally and do not interpret `$` sequences like `$&`, `$$`, `$'`, or ``$` `` as substitution patterns

TDD evidence for the fix:

RED:
```bash
cd extensions/replace-prompt && npm test -- tests/apply-rules.test.ts
```
Observed failure:
- `treats literal mode first replacements as plain text even when they contain dollar patterns`
- actual output was `Hi Hello there World`
- expected output was `Hi $& there World`

GREEN:
```bash
cd extensions/replace-prompt && npm test -- tests/apply-rules.test.ts tests/merge-rules.test.ts tests/index.test.ts
```
Observed result:
- `tests/apply-rules.test.ts` passed
- `tests/merge-rules.test.ts` passed
- `tests/index.test.ts` passed
- `10 tests` passed total

Review for:
- Whether the reported Task 3 finding is fully resolved
- Whether Task 3 should now pass review
- Any remaining issues that should block Task 3 from passing review

Please write your re-review to:
- `in-progress/task-3-spec/code-review-01.md`

In the re-review output:
- List findings first, ordered by severity
- Be explicit about whether Task 3 should now pass review
- If there are no issues, say so clearly
