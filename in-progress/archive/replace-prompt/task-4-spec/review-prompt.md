Review Task 4 for the replace-prompt implementation plan.

Scope:
- Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`
- Task: `Task 4: Implement config loading, validation, replacement resolution, and file logging`
- Branch: `feature/replace-prompt`
- Commit to review: `d60d3c2` (`feat: add replace-prompt config loading and logging`)

Files in scope:
- `extensions/replace-prompt/types.ts`
- `extensions/replace-prompt/load-config.ts`
- `extensions/replace-prompt/resolve-replacement.ts`
- `extensions/replace-prompt/logging.ts`
- `extensions/replace-prompt/tests/load-config.test.ts`

Context:
- Tasks 1-3 are complete.
- Task 4 was implemented with TDD in-session.
- RED verification run:
  - `cd extensions/replace-prompt && npm test -- tests/load-config.test.ts`
  - failed because the new modules (`../logging`, then transitively loader/resolver) did not exist yet
- GREEN verification run:
  - `cd extensions/replace-prompt && npm test -- tests/load-config.test.ts tests/apply-rules.test.ts tests/merge-rules.test.ts tests/index.test.ts`
  - passed with `4` test files and `16` tests total

Review for:
- Conformance to Task 4 in the plan
- Raw config typing for `rules.ts`
- Config discovery and `rules.ts` loading via `jiti`
- Validation behavior for duplicate IDs and invalid literal targets
- Preservation of explicit `logging.file: false` vs omitted logging
- Support for inline replacement text and `replacementFile`
- Project replacement files winning over global replacement files
- Correct log path selection for the most specific installed scope
- Correct file logging behavior
- Any issues that would block Task 5

Important repo constraints:
- The extension must support merged global + project `rules.ts` configs
- Support inline replacement text or `replacementFile`
- Project replacement files win over global replacement files
- Support disable-only overrides with `{ id, enabled: false }`
- Silent by default; optional file logging to the most specific extension directory
- Keep tooling isolated under `extensions/replace-prompt/`

Please write your review to:
- `in-progress/task-4-spec/code-review.md`

In the review output:
- List findings first, ordered by severity
- Be explicit about whether Task 4 should pass review as-is
- If there are no issues, say so clearly
