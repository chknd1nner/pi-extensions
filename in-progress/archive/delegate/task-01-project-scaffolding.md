---
task_number: 1
title: Project Scaffolding
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Review Task 1: Project Scaffolding

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
  - Move ticket to done status (ticket_move task-01 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-01 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
review_prompt_template: |-
  Review Task 1: Project Scaffolding

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
  - Move ticket to done status (ticket_move task-01 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-01 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: Reviewed 2026-05-03. tsc --noEmit exits 0. Commit 419be8e contains exactly the 4 planned files. All types match spec interface tables. No issues found.
---

# Task 01 — Project Scaffolding

## Plan excerpt

**Files:**
- Create: `extensions/delegate/package.json`
- Create: `extensions/delegate/tsconfig.json`
- Create: `extensions/delegate/types.ts`
- Create: `extensions/delegate/index.ts` (stub)

- [x] **Step 1: Create `package.json`**

```json
{
  "name": "delegate-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "@mariozechner/pi-ai": "latest",
    "typebox": "latest",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [x] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

- [x] **Step 3: Create `types.ts`**

```typescript
export type WorkerStatus = "running" | "completed" | "failed" | "aborted";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type DelegateStartParams = {
  task: string;
  model: string;
  provider: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  denied_tools?: string[];
  timeout?: number;
  visibility?: string;
  system_prompt?: string;
  cwd?: string;
};

export type ToolCallRecord = {
  name: string;
  args: string;
  result?: string;
  startedAt: number;
  endedAt?: number;
};

export type WorkerResult = {
  status: WorkerStatus;
  result: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost?: number;
  };
};

export type RPCCommand = {
  type: string;
  id?: string;
  message?: string;
  [key: string]: unknown;
};

export type RPCEvent = {
  type: string;
  [key: string]: unknown;
};
```

- [x] **Step 4: Create stub `index.ts`**

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function delegate(pi: ExtensionAPI) {
  // Tools will be registered in subsequent tasks
}
```

- [x] **Step 5: Install dependencies**

Run: `cd extensions/delegate && npm install`
Expected: `node_modules/` created with pi-coding-agent, pi-ai, typebox, typescript, vitest

- [x] **Step 6: Verify typecheck passes**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 7: Commit**

```bash
git add extensions/delegate/package.json extensions/delegate/tsconfig.json extensions/delegate/types.ts extensions/delegate/index.ts
git commit -m "feat(delegate): scaffold extension with types and project config"
```

---


---

## Notes

- 2026-05-03: Created scaffold files under `extensions/delegate/` in implementation worktree.
- Ran `cd extensions/delegate && npm install` (success).
- Ran `cd extensions/delegate && npx tsc --noEmit` (success, no output).
- Committed scaffold files on `feature/delegate-extension-impl`.
