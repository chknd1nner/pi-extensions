# Delegate Worker Default Five Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the delegate extension's default concurrent-worker limit to five, document its environment override, and publish v0.3.2.

**Architecture:** Keep `WorkerManager` and its existing environment-variable precedence unchanged. Change only the fallback supplied by the delegate extension, synchronize model guidance and consumer documentation, then use the repository release script.

**Tech Stack:** TypeScript, Vitest, npm workspaces, Bash release tooling.

## Global Constraints

- Preserve `DELEGATE_MAX_WORKERS` as the only user override.
- Defer first-class JSON configuration.
- Do not change tool schemas, worker lifecycle, or RPC behavior.
- Release annotated unsigned tags as v0.3.2.

---

### Task 1: Raise and document the default

**Files:**
- Create: `packages/pi-delegate-driven-development/extensions/delegate/tests/index.worker-limit.test.ts`
- Modify: `packages/pi-delegate-driven-development/extensions/delegate/index.ts:160-184`
- Modify: `packages/pi-delegate-driven-development/README.md`
- Modify: `packages/pi-delegate-driven-development/CHANGELOG.md`

**Interfaces:**
- Consumes: `WorkerManager({ maxWorkers, projectRoot, maxWorkersEnv })` and `DELEGATE_MAX_WORKERS` precedence already implemented in `worker-manager.ts`.
- Produces: a fallback limit of five and matching `delegate_start` guidance; no public TypeScript API changes.

- [ ] **Step 1: Run the existing bundle suite as a baseline**

Run:

```bash
npm test -w pi-delegate-driven-development
```

Expected: all existing tests pass.

- [ ] **Step 2: Write a failing extension-wiring test**

Create `index.worker-limit.test.ts` with a hoisted `WorkerManager` constructor mock, initialize the delegate extension with a minimal fake `ExtensionAPI`, and assert:

```ts
expect(workerManagerCtor).toHaveBeenCalledWith(
  expect.objectContaining({ maxWorkers: 5 }),
);
```

- [ ] **Step 3: Verify the focused test fails for the old default**

Run:

```bash
npx vitest run --cache=false packages/pi-delegate-driven-development/extensions/delegate/tests/index.worker-limit.test.ts
```

Expected: FAIL because the constructor receives `maxWorkers: 2`.

- [ ] **Step 4: Apply the minimal behavior and guidance change**

In `extensions/delegate/index.ts`, change:

```ts
maxWorkers: 2,
```

to:

```ts
maxWorkers: 5,
```

and change the prompt guideline to:

```ts
"Maximum 5 concurrent workers by default.",
```

- [ ] **Step 5: Update consumer documentation**

In `README.md`:

- change every install example to `v0.3.2`;
- add a concurrency section stating that five workers are allowed by default;
- show `DELEGATE_MAX_WORKERS=8 pi` as an override example;
- state that only positive integers override the default and invalid values fall back to five.

In `CHANGELOG.md`, remove only the duplicate placeholder v0.3.1 section, retaining the completed v0.3.1 entry.

- [ ] **Step 6: Verify behavior, types, and documentation**

Run:

```bash
npm test -w pi-delegate-driven-development
npm run typecheck -w pi-delegate-driven-development
rg -n 'Maximum 2|maxWorkers: 2|@v0\.3\.0|describe changes' packages/pi-delegate-driven-development
```

Expected: tests and typecheck pass; the search returns only intentional generic unit-test fixtures using `maxWorkers: 2`, and no stale guidance, install version, or changelog placeholder.

- [ ] **Step 7: Commit and push the implementation**

```bash
git add docs/superpowers/plans/2026-08-08-delegate-worker-default-five.md \
  packages/pi-delegate-driven-development/extensions/delegate/index.ts \
  packages/pi-delegate-driven-development/extensions/delegate/tests/index.worker-limit.test.ts \
  packages/pi-delegate-driven-development/README.md \
  packages/pi-delegate-driven-development/CHANGELOG.md
git commit -m "feat(delegate): raise default worker limit to five"
git push origin main
```

Expected: `main` is clean and synchronized with `origin/main`.

---

### Task 2: Release and verify v0.3.2

**Files:**
- Modify through release script: `packages/pi-delegate-driven-development/package.json`
- Modify through release script: `packages/pi-delegate-driven-development/CHANGELOG.md`

**Interfaces:**
- Consumes: clean synchronized `main`, passing bundle verification, and `scripts/release-bundle.sh`.
- Produces: monorepo tag `pi-delegate-driven-development-v0.3.2` and mirror tag `v0.3.2`.

- [ ] **Step 1: Run release preflight**

Confirm tests, typecheck, clean synchronized `main`, reachable mirror, accurate README/manifest, and no unresolved changed-source placeholders.

- [ ] **Step 2: Publish with the repository release script**

Run the script with a temporary non-interactive editor shim that replaces the generated v0.3.2 placeholder with:

```markdown
- Raise the default delegate worker concurrency limit from two to five.
- Document the `DELEGATE_MAX_WORKERS` environment-variable override.
```

Then invoke:

```bash
./scripts/release-bundle.sh pi-delegate-driven-development v0.3.2
```

Expected: the script publishes the mirror, creates both tags, pushes `main`, and reports success.

- [ ] **Step 3: Verify the published package in isolation**

In a throwaway directory:

```bash
pi install -l git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.2
pi -a --print "Without calling tools, quote the delegate_start guidance that states its default concurrent-worker limit."
```

Expected: the package cache is at the released commit and the fresh session quotes a default limit of five.

- [ ] **Step 4: Report release evidence**

Report the mirror URL, tag URL, install spec, released commit, and isolated Pi verification output.
