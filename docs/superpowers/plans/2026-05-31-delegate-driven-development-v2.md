# Delegate-Driven Development v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `delegate-driven-development` v2 skill plus the supporting `tickets`-extension refactor that turns sharded tickets into pure data and exposes a field reader, so an orchestrator can run plan implementation end-to-end with a cached spec+plan prefix.

**Architecture:** Two deliverables. (1) The `tickets` extension is refactored so `ticket_shard` emits data-only tickets (no baked-in worker prompts) with new `review_failures` / `task_base_sha` frontmatter, and a new `ticket_get` tool reads a single frontmatter field. (2) A new bundled skill `skills/delegate-driven-development/` holds the orchestration workflow (`SKILL.md`), per-role model defaults (`models.json`), the non-blocking wait script, and three inspectable worker-prompt templates under `references/`.

**Tech Stack:** TypeScript Pi extensions (one npm package per extension, ESM, `tsc --noEmit` typecheck, `vitest` tests), the `mdedit` CLI for frontmatter/section editing, Markdown + JSON skill assets, Bash.

**Source of truth:** `docs/superpowers/specs/2026-05-31-delegate-driven-development-v2-design.md`. Section references below (§N) point at that spec.

**Bootstrap note (read once):** This plan is itself intended to be executed by the v2 workflow it builds. There is a deliberate chicken-and-egg: `ticket_get` does not exist until Task 6. While executing *this* plan, the orchestrator reads ticket frontmatter directly (`mdedit frontmatter get <file> <field>` or the `read` tool) instead of `ticket_get`. This is expected and affects only the bootstrap run.

**Verified environment facts (do not re-discover):**
- `mdedit frontmatter get <file> <field>` prints the **raw value only** — for a scalar field `review_failures: 0` it prints exactly `0` (no `field:` prefix line). For a multiline block it prints the block lines verbatim.
- `mdedit outline <file>` annotates task headings as `### Task N: Title — W words (lines A–B)`. `ticket_shard` already depends on this format.
- `mdedit extract <file> "<heading>"` prints a `SECTION: ...` first line followed by the body; existing code drops that first line with `.slice(1)`.
- Each extension is an independent npm package. `extensions/delegate/` uses `vitest`; `extensions/tickets/` currently has **only** a `typecheck` script and **no tests** — Task 1 adds the test runner.
- `in-progress/` is gitignored; tickets are local scratch, never committed.

---

### Task 1: Add a test runner to the tickets extension

**Files:**
- Modify: `extensions/tickets/package.json`
- Create: `extensions/tickets/tests/smoke.test.ts`

- [ ] **Step 1: Add vitest as a dev dependency and a `test` script**

Edit `extensions/tickets/package.json` so the `scripts` and `devDependencies` blocks read exactly:

```json
{
  "name": "pi-tickets-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@sinclair/typebox": "^0.34.33",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Install the new dependency**

Run: `cd extensions/tickets && npm install`
Expected: completes without error; `node_modules/.bin/vitest` now exists.

- [ ] **Step 3: Write a smoke test that imports the extension default export**

Create `extensions/tickets/tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import ticketsExtension from "../index";

describe("tickets extension module", () => {
  it("default export is a registration function", () => {
    expect(typeof ticketsExtension).toBe("function");
  });
});
```

- [ ] **Step 4: Run the smoke test to verify the harness works**

Run: `cd extensions/tickets && npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add extensions/tickets/package.json extensions/tickets/package-lock.json extensions/tickets/tests/smoke.test.ts
git commit -m "test(tickets): add vitest runner and smoke test"
```

---

### Task 2: Export the helper functions for testability

**Files:**
- Modify: `extensions/tickets/index.ts`

The functions (`shardPlan`, `setTicketField`, `getNextPrompt`, `findTicket`, etc.) are currently module-private, so tests cannot call them directly. Export them. This is a pure refactor — no behavior change.

- [ ] **Step 1: Write a failing test that imports `shardPlan`**

Create `extensions/tickets/tests/exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shardPlan, setTicketField } from "../index";

