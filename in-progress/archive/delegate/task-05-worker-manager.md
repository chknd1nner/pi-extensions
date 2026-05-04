---
task_number: 5
title: Worker Manager
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Read the Plan excerpt section below and execute each step in order.
  Check off steps as you complete them (- [x]).
  Run verification commands and confirm they pass.
  Commit when all steps are complete.

  Hint: if you attach a ProgressLogWriter to each worker entry, make cleanup idempotent and close it on all terminal paths (disposeAll, failed/aborted/completed workers). Don't assume agent_end always fires.
review_prompt_template: |-
  Review Task 5: Worker Manager

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
  - Move ticket to done status (ticket_move task-05 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-05 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: 'Spec: matches worker-manager.ts requirements (registry, sequential IDs, env-overridable cap, terminal-state retention, idempotent disposeAll). Code: matches plan exactly; defensive env parsing; Promise.allSettled-based shutdown. Tests: 9/9 worker-manager tests pass; full suite 29/29 across 4 files. Typecheck: tsc --noEmit clean. Commit 2773919 contains only worker-manager.ts and tests/worker-manager.test.ts (185 insertions). Forward-looking notes for task 06+: (1) wire DELEGATE_MAX_WORKERS env read in index.ts; (2) terminal-state RPC client disposal happens in tool/event wiring, not setStatus; (3) consider transitioning surviving entries to "aborted" inside disposeAll. Workspace hygiene: uncommitted edits to progress.ts/tests/progress.test.ts in the worktree are unrelated to task 05 — implementor should commit/stash before starting task 06.'
---

# Task 05 — Worker Manager

## Plan excerpt

**Files:**
- Create: `extensions/delegate/worker-manager.ts`
- Create: `extensions/delegate/tests/worker-manager.test.ts`

- [x] **Step 1: Write failing tests**

Create `tests/worker-manager.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import { WorkerManager } from "../worker-manager";
import type { DelegateStartParams } from "../types";

const baseParams: DelegateStartParams = {
  task: "Review the code",
  model: "claude-sonnet-4-6",
  provider: "anthropic",
};

describe("WorkerManager", () => {
  let manager: WorkerManager;

  beforeEach(() => {
    manager = new WorkerManager({ maxWorkers: 2, projectRoot: "/tmp/test" });
  });

  it("generates sequential task IDs", () => {
    expect(manager.nextTaskId()).toBe("w1");
    expect(manager.nextTaskId()).toBe("w2");
    expect(manager.nextTaskId()).toBe("w3");
  });

  it("tracks a registered worker", () => {
    manager.register("w1", baseParams);
    const worker = manager.get("w1");
    expect(worker).toBeDefined();
    expect(worker!.status).toBe("running");
    expect(worker!.params.task).toBe("Review the code");
  });

  it("returns undefined for unknown task ID", () => {
    expect(manager.get("w99")).toBeUndefined();
  });

  it("reports active worker count", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    expect(manager.activeCount()).toBe(2);
  });

  it("enforces concurrency cap", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    expect(manager.canStart()).toBe(false);
    expect(manager.activeWorkerDescriptions()).toEqual([
      { taskId: "w1", task: "Review the code" },
      { taskId: "w2", task: "Review the code" },
    ]);
  });

  it("allows new workers after one completes", () => {
    manager.register("w1", baseParams);
    manager.register("w2", baseParams);
    manager.setStatus("w1", "completed");
    expect(manager.canStart()).toBe(true);
    expect(manager.activeCount()).toBe(1);
  });

  it("keeps completed workers readable", () => {
    manager.register("w1", baseParams);
    manager.setStatus("w1", "completed");
    const worker = manager.get("w1");
    expect(worker).toBeDefined();
    expect(worker!.status).toBe("completed");
  });

  it("rejects transitions out of terminal states", () => {
    manager.register("w1", baseParams);
    manager.setStatus("w1", "completed");
    manager.setStatus("w1", "running");
    expect(manager.get("w1")!.status).toBe("completed");
  });

  it("reads max workers from env var", () => {
    const envManager = new WorkerManager({ maxWorkers: 2, projectRoot: "/tmp", maxWorkersEnv: "5" });
    for (let i = 1; i <= 5; i++) {
      envManager.register(`w${i}`, baseParams);
    }
    expect(envManager.canStart()).toBe(false);
    expect(envManager.activeCount()).toBe(5);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd extensions/delegate && npx vitest run tests/worker-manager.test.ts`
Expected: FAIL — `WorkerManager` not found

- [x] **Step 3: Implement `worker-manager.ts`**

```typescript
import type { DelegateStartParams, WorkerStatus } from "./types";
import type { RPCClient } from "./rpc-client";
import type { ProgressAccumulator } from "./progress";
import type { ProgressLogWriter } from "./visibility";

export type WorkerEntry = {
  taskId: string;
  status: WorkerStatus;
  params: DelegateStartParams;
  startedAt: number;
  rpcClient?: RPCClient;
  progress?: ProgressAccumulator;
  logWriter?: ProgressLogWriter;
  error?: string;
  timeoutTimer?: ReturnType<typeof setTimeout>;
};

export type WorkerManagerOptions = {
  maxWorkers: number;
  projectRoot: string;
  maxWorkersEnv?: string;
};

export class WorkerManager {
  private workers = new Map<string, WorkerEntry>();
  private counter = 0;
  private maxWorkers: number;
  readonly projectRoot: string;

  constructor(options: WorkerManagerOptions) {
    this.projectRoot = options.projectRoot;
    const envMax = options.maxWorkersEnv;
    if (envMax) {
      const parsed = parseInt(envMax, 10);
      this.maxWorkers = parsed > 0 ? parsed : options.maxWorkers;
    } else {
      this.maxWorkers = options.maxWorkers;
    }
  }

  nextTaskId(): string {
    this.counter++;
    return `w${this.counter}`;
  }

  register(taskId: string, params: DelegateStartParams): WorkerEntry {
    const entry: WorkerEntry = {
      taskId,
      status: "running",
      params,
      startedAt: Date.now(),
    };
    this.workers.set(taskId, entry);
    return entry;
  }

  get(taskId: string): WorkerEntry | undefined {
    return this.workers.get(taskId);
  }

  setStatus(taskId: string, status: WorkerStatus, error?: string): void {
    const entry = this.workers.get(taskId);
    if (!entry) return;
    if (entry.status === "completed" || entry.status === "failed" || entry.status === "aborted") return;
    entry.status = status;
    if (error) entry.error = error;
  }

  activeCount(): number {
    let count = 0;
    for (const entry of this.workers.values()) {
      if (entry.status === "running") count++;
    }
    return count;
  }

  canStart(): boolean {
    return this.activeCount() < this.maxWorkers;
  }

  activeWorkerDescriptions(): { taskId: string; task: string }[] {
    const result: { taskId: string; task: string }[] = [];
    for (const entry of this.workers.values()) {
      if (entry.status === "running") {
        result.push({ taskId: entry.taskId, task: entry.params.task });
      }
    }
    return result;
  }

  async disposeAll(): Promise<void> {
    const kills: Promise<void>[] = [];
    for (const entry of this.workers.values()) {
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
      if (entry.status === "running" && entry.rpcClient) {
        kills.push(entry.rpcClient.kill());
      }
      entry.logWriter?.close();
    }
    await Promise.allSettled(kills);
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd extensions/delegate && npx vitest run tests/worker-manager.test.ts`
Expected: All 9 tests PASS

- [x] **Step 5: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 6: Commit**

```bash
git add extensions/delegate/worker-manager.ts extensions/delegate/tests/worker-manager.test.ts
git commit -m "feat(delegate): add worker manager with concurrency enforcement"
```

---


---

## Notes

- RED: `npx vitest run tests/worker-manager.test.ts` failed with `Cannot find module '../worker-manager'`.
- GREEN: `npx vitest run tests/worker-manager.test.ts` passed (`9 passed`).
- Typecheck: `npx tsc --noEmit` passed (no output).
