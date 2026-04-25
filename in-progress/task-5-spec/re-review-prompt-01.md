Re-review Task 5 for the replace-prompt implementation plan after follow-up fixes.

Scope:
- Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`
- Task: `Task 5: Wire the runtime, add the sample config, and verify end-to-end behavior`
- Branch: `feature/replace-prompt`
- Prior review: `in-progress/task-5-spec/code-review.md`
- Fix commit to review: `47317c6` (`fix: guard missing project replace-prompt dir`)

Files in scope:
- `extensions/replace-prompt/index.ts`
- `extensions/replace-prompt/tests/index.test.ts`

Please verify the previously reported issue is resolved:
- when no project-local `extensions/replace-prompt/` directory exists, runtime now treats project scope as not installed
- logging falls back to the global extension directory instead of attempting to write into a non-existent project path
- global-only installs with `logging: { file: true }` no longer crash with `ENOENT`

TDD / verification evidence for this fix:

RED:
```bash
cd extensions/replace-prompt && npm test -- tests/index.test.ts
```
Observed failure:
- `falls back to the global log directory when no project extension directory is installed`
- runtime error: `ENOENT: no such file or directory, open '.../.pi/extensions/replace-prompt/replace-prompt.log'`

GREEN:
```bash
cd extensions/replace-prompt && npm test -- tests/index.test.ts tests/load-config.test.ts tests/apply-rules.test.ts tests/merge-rules.test.ts
cd extensions/replace-prompt && npm test
cd extensions/replace-prompt && npx tsc --noEmit
```
Observed result:
- focused suite passed: `20 tests` total
- full suite passed: `20 tests` total
- `npx tsc --noEmit` completed with no output and exit code 0

Review for:
- Whether the missing project-directory issue is fully resolved
- Whether Task 5 should now pass review
- Any remaining issues that should block Task 5 from passing review

Please write your re-review to:
- `in-progress/task-5-spec/code-review-01.md`

In the re-review output:
- List findings first, ordered by severity
- Be explicit about whether Task 5 should now pass review
- If there are no issues, say so clearly
