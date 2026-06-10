# Delegate Start Wait Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `delegate_start` return easy-to-find artifact paths plus a self-contained status-file wait recipe that composes with async/background command runners when available and falls back to blocking shell execution when not.

**Architecture:** Keep the delegate lifecycle unchanged and enrich only the `delegate_start` result and tool guidance. Add small pure helpers in `extensions/delegate/index.ts` to produce project-relative artifact paths, shell-safe commands, and a structured watch object; update tests to verify the new details, human text, and prompt guidance.

**Tech Stack:** TypeScript, Vitest, TypeBox, `@earendil-works/pi-coding-agent`, Node `path` utilities, Bash status-file polling.

**Spec:** `docs/superpowers/specs/2026-06-11-delegate-start-wait-guidance-design.md`

---

## File Map

**Modified**
- `packages/pi-delegate-driven-development/extensions/delegate/index.ts` — add wait-recipe helpers; update `delegate_start` prompt guidance, result text, and details payload.
- `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts` — assert enriched `delegate_start` details, relative paths, human text, and watch command contract.
- `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts` — assert prompt guidance teaches the wait recipe and avoids naming optional third-party tools.
- `packages/pi-delegate-driven-development/README.md` — document the composable wait pattern at a high level.

**No new files**

---

### Task 1: Add failing tests for the enriched `delegate_start` result

**Files:**
- Modify: `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts`

- [ ] **Step 1.1: Import `path` for portable path assertions**

At the top of `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts`, replace:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
```

with:

```ts
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 1.2: Make mocked artifact paths live under the checkout**

In `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts`, inside `visibilityState`, replace:

```ts
progressFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.progress.md",
statusFile: "/tmp/.pi/delegate/2026-05-07/sess-abc/w1.status",
```

with:

```ts
progressFile: `${process.cwd()}/.pi/delegate/2026-05-07/sess-abc/w1.progress.md`,
statusFile: `${process.cwd()}/.pi/delegate/2026-05-07/sess-abc/w1.status`,
```

This keeps the mocked absolute paths inside the current checkout so `relativeToProject(...)` can produce non-absolute display paths during the test.

- [ ] **Step 1.3: Add a helper to recognize relative artifact paths**

After `createFakePi()` in `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts`, add:

```ts
function expectRelativeArtifactPath(value: unknown, suffix: string) {
  expect(typeof value).toBe("string");
  const text = value as string;
  expect(path.isAbsolute(text)).toBe(false);
  expect(text.split(path.sep).join("/")).toContain(suffix);
}
```

- [ ] **Step 1.4: Replace the exact details expectation with enriched details assertions**

In the test named `returns progress_file and status_file details and writes running before start`, replace this block:

```ts
expect(result.details).toEqual({
  task_id: "w1",
  status: "running",
  progress_file: visibilityState.progressFile,
  status_file: visibilityState.statusFile,
});
```

with:

```ts
expect(result.details).toMatchObject({
  task_id: "w1",
  status: "running",
  progress_file: visibilityState.progressFile,
  status_file: visibilityState.statusFile,
  watch: {
    timeout_seconds: 1800,
    poll_seconds: 5,
    sentinel_pattern: "DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT",
    preferred_mode: "async_background_if_available",
    fallback_mode: "blocking_shell",
    authoritative_followup: "delegate_check",
  },
});
expectRelativeArtifactPath(result.details?.progress_file_relative, "w1.progress.md");
expectRelativeArtifactPath(result.details?.status_file_relative, "w1.status");
```

- [ ] **Step 1.5: Assert the human text surfaces artifacts and wait guidance**

Still in the same test, after the new details assertions, add:

```ts
const text = result.content[0]?.text ?? "";
expect(text).toContain("Worker w1 started.");
expect(text).toContain("Artifacts:");
expect(text).toContain(String(result.details?.progress_file_relative));
expect(text).toContain(String(result.details?.status_file_relative));
expect(text).toContain("Recommended wait pattern:");
expect(text).toContain("async/background command runner");
expect(text).toContain("details.watch.command");
expect(text).toContain("DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT");
expect(text).toContain("call delegate_check(\"w1\") once");
```

- [ ] **Step 1.6: Assert the self-contained watch command contract**

Still in the same test, after the human text assertions, add:

```ts
const watch = result.details?.watch as { command?: string } | undefined;
expect(watch?.command).toEqual(expect.any(String));
expect(watch?.command).toContain("bash -lc");
expect(watch?.command).toContain(visibilityState.statusFile);
expect(watch?.command).toContain("DELEGATE_WATCH_DONE task_id=$task_id status=$status");
expect(watch?.command).toContain("DELEGATE_WATCH_TIMEOUT task_id=$task_id last=$last_status");
expect(watch?.command).toContain("exit 124");
```

