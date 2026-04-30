# Code Review — Task 5: Wire the runtime, add the sample config, and verify end-to-end behavior

## Findings

### Medium — `getScopeDirs` always passes a non-null `projectDir` to `mergeScopeConfigs`, causing `appendLog` to throw ENOENT when the project extension directory does not exist on disk

`getScopeDirs` computes `projectDir` as a pure path join with no existence check:

```ts
const projectDir = path.join(cwd, ".pi/extensions/replace-prompt");
```

This non-null value is passed directly as `installedDirs.projectDir`, which makes `merged.projectDir` non-null for every invocation. `selectLogPath` always prefers `projectDir ?? globalDir`, so when global logging is enabled, the log path always resolves to the project-local directory — even when that directory has never been created on disk.

`appendLog` calls `fs.appendFileSync(logPath, ...)` with no guard. Writing to a path whose parent directory does not exist throws `ENOENT: no such file or directory`. There is no try/catch around `appendLog` in `index.ts`, so the error propagates to `before_agent_start` and crashes the hook.

**Confirmed with a live probe:**
```
projectDir: /tmp/.pi/extensions/replace-prompt
projectDir exists: false
appendFileSync to non-existent dir → ENOENT: no such file or directory
```

**Scenario that triggers it:** user has a global extension with `logging: { file: true }` and runs Pi in any project that has no `.pi/extensions/replace-prompt/` directory.

The design spec says to use the most specific *installed* extension directory for the log:
> *"if the project-local extension exists, write to `.pi/extensions/replace-prompt/replace-prompt.log`"*

"Exists" implies the directory is present on disk. The fix is a single `fs.existsSync` guard in `getScopeDirs`:

```ts
function getScopeDirs(cwd: string) {
  const globalDir = process.env.HOME
    ? path.join(process.env.HOME, ".pi/agent/extensions/replace-prompt")
    : null;
  const candidate = path.join(cwd, ".pi/extensions/replace-prompt");
  const projectDir = fs.existsSync(candidate) ? candidate : null;
  return { globalDir, projectDir };
}
```

The existing integration test does not catch this because it explicitly creates `projectExtDir` before invoking the handler. A global-only installation (no project extension directory at all) is not covered.

## Review outcome

**Task 5 should not pass review as-is** due to the ENOENT crash for any global-only installation with file logging enabled.

## What looks good

- All modules are wired in the correct order: discover dirs → load configs → merge → apply rules → log → return.
- `installedDirs` is passed correctly to `mergeScopeConfigs` as a separate argument, carrying through the Task 2 fix.
- `.catch(() => null)` on both `loadScopeConfig` calls ensures config loading failures are soft.
- Project replacement file wins over global replacement file — confirmed by the integration test.
- Logging path is the project ext dir when it exists — confirmed by the integration test.
- No-op return (`undefined`) when no rules are configured and when prompt is unchanged.
- Logging runs for both the changed and unchanged calls, capturing miss events — integration test verifies both the applied and unmatched log lines.
- `rules.ts` sample config and `opening.md` are correct and match the plan.
- README discoverability entries are present.
- All 19 tests pass and `tsc --noEmit` exits 0.
