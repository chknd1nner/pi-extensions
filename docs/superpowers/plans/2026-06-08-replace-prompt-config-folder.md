# Replace Prompt Config Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move replace-prompt user config out of extension install directories into dedicated `replace-prompt` config folders with no backward compatibility.

**Architecture:** `index.ts` discovers global and project config folders at `~/.pi/agent/replace-prompt` and `<cwd>/.pi/replace-prompt`. `loadScopeConfig` continues to import `rules.ts` from a supplied config folder, so `replacementFile` and logs remain folder-relative. Docs, tests, package metadata, and this repo's active config are updated to match.

**Tech Stack:** TypeScript, Pi extension API, jiti, Vitest, npm workspaces.

---

### Task 1: Config folder discovery and tests

**Files:**
- Modify: `packages/replace-prompt/tests/index.test.ts`
- Modify: `packages/replace-prompt/index.ts`
- Modify: `packages/replace-prompt/tests/load-config.test.ts`
- Modify: `packages/replace-prompt/tests/merge-rules.test.ts`

- [ ] **Step 1: Update tests to expect `.pi/replace-prompt` and `~/.pi/agent/replace-prompt`**

Change test fixture directory strings from extension install paths to config folder paths. Add a regression assertion that an old `.pi/extensions/replace-prompt/rules.ts` is ignored.

- [ ] **Step 2: Run package tests and verify the updated tests fail**

Run: `npm test -w pi-replace-prompt -- --runInBand`
Expected: FAIL because `index.ts` still discovers old extension directories.

- [ ] **Step 3: Update `getScopeDirs` in `index.ts`**

Use global directory `${HOME}/.pi/agent/replace-prompt` and project directory `${cwd}/.pi/replace-prompt`; project directory is present only when that folder exists. Do not read or fallback to `.pi/extensions/replace-prompt`.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -w pi-replace-prompt`
Expected: PASS.

### Task 2: Docs, package metadata, and repo config move

**Files:**
- Modify: `packages/replace-prompt/README.md`
- Modify: `packages/replace-prompt/docs/usage.md`
- Modify: `packages/replace-prompt/package.json`
- Delete: `packages/replace-prompt/rules.ts`
- Move: `.pi/extensions/replace-prompt/rules.ts` to `.pi/replace-prompt/rules.ts`

- [ ] **Step 1: Update documentation**

Replace references to extension config folders with `~/.pi/agent/replace-prompt/rules.ts` and `<project>/.pi/replace-prompt/rules.ts`; explain replacement files and logs live in the same folder.

- [ ] **Step 2: Update package metadata**

Set repository/homepage directory to `packages/replace-prompt`; remove packaged starter config from source/files so installs do not imply user config belongs inside the package.

- [ ] **Step 3: Move this repo's active project config**

Create `.pi/replace-prompt/rules.ts` with the existing contents of `.pi/extensions/replace-prompt/rules.ts`, then remove the old file/directory.

- [ ] **Step 4: Verify package setup**

Run: `npm run typecheck -w pi-replace-prompt` and `npm test -w pi-replace-prompt`.
Expected: both PASS.

### Task 3: Install globally

**Files:**
- Modify: `~/.pi/agent/settings.json` via `pi install` or package settings reconciliation

- [ ] **Step 1: Install the updated package globally from local package source**

Run: `pi install /Users/martinkuek/Documents/Projects/pi-extensions/packages/replace-prompt`
Expected: global settings includes the local package path and Pi can load `index.ts` from the package manifest.

- [ ] **Step 2: Confirm installed settings**

Read `~/.pi/agent/settings.json` and verify `packages` includes `/Users/martinkuek/Documents/Projects/pi-extensions/packages/replace-prompt`.
