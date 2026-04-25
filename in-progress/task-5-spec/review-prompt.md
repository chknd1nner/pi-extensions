Review Task 5 for the replace-prompt implementation plan.

Scope:
- Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`
- Task: `Task 5: Wire the runtime, add the sample config, and verify end-to-end behavior`
- Branch: `feature/replace-prompt`
- Commit to review: `4e8ac26` (`feat: add configurable replace-prompt extension`)

Files in scope:
- `extensions/replace-prompt/index.ts`
- `extensions/replace-prompt/rules.ts`
- `extensions/replace-prompt/opening.md`
- `extensions/replace-prompt/tests/index.test.ts`
- `README.md`

Context:
- Tasks 1-4 are complete.
- Task 5 was implemented with TDD in-session.
- RED verification run:
  - `cd extensions/replace-prompt && npm test -- tests/index.test.ts`
  - failed because `index.ts` still returned `undefined` for the changed case
- GREEN verification runs:
  - `cd extensions/replace-prompt && npm test -- tests/index.test.ts tests/load-config.test.ts tests/apply-rules.test.ts tests/merge-rules.test.ts`
  - passed with `4` test files and `19` tests total
  - `cd extensions/replace-prompt && npm test`
  - passed with `4` test files and `19` tests total
  - `cd extensions/replace-prompt && npx tsc --noEmit`
  - passed with no output
- During verification, one strict TypeScript issue in `index.ts` (`event.cwd` missing on `BeforeAgentStartEvent`) was found and fixed before the final green run.

Review for:
- Conformance to Task 5 in the plan
- Runtime wiring in `before_agent_start`
- Discovery of global + project extension directories
- Correct loading and merging of global/project configs
- Project replacement files winning over global replacement files at runtime
- Logging to the most specific installed extension directory
- Returning a modified `systemPrompt` only when prompt text actually changes
- Safe no-op behavior when nothing matches or no rules are configured
- Sample shipped config correctness and README discoverability
- Any remaining issues that would block final completion

Important repo constraints:
- Keep tooling isolated under `extensions/replace-prompt/`
- Do not move `package.json` or `tsconfig.json` to repo root
- The extension must support merged global + project `rules.ts` configs
- Project rules override global rules by `id`
- Project override preserves inherited position; new project rules append
- Support `type: "literal"` and `type: "regex"`
- Support inline replacement text or `replacementFile`
- Project replacement files win over global replacement files
- `mode` controls `first` vs `all`
- Ignore regex `g` flag in favor of `mode`
- Support disable-only overrides with `{ id, enabled: false }`
- Normalize line endings to `\n` before matching/replacement
- Silent by default; optional file logging to the most specific extension directory

Please write your review to:
- `in-progress/task-5-spec/code-review.md`

In the review output:
- List findings first, ordered by severity
- Be explicit about whether Task 5 should pass review as-is
- If there are no issues, say so clearly
