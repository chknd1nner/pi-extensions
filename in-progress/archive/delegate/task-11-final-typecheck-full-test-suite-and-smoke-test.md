---
task_number: 11
title: Final Typecheck, Full Test Suite, and Smoke Test
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Check off steps as you complete them (- [x]).
  Run verification commands and confirm they pass.
  Commit when all steps are complete.

  Hint: make the final smoke test explicitly verify the delegate progress log file under .pi/delegate/<date>/<sessionId>/w1.progress.md. If the session id is not known ahead of time, derive it from the runtime state or locate the newest delegate session directory before asserting contents.

  Review note from task-06: `DelegateStartParams` still includes `visibility`, but `delegate_start` does not expose that parameter in its schema yet. If you touch the extension before final verification, either expose the documented log-only `visibility` option or remove the dead type field so schema and types stay in sync.
review_prompt_template: |-
  Review Task 11: Final Typecheck, Full Test Suite, and Smoke Test

  Perform a TWO-STAGE REVIEW:

  ## Stage 1: Spec Review
  Compare implementation against the design spec.
  - Read the spec_path document (if provided)
  - Check: Does implementation match spec intent?
  - Check: Any divergences from spec requirements?
  - Check: Missing spec requirements?

  If MAJOR spec issues found, you may terminate review early.
  If minor spec divergences, note them and continue to Stage 2.

  ## Stage 2: Code Review
  Use the superpowers:requesting-code-review skill approach.
  - Get git diff for this task's changes
  - Check code quality, architecture, testing
  - Categorize issues: Critical / Important / Minor

  ## Review Output

  ### Spec Compliance
  [Matches spec / Minor divergences / Major divergences]
  [List any divergences with spec section references]

  ### Code Quality
  [Strengths and issues per code-reviewer format]

  ### Verdict
  If task passes BOTH stages:
  - Move ticket to done status (ticket_move task-11 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-11 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: 'Verified on merged `main`: `cd extensions/delegate && DELEGATE_INTEGRATION=1 DELEGATE_INTEGRATION_PROVIDER=openai-codex DELEGATE_INTEGRATION_MODEL=gpt-5.4-mini npx vitest run tests/integration.test.ts` passed (1 test). In-session manual smoke test also passed: `delegate_start` launched an `openai-codex/gpt-5.4-mini` worker, `delegate_check` observed progress/completion, and `delegate_result` returned a correct repository-exploration answer. Non-interactive `pi --print` was separately confirmed to hang even without the delegate extension loaded, so that CLI issue appears upstream of this extension.'
---

# Task 11 — Final Typecheck, Full Test Suite, and Smoke Test

## Plan excerpt

**Files:**
- No new files; verification only.

- [x] **Step 1: Run full typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 2: Run full unit test suite**

Run: `cd extensions/delegate && npx vitest run`
Expected: All tests PASS

- [x] **Step 3: Smoke test — load extension in Pi**

Run: `pi -e extensions/delegate/index.ts --print "List all tools whose names start with 'delegate'. For each one, show its name and a one-line description."`
Expected: Pi lists all 5 tools: `delegate_start`, `delegate_check`, `delegate_steer`, `delegate_abort`, `delegate_result`.

- [x] **Step 4: Smoke test — spawn a real worker**

Run: `pi -e extensions/delegate/index.ts --print "Use delegate_start to spawn a worker with model claude-haiku-4-5, provider anthropic, task: 'Reply with exactly: SMOKE_TEST_OK'. Then wait 10 seconds and use delegate_check to check its status. Then use delegate_result to read the output."`
Expected: Pi spawns the worker, checks it, and reads the result containing `SMOKE_TEST_OK`.

- [x] **Step 5: Verify progress log file was created**

Run: `ls -la .pi/delegate/$(date +%Y-%m-%d)/`
Expected: A directory with a session subfolder containing a `w1.progress.md` file.

- [x] **Step 6: Commit (if any adjustments were needed)**

```bash
git add -A extensions/delegate/
git commit -m "fix(delegate): adjustments from smoke testing"
```

Only commit if changes were made during smoke testing. If everything passed clean, no commit needed.


---

## Notes

- `npx tsc --noEmit` passed in `extensions/delegate/`.
- `npx vitest run` passed in `extensions/delegate/` (56 passed, 1 skipped).
- `DELEGATE_INTEGRATION=1 DELEGATE_INTEGRATION_PROVIDER=openai-codex DELEGATE_INTEGRATION_MODEL=gpt-5.4-mini npx vitest run tests/integration.test.ts` passed and verified a real worker lifecycle plus `.pi/delegate/<date>/<sessionId>/w1.progress.md` creation/content.
- `delegate_start` schema was adjusted to expose the documented log-only `visibility` parameter, with a regression test added first via TDD.
- Non-interactive `pi --print` in this environment prints correct output but does not exit cleanly, even without the delegate extension loaded. Delegate-specific behavior appears correct; final interactive smoke testing is deferred per user instruction.
- Commit on implementation branch: `e176e02` (`fix(delegate): expose log-only visibility option`).