- [ ] **Step 1.7: Add a focused test for custom timeout propagation**

After the test named `uses a shared artifact date for both writer paths`, add:

```ts
it("uses the worker timeout in the returned watch recipe", async () => {
  const fake = createFakePi();
  delegate(fake.pi);

  const tool = fake.getTool("delegate_start")!;
  const result = await tool.execute("call-1", {
    task: "Review delegate status files.",
    model: "gpt-5.5",
    provider: "openai-codex",
    timeout: 42,
  });

  expect(result.details?.watch).toMatchObject({
    timeout_seconds: 42,
    poll_seconds: 5,
  });
  const watch = result.details?.watch as { command?: string } | undefined;
  expect(watch?.command).toContain("timeout_seconds=42");
});
```

- [ ] **Step 1.8: Run the focused test and verify it fails**

Run from the repository root:

```bash
npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.delegate-status-start.test.ts
```

Expected: FAIL because `delegate_start` does not yet return relative paths, a `watch` object, or the new human guidance.

---

### Task 2: Implement the result helpers and watch recipe

**Files:**
- Modify: `packages/pi-delegate-driven-development/extensions/delegate/index.ts`

- [ ] **Step 2.1: Import Node path utilities**

In `packages/pi-delegate-driven-development/extensions/delegate/index.ts`, replace the import block:

```ts
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
```

with:

```ts
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
```

- [ ] **Step 2.2: Add helper functions after `todayDate()`**

In `packages/pi-delegate-driven-development/extensions/delegate/index.ts`, immediately after:

```ts
function todayDate(): string {
  return new Date().toLocaleDateString("en-CA");
}
```

add:

```ts
function relativeToProject(projectRoot: string, artifactPath: string): string {
  try {
    const relative = path.relative(projectRoot, artifactPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return artifactPath;
    }
    return relative.split(path.sep).join("/");
  } catch {
    return artifactPath;
  }
}

function shellSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

type DelegateWatchRecipe = {
  command: string;
  timeout_seconds: number;
  poll_seconds: number;
  sentinel_pattern: string;
  preferred_mode: "async_background_if_available";
  fallback_mode: "blocking_shell";
  authoritative_followup: "delegate_check";
};

function buildDelegateWatchRecipe(
  statusFile: string,
  taskId: string,
  timeoutSeconds: number,
  pollSeconds = 5,
): DelegateWatchRecipe {
  const normalizedTimeout = Math.max(1, Math.floor(timeoutSeconds));
  const normalizedPoll = Math.max(1, Math.floor(pollSeconds));
  const script = [
    `status_file=${shellSingleQuote(statusFile)}`,
    `task_id=${shellSingleQuote(taskId)}`,
    `timeout_seconds=${normalizedTimeout}`,
    `poll_seconds=${normalizedPoll}`,
    `last_status="unknown"`,
    `start_seconds=$SECONDS`,
    `while true; do`,
    `  if [[ -f "$status_file" ]]; then`,
    `    status=""`,
    `    if read -r status < "$status_file"; then`,
    `      case "$status" in`,
    `        completed|failed|aborted)`,
    `          echo "DELEGATE_WATCH_DONE task_id=$task_id status=$status"`,
    `          exit 0`,
    `          ;;`,
    `        running)`,
    `          last_status="$status"`,
    `          ;;`,
    `        *)`,
    `          if [[ -n "$status" ]]; then last_status="$status"; fi`,
    `          ;;`,
    `      esac`,
    `    fi`,
    `  fi`,
    ``,
    `  elapsed=$((SECONDS - start_seconds))`,
    `  if (( elapsed >= timeout_seconds )); then`,
    `    echo "DELEGATE_WATCH_TIMEOUT task_id=$task_id last=$last_status"`,
    `    exit 124`,
    `  fi`,
    ``,
    `  sleep "$poll_seconds"`,
    `done`,
  ].join("\n");

  return {
    command: `bash -lc ${shellSingleQuote(script)}`,
    timeout_seconds: normalizedTimeout,
    poll_seconds: normalizedPoll,
    sentinel_pattern: "DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT",
    preferred_mode: "async_background_if_available",
    fallback_mode: "blocking_shell",
    authoritative_followup: "delegate_check",
  };
}

function formatDelegateStartMessage(
  taskId: string,
  progressFileRelative: string,
  statusFileRelative: string,
): string {
  return [
    `Worker ${taskId} started.`,
    ``,
    `Artifacts:`,
    `- progress: ${progressFileRelative}`,
    `- status: ${statusFileRelative}`,
    ``,
    `Recommended wait pattern:`,
    `- If an async/background command runner is available, run details.watch.command there and watch for: DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT.`,
    `- If no async/background runner is available, run the same command in a shell; it will block, but avoids frequent delegate_check polling.`,
    `- After any sentinel or timeout, call delegate_check("${taskId}") once; delegate_check is authoritative.`,
  ].join("\n");
}
```

