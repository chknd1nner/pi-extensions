Review Task 3 for the replace-prompt implementation plan.

Scope:
- Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`
- Task: `Task 3: Implement prompt application with line-ending normalization and regex mode control`
- Branch: `feature/replace-prompt`
- Commit to review: `de10a37` (`feat: add replace-prompt rule application engine`)

Files in scope:
- `extensions/replace-prompt/types.ts`
- `extensions/replace-prompt/apply-rules.ts`
- `extensions/replace-prompt/tests/apply-rules.test.ts`

Context:
- Task 2 is complete.
- Task 3 was implemented with TDD in-session.
- RED verification run:
  - `cd extensions/replace-prompt && npm test -- tests/apply-rules.test.ts`
  - failed because `../apply-rules` did not exist yet
- GREEN verification run:
  - `cd extensions/replace-prompt && npm test -- tests/apply-rules.test.ts tests/merge-rules.test.ts tests/index.test.ts`
  - passed with `3` test files and `9` tests total

Review for:
- Conformance to Task 3 in the plan
- Line-ending normalization to `\n` before matching/replacement
- Literal replacement behavior
- Regex replacement behavior
- `mode: "first" | "all"` semantics
- Ignoring regex `g` in favor of `mode`
- Empty replacement support for deletions
- Logging event behavior for disabled rules and misses
- Any issues that would block Task 4

Important repo constraints:
- Support `type: "literal"` and `type: "regex"`
- `mode` controls `first` vs `all`
- Ignore regex `g` flag in favor of `mode`
- Normalize line endings to `\n` before matching/replacement
- Silent by default; logging is optional and will be wired later

Please write your review to:
- `in-progress/task-3-spec/code-review.md`

In the review output:
- List findings first, ordered by severity
- Be explicit about whether Task 3 should pass review as-is
- If there are no issues, say so clearly
