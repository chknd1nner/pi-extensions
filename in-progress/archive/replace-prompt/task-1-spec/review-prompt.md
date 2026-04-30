Review Task 1 for the replace-prompt implementation plan.

Scope:
- Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`
- Task: `Task 1: Bootstrap the test harness and extension skeleton`
- Branch: `feature/replace-prompt`
- Commit to review: `0cadcd8` (`test: bootstrap replace-prompt extension harness`)

Files in scope:
- `extensions/replace-prompt/package.json`
- `extensions/replace-prompt/package-lock.json`
- `extensions/replace-prompt/tsconfig.json`
- `extensions/replace-prompt/index.ts`
- `extensions/replace-prompt/types.ts`
- `extensions/replace-prompt/tests/index.test.ts`
- `in-progress/tasks.md`

Review for:
- Conformance to Task 1 in the plan
- TDD evidence for the smoke test bootstrap
- Minimal, correct extension harness setup under `extensions/replace-prompt/`
- Any issues that would block Task 2
- Any accidental deviation from repo constraints

Important repo constraints:
- Keep tooling isolated under `extensions/replace-prompt/`
- Do not move `package.json` or `tsconfig.json` to repo root
- We are following the plan task-by-task with review checkpoints

Please write your review to:
- `in-progress/task-1-spec/code-review.md`

In the review output:
- List findings first, ordered by severity
- Be explicit about whether Task 1 should pass review as-is
- If there are no issues, say so clearly
