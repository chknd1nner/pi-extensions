---
task_number: 12
title: 'Fix `return { isError: true }` Pattern in Delegate Tools (Use `throw` Instead)'
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
follow_up_to: task-07-wire-up-delegate-check-tool
next_prompt: |-
  Review Task 12: Fix `return { isError: true }` Pattern in Delegate Tools

  Perform a TWO-STAGE REVIEW:

  ## Stage 1: Spec / Convention Review
  - Read `docs/pi/docs/extensions.md` § "Custom Tools" and § "Error Handling".
    Confirm the documented convention: tool errors are surfaced to the LLM by
    `throw new Error(...)`. Returning `{ isError: true }` from a tool's
    `execute()` is silently ignored by Pi.
  - Verify ALL `delegate_*` tools in `extensions/delegate/index.ts` now signal
    failures via `throw` (consistent with `delegate_check` from task-07).
  - Verify there are NO remaining `isError: true` literals in
    `extensions/delegate/index.ts`.

  ## Stage 2: Code Review
  Use the superpowers:requesting-code-review skill approach.
  - Get git diff for this task's changes
  - Check code quality, architecture, testing
  - Categorize issues: Critical / Important / Minor

  Specific things to check:
  - Each previously-`isError`-returning code path now `throw`s an `Error` whose
    message preserves the original user-facing text (so the LLM still sees a
    useful error string).
  - The `details` payload that used to carry an `error` discriminator
    (`invalid_params`, `concurrency_limit`, `start_failed`) is now embedded in
    the thrown error message OR documented as deliberately dropped. Either is
    acceptable — but the change should be intentional, not accidental.
  - The matching test in `tests/index.delegate-start.test.ts` is updated to
    use `await expect(...).rejects.toThrow(...)` (mirroring the unknown-task
    test fixed in task-07). The old `expect(result.isError).toBe(true)`
    assertion is gone.
  - All other tests, typecheck, and lint still pass.
  - Any failure-path that started a worker (registered the entry, opened a log
    writer) before throwing must clean up first — see Step 3 for the
    `start_failed` path which currently does cleanup before returning.

  ## Review Output

  ### Spec / Convention Compliance
  [Matches convention / Minor divergences / Major divergences]

  ### Code Quality
  [Strengths and issues per code-reviewer format]

  ### Verdict
  If task passes BOTH stages:
  - Move ticket to done status (ticket_move task-12 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-12 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
review_prompt_template: |-
  Review Task 12: Fix `return { isError: true }` Pattern in Delegate Tools

  Perform a TWO-STAGE REVIEW:

  ## Stage 1: Spec / Convention Review
  - Read `docs/pi/docs/extensions.md` § "Custom Tools" and § "Error Handling".
    Confirm the documented convention: tool errors are surfaced to the LLM by
    `throw new Error(...)`. Returning `{ isError: true }` from a tool's
    `execute()` is silently ignored by Pi.
  - Verify ALL `delegate_*` tools in `extensions/delegate/index.ts` now signal
    failures via `throw` (consistent with `delegate_check` from task-07).
  - Verify there are NO remaining `isError: true` literals in
    `extensions/delegate/index.ts`.

  ## Stage 2: Code Review
  Use the superpowers:requesting-code-review skill approach.
  - Get git diff for this task's changes
  - Check code quality, architecture, testing
  - Categorize issues: Critical / Important / Minor

  Specific things to check:
  - Each previously-`isError`-returning code path now `throw`s an `Error` whose
    message preserves the original user-facing text (so the LLM still sees a
    useful error string).
  - The `details` payload that used to carry an `error` discriminator
    (`invalid_params`, `concurrency_limit`, `start_failed`) is now embedded in
    the thrown error message OR documented as deliberately dropped. Either is
    acceptable — but the change should be intentional, not accidental.
  - The matching test in `tests/index.delegate-start.test.ts` is updated to
    use `await expect(...).rejects.toThrow(...)` (mirroring the unknown-task
    test fixed in task-07). The old `expect(result.isError).toBe(true)`
    assertion is gone.
  - All other tests, typecheck, and lint still pass.
  - Any failure-path that started a worker (registered the entry, opened a log
    writer) before throwing must clean up first — see Step 3 for the
    `start_failed` path which currently does cleanup before returning.

  ## Review Output

  ### Spec / Convention Compliance
  [Matches convention / Minor divergences / Major divergences]

  ### Code Quality
  [Strengths and issues per code-reviewer format]

  ### Verdict
  If task passes BOTH stages:
  - Move ticket to done status (ticket_move task-12 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-12 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: |-
  |-
    Task 12 PASSED two-stage review.

    Stage 1 — Spec / Convention Compliance: MATCHES
    - docs/pi/docs/extensions.md:1761 explicitly states: "To mark a tool execution as failed (sets `isError: true` on the result and reports it to the LLM), throw an error from `execute`. Returning a value never sets the error flag regardless of what properties you include in the return object."
    - All three previously-`{isError: true}`-returning sites in extensions/delegate/index.ts (invalid_params, concurrency_limit, start_failed) now throw new Error(...) with messages preserving the original user-facing text.
    - The `start_failed` path correctly cleans up before throwing: `manager.setStatus(... "failed" ...)` then `tryCloseLogWriter()` then `throw`. The underlying spawn error is now appended to the thrown message (extensions/delegate/index.ts:205-211), an improvement over the pre-fix behavior which dropped it.
    - The `details.error` discriminators (`invalid_params`, `concurrency_limit`, `start_failed`) are deliberately dropped — the failure is now signalled by the throw itself; a deliberate, documented choice in the plan.
    - Test tests/index.delegate-start.test.ts:47-65 rewritten to `await expect(...).rejects.toThrow("Cannot specify both")`, mirroring the unknown-task pattern in delegate_check.

    Stage 2 — Code Quality: PASS
    - Strengths: cleanup ordering preserved on the start_failed path; original error message preserved (improvement); test pattern aligned with task-07's convention; no isError literals left.
    - Critical issues: none.
    - Important issues: none.
    - Minor issues: none.

    Verification evidence:
    - `rg -n "isError:\s*true" extensions/delegate/index.ts` → clean (no matches)
    - `rg -n "result\.isError" extensions/delegate/tests` → clean (no matches)
    - `rg -n "isError" extensions/delegate/index.ts` → no references
    - `npx vitest run` → 6 files / 42 tests passed (same total as task-07; one test renamed and rewritten)
    - `npx tsc --noEmit` → exit 0, no output
    - Commit 3e5b5e8: "fix(delegate): throw errors instead of returning { isError: true }"
---

# Task 12 — Fix `return { isError: true }` Pattern in Delegate Tools (Use `throw` Instead)

## Background

Per Pi's extensions documentation (`docs/pi/docs/extensions.md`), custom tools surface failures to the LLM by **throwing** an `Error`. Returning `{ isError: true, content: [...] }` from a tool's `execute()` does NOT mark the call as an error — Pi silently treats it as a normal success and the LLM sees the failure text as an ordinary tool result.

Task 07's review (delegate_check) flagged this for the rest of the extension and confirmed the correct pattern with a passing test (`tests/index.delegate-start.test.ts` — `"throws for unknown task IDs in delegate_check"`).

The currently-merged `delegate_start` tool still uses the wrong pattern in **three** places. This task fixes them and updates the one matching test.

Note: the plan excerpts in `in-progress/ready/task-08-wire-up-delegate-steer-and-delegate-abort-tools.md` (5 sites) and `in-progress/ready/task-09-wire-up-delegate-result-tool.md` (2 sites) previously prescribed the same wrong pattern. Those tickets have been amended in-place to use `throw new Error(...)` and now include a "Convention reminder" section. See ## Notes for the verification grep.

## Affected sites in `extensions/delegate/index.ts`

Confirmed by grep (worktree `/Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension`):

```
$ rg -n "isError:\s*true" extensions/delegate/index.ts
extensions/delegate/index.ts:90:          isError: true,
extensions/delegate/index.ts:100:          isError: true,
extensions/delegate/index.ts:215:          isError: true,
```

| Line | Path | Original error discriminator |
|------|------|------------------------------|
| 90   | `delegate_start` — both `tools` and `denied_tools` supplied | `error: "invalid_params"` |
| 100  | `delegate_start` — concurrency cap reached | `error: "concurrency_limit"` |
| 215  | `delegate_start` — `rpcClient.start()` / first send threw | `error: "start_failed"` |

Matching test:

```
$ rg -n "isError" extensions/delegate/tests/index.delegate-start.test.ts
extensions/delegate/tests/index.delegate-start.test.ts:62:    expect(result.isError).toBe(true);
```

(The `isError?: boolean` field on the `RegisteredTool` type alias on line 16 of that file can stay — it documents the shape `execute()` is *allowed* to return; we just won't be using it for failures anymore.)

## Plan excerpt

**Files:**
- Modify: `extensions/delegate/index.ts` (3 `return { isError: true, ... }` blocks → `throw new Error(...)`)
- Modify: `extensions/delegate/tests/index.delegate-start.test.ts` (one `expect(result.isError)` test → `rejects.toThrow`)

---

- [x] **Step 1: Replace the `tools` + `denied_tools` validation failure with `throw`**

In `extensions/delegate/index.ts`, locate this block at the top of `delegate_start`'s `execute()` (currently around line 86–92):

```typescript
      if (params.tools && params.denied_tools) {
        return {
          content: [{ type: "text" as const, text: "Cannot specify both 'tools' (allowlist) and 'denied_tools' (denylist). Pick one." }],
          details: { error: "invalid_params" },
          isError: true,
        };
      }
```

Replace it with:

```typescript
      if (params.tools && params.denied_tools) {
        throw new Error(
          "Cannot specify both 'tools' (allowlist) and 'denied_tools' (denylist). Pick one.",
        );
      }
```

Rationale: this is a parameter-validation failure that fires before any worker state is created, so there is nothing to clean up.

---

- [x] **Step 2: Replace the concurrency-cap failure with `throw`**

In `extensions/delegate/index.ts`, locate this block (currently around line 94–102):

```typescript
      if (!manager.canStart()) {
        const active = manager.activeWorkerDescriptions();
        const desc = active.map((w) => `  ${w.taskId}: ${w.task.slice(0, 80)}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `Cannot start: ${active.length} workers already running.\n\nActive workers:\n${desc}\n\nAbort one with delegate_abort before starting a new task.` }],
          details: { error: "concurrency_limit" },
          isError: true,
        };
      }