- [ ] **Step 2.3: Use the helpers in the `delegate_start` success return**

In `packages/pi-delegate-driven-development/extensions/delegate/index.ts`, find the current success return:

```ts
return {
  content: [{ type: "text" as const, text: `Worker ${taskId} started. Use delegate_check("${taskId}") to monitor progress.` }],
  details: {
    task_id: taskId,
    status: "running",
    progress_file: logWriter.getFilePath(),
    status_file: statusWriter.getFilePath(),
  },
};
```

Replace it with:

```ts
const progressFile = logWriter.getFilePath();
const statusFile = statusWriter.getFilePath();
const progressFileRelative = relativeToProject(projectRoot, progressFile);
const statusFileRelative = relativeToProject(projectRoot, statusFile);
const watch = buildDelegateWatchRecipe(statusFile, taskId, timeout);

return {
  content: [
    {
      type: "text" as const,
      text: formatDelegateStartMessage(taskId, progressFileRelative, statusFileRelative),
    },
  ],
  details: {
    task_id: taskId,
    status: "running",
    progress_file: progressFile,
    status_file: statusFile,
    progress_file_relative: progressFileRelative,
    status_file_relative: statusFileRelative,
    watch,
  },
};
```

- [ ] **Step 2.4: Run the focused test and verify it passes**

Run from the repository root:

```bash
npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.delegate-status-start.test.ts
```

Expected: PASS.

- [ ] **Step 2.5: Commit the helper and result changes**

