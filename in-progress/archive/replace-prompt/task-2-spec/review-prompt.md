Review Task 2 for the replace-prompt implementation plan.

Scope:
- Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`
- Task: `Task 2: Implement rule typing, validation, and merge behavior`
- Branch: `feature/replace-prompt`
- Commit to review: `5578b47` (`feat: add replace-prompt merge model`)

Files in scope:
- `extensions/replace-prompt/types.ts`
- `extensions/replace-prompt/merge-rules.ts`
- `extensions/replace-prompt/tests/merge-rules.test.ts`

Context:
- Task 1 is complete.
- Task 2 was implemented with TDD in-session: the merge test was written first, failed due to missing `merge-rules.ts`, then passed after implementation.

Review for:
- Conformance to Task 2 in the plan
- Correct merged global + project config semantics
- Project override by `id`
- Preservation of inherited rule position for overrides
- Appending of project-only rules
- Correct merged logging and base-dir selection behavior
- Any issues that would block Task 3

Important repo constraints:
- Keep tooling isolated under `extensions/replace-prompt/`
- Do not move `package.json` or `tsconfig.json` to repo root
- The extension must support merged global + project `rules.ts` configs
- Project rules override global rules by `id`
- Project override preserves inherited position; new project rules append
- Support disable-only overrides with `{ id, enabled: false }`

Please write your review to:
- `in-progress/task-2-spec/code-review.md`

In the review output:
- List findings first, ordered by severity
- Be explicit about whether Task 2 should pass review as-is
- If there are no issues, say so clearly