```

Replace it with:

```typescript
      if (!manager.canStart()) {
        const active = manager.activeWorkerDescriptions();
        const desc = active.map((w) => `  ${w.taskId}: ${w.task.slice(0, 80)}`).join("\n");
        throw new Error(
          `Cannot start: ${active.length} workers already running.\n\nActive workers:\n${desc}\n\nAbort one with delegate_abort before starting a new task.`,
        );
      }
```

The full active-worker description still reaches the LLM via the thrown error message, which preserves the spec's "returns an error that includes the task IDs and descriptions of currently active workers" requirement (`docs/superpowers/specs/2026-04-26-delegate-extension-design.md` § "delegate_start").

---

- [x] **Step 3: Replace the `start_failed` failure with `throw` AFTER cleanup**

In `extensions/delegate/index.ts`, locate this block (currently around line 206–217):

```typescript
      try {
        rpcClient.start();
        rpcClient.send({ type: "prompt", message: params.task });
      } catch (err) {
        manager.setStatus(taskId, "failed", err instanceof Error ? err.message : String(err));
        tryCloseLogWriter();
        return {
          content: [{ type: "text" as const, text: `Failed to start worker ${taskId}.` }],
          details: { error: "start_failed" },
          isError: true,
        };
      }
```

Replace it with:

```typescript
      try {
        rpcClient.start();
        rpcClient.send({ type: "prompt", message: params.task });
      } catch (err) {
        manager.setStatus(taskId, "failed", err instanceof Error ? err.message : String(err));
        tryCloseLogWriter();
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to start worker ${taskId}: ${message}`);
      }
```

Notes:
- Cleanup (`manager.setStatus(... "failed" ...)` and `tryCloseLogWriter()`) MUST happen before the throw, otherwise the worker entry stays in `running` and the log writer's file handle leaks. Order is: mutate state, close resources, then throw.
- The original error message from the spawn failure is now appended to the thrown text so the orchestrator LLM gets concrete diagnostics (current code drops it).

---

- [x] **Step 4: Verify the file is clean**

Run:

```
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension && rg -n "isError:\s*true" extensions/delegate/index.ts || echo "clean: no isError:true literals in extensions/delegate/index.ts"
```

Expected: `clean: no isError:true literals in extensions/delegate/index.ts`.

If anything still matches, fix it before proceeding.

---

- [x] **Step 5: Update the matching test in `tests/index.delegate-start.test.ts`**

Locate the test `it("rejects tools and denied_tools used together", ...)` (currently around lines 47–65). Its current body:

```typescript
  it("rejects tools and denied_tools used together", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", {
      task: "Do something",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      tools: ["read"],
      denied_tools: ["bash"],
    });

    expect(result.isError).toBe(true);
    expect(result.details?.error).toBe("invalid_params");
    expect(result.content[0]?.text).toContain("Cannot specify both");
  });
```

Replace it with:

```typescript
  it("throws when tools and denied_tools are used together", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start");
    expect(tool).toBeDefined();

    await expect(
      tool!.execute("call-1", {
        task: "Do something",
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        tools: ["read"],
        denied_tools: ["bash"],
      }),
    ).rejects.toThrow("Cannot specify both");
  });
```

Rationale: matches the `delegate_check` unknown-task test pattern fixed in task-07. The `details.error: "invalid_params"` discriminator is no longer asserted because the failure is now signalled by the throw itself; the user-facing text remains stable.

---

- [x] **Step 6: Run the full test suite and typecheck**

```
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx vitest run
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate && npx tsc --noEmit
```

Expected:
- Vitest: 6 files / 42 tests passed (same total as task-07; one test renamed and rewritten, no net change in count).
- tsc: no output (clean).

If any other test relied on `result.isError === true` against `delegate_start` (re-grep `tests/` to be sure), update it the same way.

---

- [x] **Step 7: Commit**

```bash
git add extensions/delegate/index.ts \
        extensions/delegate/tests/index.delegate-start.test.ts
git commit -m "fix(delegate): throw errors instead of returning { isError: true }

Pi only marks a tool call as failed when execute() throws. The earlier
delegate_start failure paths returned { isError: true } from execute(),
which Pi silently treats as a successful tool call — the LLM saw the
failure text as a normal result and could not branch on it.

This brings delegate_start in line with delegate_check (fixed in
task-07) and Pi's documented extension convention.

- index.ts: invalid params, concurrency cap, and start_failed paths
  now throw Error with the same user-facing message. start_failed
  preserves prior cleanup ordering (status -> log close -> throw)
  and includes the underlying spawn error in the thrown message.
- tests/index.delegate-start.test.ts: replace the
  expect(result.isError).toBe(true) assertion with rejects.toThrow,
  mirroring the unknown-task assertion."
```

---

## Verification commands (run before moving to review)

From `/Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension`:

```
cd extensions/delegate && npx vitest run
cd extensions/delegate && npx tsc --noEmit
rg -n "isError:\s*true" extensions/delegate/index.ts || echo "clean: no isError:true literals in extensions/delegate/index.ts"
rg -n "result\.isError" extensions/delegate/tests || echo "clean: no result.isError assertions left in tests"
```

Paste the output of each command into the ## Notes section.

---

## Notes

### Cross-cutting concern — RESOLVED at ticket-creation time

The plan excerpts in `in-progress/ready/task-08-wire-up-delegate-steer-and-delegate-abort-tools.md` and `in-progress/ready/task-09-wire-up-delegate-result-tool.md` previously prescribed the same wrong pattern (5 sites in task-08, 2 sites in task-09). The coordinator amended both tickets in-place at the same time as creating this one:

- All `return { isError: true, ... }` code blocks in those tickets are rewritten to `throw new Error(...)`.
- Both tickets now carry a "Convention reminder (added after task-07 review)" section above the plan excerpt, explicitly telling the implementor to preserve the `throw` pattern.
- Both tickets gained a verification step: `rg -n "isError:\s*true" index.ts || echo "clean"` before commit.

Verification grep at amendment time:

```
$ rg -n "^\s+isError:\s*true," \
    in-progress/ready/task-08-wire-up-delegate-steer-and-delegate-abort-tools.md \
    in-progress/ready/task-09-wire-up-delegate-result-tool.md
clean: no isError:true syntax sites in task-08 or task-09
```

This means task-12 is the *only* remaining work to fix the merged-code regression in `delegate_start`. No follow-up flagging to the coordinator is needed; tasks 8 and 9 will land clean.

### Reference

Pi extensions docs (loaded into context for task-07's review):

> Returning `{ isError: true }` is silently ignored by Pi; only thrown errors set the error flag.

— `docs/pi/docs/extensions.md`, paraphrased from the "Error Handling" / "Custom Tools" sections.

### Implementation worktree

`/Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension`

### Verification evidence

```bash
$ cd extensions/delegate && npx vitest run

 RUN  v3.2.4 /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/delegate-extension/extensions/delegate

 ✓ tests/visibility.test.ts (4 tests) 9ms
 ✓ tests/progress.test.ts (13 tests) 6ms
 ✓ tests/worker-manager.test.ts (9 tests) 3ms
 ✓ tests/rpc-client.test.ts (7 tests) 102ms
 ✓ tests/index.delegate-start.test.ts (4 tests) 61ms
 ✓ tests/index.delegate-check.test.ts (5 tests) 74ms

 Test Files  6 passed (6)
      Tests  42 passed (42)
   Duration  625ms
```

```bash
$ cd extensions/delegate && npx tsc --noEmit
# no output (exit 0)
```

```bash
$ rg -n "isError:\s*true" extensions/delegate/index.ts || echo "clean: no isError:true literals in extensions/delegate/index.ts"
clean: no isError:true literals in extensions/delegate/index.ts
```

```bash
$ rg -n "result\.isError" extensions/delegate/tests || echo "clean: no result.isError assertions left in tests"
clean: no result.isError assertions left in tests
```