Run:

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/index.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts
git commit -m "feat(delegate): return wait recipe from delegate_start"
```

---

### Task 3: Update `delegate_start` prompt guidance without naming optional tools

**Files:**
- Modify: `packages/pi-delegate-driven-development/extensions/delegate/index.ts`
- Modify: `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts`

- [ ] **Step 3.1: Extend the registered-tool test type to include guidance fields**

In `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts`, update the `RegisteredTool` type from:

```ts
type RegisteredTool = {
  name: string;
  parameters?: {
    properties?: Record<string, unknown>;
  };
```

to:

```ts
type RegisteredTool = {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters?: {
    properties?: Record<string, unknown>;
  };
```

- [ ] **Step 3.2: Add a failing test for composable wait guidance**

In `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts`, after the test named `exposes a log-only visibility parameter on delegate_start`, add:

```ts
it("guides agents toward status-file waiting without naming optional third-party tools", () => {
  const fake = createFakePi();
  delegate(fake.pi);

  const tool = fake.getTool("delegate_start");
  expect(tool).toBeDefined();

  const guidance = [tool?.promptSnippet, ...(tool?.promptGuidelines ?? [])].join("\n");
  expect(guidance).toContain("details.watch.command");
  expect(guidance).toContain("async/background command runner");
  expect(guidance).toContain("blocking shell");
  expect(guidance).toContain("After the wait command emits");
  expect(guidance).toContain("Avoid tight polling loops around delegate_check");
  expect(guidance).not.toContain("process tool");
  expect(guidance).not.toContain("pi-processes");
});
```

- [ ] **Step 3.3: Run the guidance test and verify it fails**

Run from the repository root:

```bash
npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.delegate-start.test.ts
```

Expected: FAIL because current `delegate_start` guidance still emphasizes `delegate_check` monitoring and does not mention the watch recipe.

- [ ] **Step 3.4: Replace `delegate_start` prompt guidance**

In `packages/pi-delegate-driven-development/extensions/delegate/index.ts`, find the `delegate_start` tool definition fields:

```ts
promptSnippet: "Spawn a worker agent to execute a task in an isolated subprocess.",
promptGuidelines: [
  "Use delegate_start to offload tasks to a worker agent (code review, implementation, research).",
  "The worker runs as a separate Pi process with its own context window.",
  "Check progress with delegate_check, steer with delegate_steer, abort with delegate_abort, read result with delegate_result.",
  "Maximum 2 concurrent workers by default.",
],
```

Replace them with:

```ts
promptSnippet: "Spawn a worker agent to execute a task in an isolated subprocess and return artifact paths plus a status-file wait recipe.",
promptGuidelines: [
  "Use delegate_start to offload tasks to a worker agent (code review, implementation, research).",
  "The worker runs as a separate Pi process with its own context window.",
  "delegate_start returns progress/status artifact paths and a self-contained status-file wait command in details.watch.command.",
  "Prefer running details.watch.command with an async/background command runner when one is available; otherwise run it in a blocking shell rather than polling frequently.",
  "After the wait command emits DELEGATE_WATCH_DONE or DELEGATE_WATCH_TIMEOUT, call delegate_check once for authoritative state, then delegate_result when terminal.",
  "Avoid tight polling loops around delegate_check; if polling is unavoidable, use a slow cadence.",
  "Use delegate_steer to send instructions to a running worker and delegate_abort to stop one.",
  "Maximum 2 concurrent workers by default.",
],
```

- [ ] **Step 3.5: Run the guidance tests and verify they pass**

Run from the repository root:

```bash
npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.delegate-start.test.ts
```

Expected: PASS.

- [ ] **Step 3.6: Commit the prompt guidance update**

Run:

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/index.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts
git commit -m "docs(delegate): guide agents to status-file waiting"
```

---

### Task 4: Document the composable wait pattern in the package README

**Files:**
- Modify: `packages/pi-delegate-driven-development/README.md`

- [ ] **Step 4.1: Add a README section after the install examples**

In `packages/pi-delegate-driven-development/README.md`, after this block:

````md
To install just one extension from the bundle:

```jsonc
{
  "packages": [
    {
      "source": "git:github.com/chknd1nner/pi-delegate-driven-development@v0.1.0",
      "extensions": ["extensions/delegate/index.ts"],
      "skills": []
    }
  ]
}
```
````

add:

````md
## Delegate worker monitoring

`delegate_start` returns worker artifact paths and a self-contained status-file wait recipe:

- `details.progress_file` / `details.progress_file_relative` — append-only markdown progress log.
- `details.status_file` / `details.status_file_relative` — machine-readable lifecycle status file.
- `details.watch.command` — Bash command that waits for `completed`, `failed`, or `aborted` status and emits `DELEGATE_WATCH_DONE` or `DELEGATE_WATCH_TIMEOUT`.

If an async/background command runner is available, run `details.watch.command` there and watch for `DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT`. If not, run the same command in a shell; it blocks, but avoids frequent `delegate_check` polling. After any sentinel or timeout, call `delegate_check` once because in-memory delegate state is authoritative.
````

- [ ] **Step 4.2: Verify README wording avoids optional tool names**

Run from the repository root:

```bash
rg -n "process tool|pi-processes" packages/pi-delegate-driven-development/README.md
```

Expected: no output.

- [ ] **Step 4.3: Commit the README update**

Run:

```bash
git add packages/pi-delegate-driven-development/README.md
git commit -m "docs(delegate): document worker wait recipe"
```

---

### Task 5: Run package verification and inspect the final diff

**Files:**
- Verify: `packages/pi-delegate-driven-development/extensions/delegate/index.ts`
- Verify: `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts`
- Verify: `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts`
- Verify: `packages/pi-delegate-driven-development/README.md`

- [ ] **Step 5.1: Run the focused delegate tests**

Run from the repository root:

```bash
npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.delegate-status-start.test.ts extensions/delegate/tests/index.delegate-start.test.ts
```

Expected: PASS.

- [ ] **Step 5.2: Run the full package test suite**

Run from the repository root:

```bash
npm test -w pi-delegate-driven-development
```

Expected: PASS.

- [ ] **Step 5.3: Run the package typecheck**

Run from the repository root:

```bash
npm run typecheck -w pi-delegate-driven-development
```

Expected: PASS.

- [ ] **Step 5.4: Inspect the final diff for accidental third-party tool coupling**

Run from the repository root:

```bash
git diff -- packages/pi-delegate-driven-development/extensions/delegate/index.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts packages/pi-delegate-driven-development/README.md
rg -n "process tool|pi-processes|wait\.sh" packages/pi-delegate-driven-development/extensions/delegate packages/pi-delegate-driven-development/README.md
```

Expected: the diff only contains the planned result/guidance/docs changes; `rg` prints no matches.

- [ ] **Step 5.5: Commit any remaining verification-only changes**

If Step 5 reveals no uncommitted files, skip this step. If a small correction was needed, commit it:

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/index.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-status-start.test.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-start.test.ts packages/pi-delegate-driven-development/README.md
git commit -m "chore(delegate): verify wait guidance implementation"
```
