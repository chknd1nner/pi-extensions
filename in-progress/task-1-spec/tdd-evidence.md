# Task 1 TDD Evidence

Task: `Task 1: Bootstrap the test harness and extension skeleton`
Plan: `docs/superpowers/plans/2026-04-24-replace-prompt.md`

## RED

Command run before the extension harness existed:

```bash
cd extensions/replace-prompt && npm test -- tests/index.test.ts
```

Observed result from the session:

```text
npm error code ENOENT
npm error syscall open
npm error path /Users/martinkuek/Documents/Projects/pi-extensions/extensions/replace-prompt/package.json
npm error errno -2
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/Users/martinkuek/Documents/Projects/pi-extensions/extensions/replace-prompt/package.json'
```

This is the expected red state for Task 1 because the extension-local test harness had not been created yet.

## GREEN

After creating:
- `extensions/replace-prompt/package.json`
- `extensions/replace-prompt/tsconfig.json`
- `extensions/replace-prompt/index.ts`
- `extensions/replace-prompt/types.ts`
- `extensions/replace-prompt/tests/index.test.ts`

and installing extension-local dependencies, the following command was run:

```bash
cd extensions/replace-prompt && npm test -- tests/index.test.ts
```

Observed result from the session:

```text
RUN  v3.2.4 /Users/martinkuek/Documents/Projects/pi-extensions/extensions/replace-prompt

✓ tests/index.test.ts (1 test)

Test Files  1 passed (1)
Tests       1 passed (1)
```

This confirms the Task 1 bootstrap moved from red to green.
