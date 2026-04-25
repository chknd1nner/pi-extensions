# Code Review — Task 5 Re-review 01

## Findings

No remaining issues found in the reviewed Task 5 scope.

## Review outcome

**Task 5 should now pass review.**

The previously reported finding is fully resolved:

- **`getScopeDirs` now checks whether the project extension directory exists on disk** — `fs.existsSync(projectCandidate)` gates the assignment of `projectDir`; if the directory is absent, `projectDir` is `null`. `selectLogPath` then falls through to the global directory, so `appendLog` always writes to a path whose parent directory is guaranteed to exist.
- **`loadScopeConfig` for the project scope is now guarded** — the call is skipped entirely when `installedDirs.projectDir` is `null`, removing a redundant `existsSync` check inside `loadScopeConfig` for the already-known-absent case.
- **Regression test added** — `"falls back to the global log directory when no project extension directory is installed"` directly exercises the reported crash scenario: no project extension directory is created, global has `logging: { file: true }`, replacement uses the global file, and the log is confirmed written to the global directory only.

## Validation

```bash
cd extensions/replace-prompt && npm test
```
- All 4 test files passed, 20 tests total.

```bash
cd extensions/replace-prompt && npx tsc --noEmit
```
- Exits 0, no errors.