describe("tickets exports", () => {
  it("exposes shardPlan and setTicketField for testing", () => {
    expect(typeof shardPlan).toBe("function");
    expect(typeof setTicketField).toBe("function");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extensions/tickets && npm test -- exports`
Expected: FAIL — `shardPlan`/`setTicketField` are not exported (import resolves to `undefined`).

- [ ] **Step 3: Add the `export` keyword to the helper declarations**

In `extensions/tickets/index.ts`, change these declarations from `function name(` to `export function name(`:

```ts
export function shardPlan(planPath: string, specPath: string | undefined, cwd: string): ShardResult {
```
```ts
export function setTicketField(pattern: string, field: string, value: string, cwd: string): SetResult {
```
```ts
export function getNextPrompt(pattern: string, cwd: string): NextPromptResult {
```
```ts
export function findTicket(pattern: string, cwd: string): string | null {
```

Leave the `export default function ticketsExtension(pi: ExtensionAPI)` as-is.

- [ ] **Step 4: Run the test and typecheck**

Run: `cd extensions/tickets && npm test -- exports && npm run typecheck`
Expected: test PASS; typecheck exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add extensions/tickets/index.ts extensions/tickets/tests/exports.test.ts
git commit -m "refactor(tickets): export helpers for testing"
```

---

### Task 3: Make `ticket_shard` emit pure-data frontmatter (§2)

**Files:**
- Modify: `extensions/tickets/index.ts` (the `shardPlan` function body)
- Create: `extensions/tickets/tests/shard.test.ts`

Remove the `implPrompt` and `reviewPrompt`/`review_prompt_template` blobs from the emitted ticket. The new frontmatter carries data only: `task_number`, `title`, `status`, `plan_path`, optional `spec_path`, `next_prompt` (empty), `review_failures: 0`, `task_base_sha` (empty).

- [ ] **Step 1: Write the failing test for the new ticket shape**

Create `extensions/tickets/tests/shard.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shardPlan } from "../index";

let dir: string;

const PLAN = `# Demo Plan

## Overview
Intro.

### Task 1: Alpha thing
Do alpha.
More alpha.

### Task 2: Beta thing
Do beta.
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tickets-shard-"));
  writeFileSync(join(dir, "plan.md"), PLAN);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("shardPlan", () => {
  it("creates one data-only ticket per task with the new frontmatter", () => {
    const result = shardPlan("plan.md", "spec.md", dir);
    expect(result.ticketsCreated).toBe(2);

    const readyDir = join(dir, "in-progress", "ready");
    const files = readdirSync(readyDir).sort();
    expect(files).toEqual(["task-01-alpha-thing.md", "task-02-beta-thing.md"]);

    const t1 = readFileSync(join(readyDir, "task-01-alpha-thing.md"), "utf-8");

    // New data fields present
    expect(t1).toMatch(/^task_number: 1$/m);
    expect(t1).toMatch(/^title: "Alpha thing"$/m);
    expect(t1).toMatch(/^status: ready$/m);
    expect(t1).toMatch(/^plan_path: plan\.md$/m);
    expect(t1).toMatch(/^spec_path: spec\.md$/m);
    expect(t1).toMatch(/^next_prompt: ""$/m);
    expect(t1).toMatch(/^review_failures: 0$/m);
    expect(t1).toMatch(/^task_base_sha: ""$/m);

    // Plan excerpt body preserved
    expect(t1).toContain("## Plan excerpt");
    expect(t1).toContain("Do alpha.");

    // Old worker-driven blobs removed
    expect(t1).not.toContain("review_prompt_template");
    expect(t1).not.toContain("Move ticket to review status");
    expect(t1).not.toContain("TWO-STAGE REVIEW");
  });

  it("omits spec_path when not provided", () => {
    shardPlan("plan.md", undefined, dir);
    const t1 = readFileSync(join(dir, "in-progress", "ready", "task-01-alpha-thing.md"), "utf-8");
    expect(t1).not.toContain("spec_path:");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extensions/tickets && npm test -- shard`
Expected: FAIL — current output still contains `review_prompt_template` and lacks `review_failures`/`task_base_sha`.

- [ ] **Step 3: Replace the prompt-building and content blocks in `shardPlan`**

In `extensions/tickets/index.ts`, **delete** the entire `// Build prompts` section (the `const implPrompt = ...` and `const reviewPrompt = ...` template literals) and the `implPromptIndented` / `reviewPromptIndented` derivations.

Then replace the `// Build frontmatter` block and the `content` template with:

```ts
    // Build frontmatter (data only — worker prompts live in the skill, not the ticket)
    const specField = specPath ? `spec_path: ${specPath}\n` : "";

    const content = `---
task_number: ${taskNum}
title: "${title}"
status: ready
plan_path: ${planPath}
${specField}next_prompt: ""
review_failures: 0
task_base_sha: ""
---

# Task ${taskNumPadded} — ${title}

## Plan excerpt

${taskContent}

---

## Notes

<!-- Optional, human-facing. Durable loop state lives in frontmatter / next_prompt. -->
`;
```

- [ ] **Step 4: Run the test and typecheck**

Run: `cd extensions/tickets && npm test -- shard && npm run typecheck`
Expected: both tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add extensions/tickets/index.ts extensions/tickets/tests/shard.test.ts
git commit -m "refactor(tickets): ticket_shard emits data-only tickets with review_failures and task_base_sha"
```

---

### Task 4: Update `ticket_shard` tool metadata to match data-only output

**Files:**
- Modify: `extensions/tickets/index.ts` (the `ticket_shard` `registerTool` call)

The description still claims tickets include an "implementation prompt, and two-stage review prompt template". Correct it.

- [ ] **Step 1: Update the description and promptSnippet**

In the `ticket_shard` registration, replace the `description` and `promptSnippet` values:

```ts
    description:
      "Shard an implementation plan into individual data-only ticket files. Parses '### Task N:' sections and creates one ticket per task in in-progress/ready/. Each ticket holds the plan excerpt plus frontmatter (task_number, title, status, plan_path, spec_path, next_prompt, review_failures, task_base_sha). Worker prompts live in the delegate-driven-development skill, not in tickets.",
    promptSnippet:
      "Use to convert an implementation plan into data-only executable tickets. Requires a plan with '### Task N: Title' sections.",
```

- [ ] **Step 2: Also update the post-shard hint text**

In the same tool's `execute`, change the trailing hint so it no longer implies self-driving workers:

```ts
          text: `✓ Sharded plan into ${result.ticketsCreated} tickets\n\n${ticketList}\n\nNext: the orchestrator moves the first ticket to active with ticket_move and dispatches an implementer.`,
```

- [ ] **Step 3: Typecheck**

Run: `cd extensions/tickets && npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 4: Re-run the full tickets test suite**

Run: `cd extensions/tickets && npm test`
Expected: all tests PASS (smoke, exports, shard).

- [ ] **Step 5: Commit**

```bash
git add extensions/tickets/index.ts
git commit -m "docs(tickets): align ticket_shard tool metadata with data-only output"
```

---

### Task 5: Add a `getTicketField` helper (§2)

**Files:**
- Modify: `extensions/tickets/index.ts`
- Create: `extensions/tickets/tests/get-field.test.ts`

The orchestrator needs to read arbitrary frontmatter fields back (`review_failures`, `task_base_sha`). `mdedit frontmatter get` prints the raw value, so the helper just trims it.

- [ ] **Step 1: Write the failing test**

Create `extensions/tickets/tests/get-field.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shardPlan, getTicketField, setTicketField } from "../index";

let dir: string;

const PLAN = `# P

### Task 1: Alpha thing
Body.
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tickets-get-"));
  writeFileSync(join(dir, "plan.md"), PLAN);
  shardPlan("plan.md", undefined, dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getTicketField", () => {
  it("reads the default scalar fields", () => {
    expect(getTicketField("task-01", "review_failures", dir).value).toBe("0");
    expect(getTicketField("task-01", "task_base_sha", dir).value).toBe("");
    expect(getTicketField("task-01", "title", dir).value).toBe("Alpha thing");
  });

  it("round-trips a value written by setTicketField", () => {
    setTicketField("task-01", "task_base_sha", "abc1234", dir);
    expect(getTicketField("task-01", "task_base_sha", dir).value).toBe("abc1234");

    setTicketField("task-01", "review_failures", "2", dir);
    expect(getTicketField("task-01", "review_failures", dir).value).toBe("2");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extensions/tickets && npm test -- get-field`
Expected: FAIL — `getTicketField` is not exported / not defined.

- [ ] **Step 3: Implement `getTicketField`**

In `extensions/tickets/index.ts`, add this interface and function next to `getNextPrompt`:

```ts
interface GetFieldResult {
  file: string;
  field: string;
  value: string;
}

export function getTicketField(pattern: string, field: string, cwd: string): GetFieldResult {
  const filepath = findTicket(pattern, cwd);
  if (!filepath) throw new Error(`No ticket found matching '${pattern}'`);

  // mdedit prints the raw field value (no "field:" prefix). Empty value -> "".
  const output = mdedit(["frontmatter", "get", filepath, field], cwd);
  return {
    file: basename(filepath),
    field,
    value: output.replace(/\n+$/, ""),
  };
}
```

> Note: an empty `task_base_sha: ""` makes `mdedit` print an empty string, so `value` is `""`. Quote-wrapping is handled by `mdedit`; do not strip quotes here unless a test shows otherwise.

- [ ] **Step 4: Run the test and typecheck**

Run: `cd extensions/tickets && npm test -- get-field && npm run typecheck`
Expected: both tests PASS; typecheck exits 0.

> If `getTicketField("task-01", "task_base_sha")` returns `'""'` instead of `''`, add a quote-strip to the helper: `.replace(/^"(.*)"$/s, "$1")` after the newline trim, and re-run. Pin whichever behavior is real in the test.

- [ ] **Step 5: Commit**

```bash
git add extensions/tickets/index.ts extensions/tickets/tests/get-field.test.ts
git commit -m "feat(tickets): add getTicketField helper"
```

---

### Task 6: Register the `ticket_get` tool (§2)

**Files:**
- Modify: `extensions/tickets/index.ts` (inside `export default function ticketsExtension`)

- [ ] **Step 1: Write the failing test that the tool is registered**

Append to `extensions/tickets/tests/get-field.test.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import ticketsExtension from "../index";

describe("ticket_get registration", () => {
  it("registers a ticket_get tool", () => {
    const names: string[] = [];
    const fakePi = {
      registerTool: (def: { name: string }) => names.push(def.name),
    } as unknown as ExtensionAPI;

    ticketsExtension(fakePi);
    expect(names).toContain("ticket_get");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extensions/tickets && npm test -- get-field`
Expected: FAIL — `ticket_get` is not in the registered tool names.

- [ ] **Step 3: Register the tool**

In `extensions/tickets/index.ts`, immediately after the `ticket_next` `registerTool` block (and before the closing `}` of `ticketsExtension`), add:

```ts
  // Tool: ticket_get
  pi.registerTool({
    name: "ticket_get",
    label: "Get Ticket Field",
    description:
      "Read a single frontmatter field from a ticket (e.g. review_failures, task_base_sha, status, title). Returns the raw value.",
    promptSnippet:
      "Use to read back a ticket frontmatter field, e.g. the review_failures counter or task_base_sha diff boundary.",
    parameters: Type.Object({
      ticket: Type.String({
        description: "Ticket identifier (filename or partial match)",
      }),
      field: Type.String({
        description: "Frontmatter field name to read",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        const result = getTicketField(params.ticket, params.field, cwd);
        return {
          content: [
            {
              type: "text",
              text: `${result.field} on ${result.file}: ${result.value === "" ? "(empty)" : result.value}`,
            },
          ],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        };
      }
    },
  });
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `cd extensions/tickets && npm test && npm run typecheck`
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add extensions/tickets/index.ts extensions/tickets/tests/get-field.test.ts
git commit -m "feat(tickets): register ticket_get tool"
```

---

### Task 7: Scaffold the skill directory and `models.json` (§3)

**Files:**
- Create: `skills/delegate-driven-development/models.json`
- Create: `skills/delegate-driven-development/references/` (directory, via the file in Task 8+)

- [ ] **Step 1: Create the model-defaults file**

Create `skills/delegate-driven-development/models.json`:

```json
{
  "implementer": { "provider": "anthropic", "model": "claude-sonnet-4-5", "thinking": "low" },
  "reviewer":    { "provider": "openai-codex", "model": "gpt-5.5", "thinking": "medium" },
  "fixer":       { "provider": "anthropic", "model": "claude-sonnet-4-5", "thinking": "low" }
}
```

> These are starting defaults. The keys `provider` / `model` / `thinking` map directly onto `delegate_start` parameters (§3). The user may override any role at invocation. Validation (§3) requires every used role to resolve to a non-empty `provider` and `model`.

- [ ] **Step 2: Verify the JSON is valid and has all three roles with required keys**

Run:
```bash
python3 - <<'PY'
import json
d = json.load(open("skills/delegate-driven-development/models.json"))
for role in ("implementer", "reviewer", "fixer"):
    assert d[role]["provider"], role
    assert d[role]["model"], role
print("OK", list(d))
PY
```
Expected: `OK ['implementer', 'reviewer', 'fixer']`

- [ ] **Step 3: Commit**

```bash
git add skills/delegate-driven-development/models.json
git commit -m "feat(skill): add delegate-driven-development models.json defaults"
```

---

### Task 8: Add the non-blocking wait script (§6)

**Files:**
- Create: `skills/delegate-driven-development/references/wait.sh`

- [ ] **Step 1: Write the wait script**

Create `skills/delegate-driven-development/references/wait.sh`:

```bash
#!/usr/bin/env bash
# Poll a delegate status file until terminal or timeout.
# Usage: bash wait.sh <status_file> <timeout_seconds>
# Emits exactly one sentinel line:
#   DELEGATE_WATCH_DONE status=<completed|failed|aborted>   (exit 0)
#   DELEGATE_WATCH_TIMEOUT                                  (exit 1)
# The orchestrator MUST call delegate_check for authoritative status on any alert.
deadline=$(( $(date +%s) + ${2:-1800} ))
while :; do
  s=$(cat "$1" 2>/dev/null)
  case "$s" in
    completed|failed|aborted) echo "DELEGATE_WATCH_DONE status=$s"; exit 0 ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "DELEGATE_WATCH_TIMEOUT"; exit 1; fi
  sleep 5
done
```

- [ ] **Step 2: Verify it parses and emits the DONE sentinel on a completed status**

Run:
```bash
chmod +x skills/delegate-driven-development/references/wait.sh
bash -n skills/delegate-driven-development/references/wait.sh && echo "SYNTAX_OK"
tmp=$(mktemp); echo completed > "$tmp"
bash skills/delegate-driven-development/references/wait.sh "$tmp" 30; echo "exit=$?"
rm -f "$tmp"
```
Expected:
```
SYNTAX_OK
DELEGATE_WATCH_DONE status=completed
exit=0
```

- [ ] **Step 3: Verify it emits the TIMEOUT sentinel when the status never goes terminal**

Run:
```bash
tmp=$(mktemp); echo running > "$tmp"
bash skills/delegate-driven-development/references/wait.sh "$tmp" 0; echo "exit=$?"
rm -f "$tmp"
```
Expected:
```
DELEGATE_WATCH_TIMEOUT
exit=1
```

- [ ] **Step 4: Commit**

```bash
git add skills/delegate-driven-development/references/wait.sh
git commit -m "feat(skill): add non-blocking delegate wait script"
```

---

### Task 9: Add the implementer prompt template (§8)

**Files:**
- Create: `skills/delegate-driven-development/references/implementer-prompt.md`

- [ ] **Step 1: Write the template**

Create `skills/delegate-driven-development/references/implementer-prompt.md`:

```markdown
# Role: Implementer

You implement ONE task from an implementation plan. The full design spec and plan
are ALREADY in your context (inherited prefix). Do NOT re-read them from disk —
only open a specific file if you need a detail that is not already in context.

## Your task
{{PLAN_EXCERPT}}

## Environment
- Worktree (your working directory): {{WORKTREE_PATH}}
- Feature branch: {{BRANCH}}
- Make ALL changes inside the worktree.
- Do NOT create branches or worktrees. Do NOT touch `in-progress/`.

## Process
1. Execute each step of the task in order. Use TDD: write the failing test, run it
   to see it fail, write the minimal implementation, run it to see it pass.
2. Run every verification command the task specifies and confirm the expected output.
3. When all steps pass, create EXACTLY ONE commit containing this task's changes:
   `git add -A && git commit -m "<conventional commit message>"`.
   This commit is the per-task review boundary.
4. Leave the working tree clean — no uncommitted changes.

## Report
End your final message with these lines, exactly:

STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
<one short paragraph summarizing what you did; for NEEDS_CONTEXT or BLOCKED,
state precisely what you need or what is blocking you>
```

- [ ] **Step 2: Verify required placeholders and the status footer are present**

Run:
```bash
f=skills/delegate-driven-development/references/implementer-prompt.md
grep -q "{{PLAN_EXCERPT}}" "$f" && grep -q "{{WORKTREE_PATH}}" "$f" && grep -q "{{BRANCH}}" "$f" \
  && grep -q "STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED" "$f" \
  && grep -q "EXACTLY ONE commit" "$f" && echo "IMPL_OK"
```
Expected: `IMPL_OK`

- [ ] **Step 3: Commit**

```bash
git add skills/delegate-driven-development/references/implementer-prompt.md
git commit -m "feat(skill): add implementer prompt template"
```

---

### Task 10: Add the reviewer prompt template (§7, §8)

**Files:**
- Create: `skills/delegate-driven-development/references/reviewer-prompt.md`

- [ ] **Step 1: Write the template**

Create `skills/delegate-driven-development/references/reviewer-prompt.md`:

```markdown
# Role: Reviewer (read-only, two-stage)

The full design spec and plan are ALREADY in your context (inherited prefix).
You have read-only tools only — you cannot and must not modify files.

## Scope — review ONLY this task's changes
In {{WORKTREE_PATH}}, run:
- `git diff {{TASK_BASE_SHA}}..HEAD`
- `git log {{TASK_BASE_SHA}}..HEAD`
Review only what those show. Never review cumulative branch history or other tasks.

## Task under review
{{PLAN_EXCERPT}}

## Stage 1 — Spec compliance
Compare the diff against the design spec's intent for this task.
- MAJOR divergence (wrong approach, missing core requirement, violates an explicit
  spec constraint) -> STOP. Return `VERDICT: FAIL` with Stage 1 findings only and
  skip Stage 2.
- Minor divergences -> note them and continue to Stage 2.

## Stage 2 — Code quality
Assess the diff for: correctness; whether tests exist and actually exercise the
behavior; clarity; DRY / YAGNI; and adherence to existing codebase patterns.
Categorize issues as Critical / Important / Minor.

## Report
End your final message with this exact structure:

VERDICT: PASS | FAIL
### Spec Compliance
<findings>
### Code Quality
<findings; omit this section if you early-exited on a major spec divergence>
### Fix Instructions
<REQUIRED if FAIL: specific, actionable, file/line-referenced instructions the
orchestrator can hand to a fixer verbatim>
```

- [ ] **Step 2: Verify placeholders, read-only framing, and the verdict footer**

Run:
```bash
f=skills/delegate-driven-development/references/reviewer-prompt.md
grep -q "{{TASK_BASE_SHA}}..HEAD" "$f" && grep -q "{{PLAN_EXCERPT}}" "$f" \
  && grep -q "read-only" "$f" && grep -q "VERDICT: PASS | FAIL" "$f" \
  && grep -q "### Fix Instructions" "$f" && echo "REVIEW_OK"
```
Expected: `REVIEW_OK`

- [ ] **Step 3: Commit**

```bash
git add skills/delegate-driven-development/references/reviewer-prompt.md
git commit -m "feat(skill): add reviewer prompt template"
```

---

### Task 11: Add the fixer prompt template (§7, §8)

**Files:**
- Create: `skills/delegate-driven-development/references/fixer-prompt.md`

- [ ] **Step 1: Write the template**

Create `skills/delegate-driven-development/references/fixer-prompt.md`:

```markdown
# Role: Fixer

The full design spec and plan are ALREADY in your context (inherited prefix).
A reviewer found issues in a task that you must now fix.

## Task
{{PLAN_EXCERPT}}

## Reviewer's fix instructions
{{FIX_INSTRUCTIONS}}

## Environment
- Worktree (your working directory): {{WORKTREE_PATH}}
- Feature branch: {{BRANCH}}
- Make ALL changes inside the worktree.
- Do NOT create branches or worktrees. Do NOT touch `in-progress/`.

## Process
1. Address every item in the fix instructions. Use TDD when adding behavior.
2. Re-run the task's verification commands and confirm they pass.
3. Either amend the existing task commit OR add ONE fix commit. The task's base SHA
   stays fixed, so `git diff <base>..HEAD` must still capture the whole task.
4. Leave the working tree clean — no uncommitted changes.

## Report
End your final message with these lines, exactly:

STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
<short summary of what you changed; for NEEDS_CONTEXT or BLOCKED state what is needed>
```

- [ ] **Step 2: Verify placeholders, clean-tree rule, and the status footer**

Run:
```bash
f=skills/delegate-driven-development/references/fixer-prompt.md
grep -q "{{FIX_INSTRUCTIONS}}" "$f" && grep -q "{{PLAN_EXCERPT}}" "$f" \
  && grep -q "{{WORKTREE_PATH}}" "$f" && grep -q "clean" "$f" \
  && grep -q "STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED" "$f" && echo "FIX_OK"
```
Expected: `FIX_OK`

- [ ] **Step 3: Commit**

```bash
git add skills/delegate-driven-development/references/fixer-prompt.md
git commit -m "feat(skill): add fixer prompt template"
```

---

### Task 12: Write `SKILL.md` — the orchestration workflow (§1, §4–§10)

**Files:**
- Create: `skills/delegate-driven-development/SKILL.md`

- [ ] **Step 1: Write the skill document**

Create `skills/delegate-driven-development/SKILL.md`:

````markdown
---
name: delegate-driven-development
description: Use when executing an implementation plan end-to-end via delegated workers — orchestrates implementer → two-stage reviewer → fixer per ticket with a cached spec+plan prefix and non-blocking waits. Slots where subagent-driven-development would, but uses delegate_start workers instead of in-session subagents.
---

# Delegate-Driven Development (v2)

**Announce at start:** "I'm using the delegate-driven-development skill to orchestrate this plan."

You are the **orchestrator**. You own all ticket state and the pipeline. Workers are
stateless functions you dispatch via `delegate_start`; they report a structured footer
and you decide every transition. Design spec:
`docs/superpowers/specs/2026-05-31-delegate-driven-development-v2-design.md`.

## Core idea — cache the spec+plan prefix
`delegate_anchor` + `inherit_context` let every worker inherit a shared session prefix.
`buildSessionSnapshot` serializes the ENTIRE session branch from root to the anchor, so
prefix cleanliness depends on controlling what happens BEFORE the anchor — not on
selecting files. The prefix is exactly: `[system prompt][kickoff][full spec][full plan]`.
The first worker of each role pays to process it; later same-role workers hit cache.

**Cache correctness (non-negotiable):**
- Lock each role's `(provider, model)` for the whole run. Same system prompt + tool
  scope per role. The only sanctioned mid-run model switch is escalating a repeatedly
  failing task (see Escalation).

## Run setup (order matters — anchor FIRST)
1. Start in a fresh `/new` session; the kickoff message names the plan + spec paths.
2. **Anchor first, before any other tool call** (no worktree, no bash, no sharding):
   - `Read` the FULL spec to EOF (continue with `offset`/`limit`; `Read` truncates at
     ~2000 lines / 50KB — verify you reached EOF).
   - `Read` the FULL plan to EOF, same discipline.
   - `delegate_anchor({ name: "plan-foundation" })`.
   - If setup noise slipped in before the anchor, recover with `session_entries()` and
     `delegate_anchor({ name: "plan-foundation", entry_id })` at the correct entry.
3. Confirm the plan has `### Task N:` sections.
4. `using-git-worktrees` → create `.worktrees/<branch>` on a new feature branch; run
   project setup; verify a clean test baseline. Record the worktree path + branch name.
5. `ticket_shard(plan_path, spec_path)` → tickets land in `in-progress/ready/`.
6. Resolve role models: runtime args → `models.json` (beside this file). **Validate**
   every used role has non-empty `provider` and `model`; if not, halt and ask the user.

## Orchestration loop (sequential — one worker in flight)
For each ticket in `ready`, ascending task number:

1. `ticket_move task-NN active`. Record the diff boundary:
   `task_base_sha = git -C <worktree> rev-parse HEAD`; persist with
   `ticket_set task-NN task_base_sha <sha>`.
2. Build the implementer prompt = `references/implementer-prompt.md` with
   `{{PLAN_EXCERPT}}` (the ticket's `## Plan excerpt`), `{{WORKTREE_PATH}}`, `{{BRANCH}}`.
3. `delegate_start({ task, cwd: <worktree>, inherit_context: "plan-foundation",
   provider/model: implementer, thinking, tools: ["read","edit","write","bash"] })`.
4. **Wait (non-blocking):** launch `references/wait.sh <status_file> <timeout>` via the
   `process` tool with `alertOnSuccess: true`, `alertOnFailure: true`, and
   `logWatches: [{ pattern: "DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT" }]`. While
   waiting you MAY chat / investigate / pre-draft, but MUST NOT advance the pipeline,
   move the in-flight ticket, or edit worktree code.
5. On alert → `delegate_check` (authoritative) → `delegate_result`; parse `STATUS:`.
   - `BLOCKED` / `NEEDS_CONTEXT` → `ticket_move blocked`; stop and escalate to the user.
   - `DONE` / `DONE_WITH_CONCERNS` → proceed to the commit-boundary gate.
6. **Commit-boundary gate (mandatory before EVERY review and re-review).** In the
   worktree, require `git rev-parse HEAD` ≠ `task_base_sha` AND `git status --porcelain`
   empty. If HEAD didn't advance or the tree is dirty, the task commit is missing —
   re-dispatch with an explicit "commit your work" instruction, or escalate. Do not
   review until this passes.
7. `ticket_move review`. Build the reviewer prompt = `references/reviewer-prompt.md`
   with `{{PLAN_EXCERPT}}`, `{{WORKTREE_PATH}}`, `{{TASK_BASE_SHA}}`. `delegate_start`
   with the reviewer model and READ-ONLY tools `["read","bash"]`,
   `inherit_context: "plan-foundation"`. Wait via the same non-blocking pattern.
8. On alert → `delegate_check` → `delegate_result`; parse `VERDICT:`.
   - `PASS` → `ticket_move done`; next ticket.
   - `FAIL` → write the reviewer's Fix Instructions to `next_prompt`
     (`ticket_set task-NN next_prompt <…>`); increment `review_failures`
     (`ticket_get` → +1 → `ticket_set`); go to Escalation.

## Escalation circuit-breaker (by `review_failures`)
- **1** → routine fixer run: build `references/fixer-prompt.md` with `{{PLAN_EXCERPT}}`
  and `{{FIX_INSTRUCTIONS}}` (read from `next_prompt`), `delegate_start` with the fixer
  model and tools `["read","edit","write","bash"]`, `inherit_context: "plan-foundation"`.
  After it reports, re-run the commit-boundary gate (step 6), then re-enter review (step 7).
- **2** → YOU (the strong orchestrator) investigate the root cause. If it is a
  fundamental spec/design flaw → stop and escalate to the user with findings. Otherwise
  dispatch fixer run #2 (optionally escalate the fixer model — a deliberate cache sacrifice).
- **3** → always stop and escalate to the user.

## Non-blocking wait details
Status files are best-effort; the watcher is only a trigger — `delegate_check` is
authoritative. On `DELEGATE_WATCH_TIMEOUT` with a still-`running` worker, decide whether
to relaunch the watcher, `delegate_steer`, or `delegate_abort`. Get the `status_file`
path from the `delegate_start` result details (or `delegate_check`).

## Worker roles & tools
| Role | Tools |
|---|---|
| Implementer / Fixer | `read`, `edit`, `write`, `bash` |
| Reviewer | `read`, `bash` (strictly read-only) |
Workers never get `ticket_*` or `delegate_*` and must never touch `in-progress/`.

## Completion
When all tickets are `done`: optionally run a whole-implementation reviewer pass over
the full feature-branch diff, then hand off to `finishing-a-development-branch` to
verify tests and present merge/PR/cleanup options.

## Out of scope (other skills/tools)
spec writing → `brainstorming`; plan writing → `writing-plans`; sharding → `ticket_shard`;
worktree setup → `using-git-worktrees`; merge/cleanup → `finishing-a-development-branch`.
````

- [ ] **Step 2: Verify the skill has valid frontmatter and references every asset**

Run:
```bash
f=skills/delegate-driven-development/SKILL.md
head -1 "$f" | grep -q '^---$' \
  && grep -q "^name: delegate-driven-development$" "$f" \
  && grep -q "^description:" "$f" \
  && grep -q "delegate_anchor" "$f" \
  && grep -q "references/implementer-prompt.md" "$f" \
  && grep -q "references/reviewer-prompt.md" "$f" \
  && grep -q "references/fixer-prompt.md" "$f" \
  && grep -q "references/wait.sh" "$f" \
  && grep -q "models.json" "$f" \
  && grep -q "Commit-boundary gate" "$f" \
  && echo "SKILL_OK"
```
Expected: `SKILL_OK`

- [ ] **Step 3: Commit**

```bash
git add skills/delegate-driven-development/SKILL.md
git commit -m "feat(skill): add delegate-driven-development SKILL.md orchestration workflow"
```

---

### Task 13: Symlink the skill for local discovery and final verification

**Files:**
- Create: symlink `~/.pi/agent/skills/delegate-driven-development` → repo skill directory

The skill is discovered from `~/.pi/agent/skills/`. Symlink the dev source so Pi can load it. The symlink must point at the **main checkout** path (where the skill lives after this branch merges), not the worktree.

- [ ] **Step 1: Create the symlink**

Run (adjust `MAIN_CHECKOUT` if your main checkout path differs):
```bash
MAIN_CHECKOUT=/Users/martinkuek/Documents/Projects/pi-extensions
mkdir -p ~/.pi/agent/skills
ln -sfn "$MAIN_CHECKOUT/skills/delegate-driven-development" ~/.pi/agent/skills/delegate-driven-development
ls -l ~/.pi/agent/skills/delegate-driven-development
```
Expected: a symlink listing pointing at `…/skills/delegate-driven-development`.

> The symlink is a local-machine convenience, not a repo artifact — there is nothing to commit for this step.

- [ ] **Step 2: Run the full tickets test suite and typecheck once more**

Run: `cd extensions/tickets && npm test && npm run typecheck`
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 3: Verify the complete skill asset set exists**

Run:
```bash
d=skills/delegate-driven-development
for p in SKILL.md models.json references/wait.sh references/implementer-prompt.md \
         references/reviewer-prompt.md references/fixer-prompt.md; do
  test -f "$d/$p" && echo "ok  $p" || { echo "MISSING $p"; exit 1; }
done
```
Expected: six `ok` lines, no `MISSING`.

- [ ] **Step 4: Confirm the worker-prompt blobs are fully gone from the extension**

Run:
```bash
! grep -rn "review_prompt_template\|TWO-STAGE REVIEW\|Move ticket to review status" extensions/tickets/index.ts \
  && echo "CLEAN"
```
Expected: `CLEAN`

- [ ] **Step 5: Commit any remaining staged docs/config**

```bash
git add -A
git commit -m "chore(skill): final verification of delegate-driven-development v2 assets" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- §1 cache/anchor strategy → SKILL.md "Core idea" + "Run setup" (Task 12).
- §2 tickets-as-data refactor → Tasks 3, 4 (data-only shard); §2 `ticket_get` → Tasks 5, 6; new frontmatter fields → Task 3.
- §3 models.json + validation → Task 7 (file) + SKILL.md step 6 (validation).
- §4 run setup ordering → SKILL.md "Run setup" (Task 12).
- §5 orchestration loop + commit-boundary gate + `task_base_sha` → SKILL.md loop (Task 12); field emitted Task 3.
- §6 non-blocking wait + reconciliation → Task 8 (wait.sh) + SKILL.md "Non-blocking wait details".
- §7 review/fix/escalation → SKILL.md "Escalation" (Task 12) + reviewer/fixer templates (Tasks 10, 11).
- §8 roles/permissions/reporting + template layout → Tasks 9–12.
- §9 completion → SKILL.md "Completion".
- §10 boundaries → SKILL.md "Out of scope".
- §11 open questions are future/validation items — no implementation tasks required.

**Placeholder scan:** No `TBD`/`implement later`/"add error handling" placeholders. `{{PLAN_EXCERPT}}` etc. are intentional template tokens the orchestrator fills, documented in SKILL.md.

**Type consistency:** `getTicketField` (Task 5) is the helper; `ticket_get` (Task 6) is the tool that calls it — names consistent. New frontmatter fields `review_failures` / `task_base_sha` are spelled identically in Task 3 (emit), Task 5 (read tests), and SKILL.md (loop). Reporting footers (`STATUS:` / `VERDICT:`) match between the prompt templates (Tasks 9–11) and the SKILL.md loop parsing (Task 12).
