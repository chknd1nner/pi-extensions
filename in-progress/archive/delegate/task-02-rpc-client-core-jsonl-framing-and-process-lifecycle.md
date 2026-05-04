---
task_number: 2
title: RPC Client — Core JSONL Framing and Process Lifecycle
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Review Task 2: RPC Client — Core JSONL Framing and Process Lifecycle

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
  - Move ticket to done status (ticket_move task-02 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-02 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
review_prompt_template: |-
  Review Task 2: RPC Client — Core JSONL Framing and Process Lifecycle

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
  - Move ticket to done status (ticket_move task-02 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-02 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: 'PASS (2026-05-03): Spec Stage 1 + Code Stage 2 completed. Verified implementation in extensions/delegate/rpc-client.ts against spec sections: strict LF JSONL framing, spawn args, clean kill lifecycle (abort→stdin close→SIGTERM→SIGKILL), stderr capture, one-client lifecycle. Verification evidence: `npm test -- tests/rpc-client.test.ts` => 1 file passed, 7 tests passed; `npm run typecheck` => success (no TS errors).'
---

# Task 02 — RPC Client — Core JSONL Framing and Process Lifecycle

## Plan excerpt

**Files:**
- Create: `extensions/delegate/rpc-client.ts`
- Create: `extensions/delegate/tests/rpc-client.test.ts`

- [x] **Step 1: Write failing tests for JSONL parsing**

Create `tests/rpc-client.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseJsonlBuffer, RPCClient } from "../rpc-client";

describe("parseJsonlBuffer", () => {
  it("extracts complete lines and returns remainder", () => {
    const { lines, remainder } = parseJsonlBuffer(
      '{"type":"agent_start"}\n{"type":"message_update"}\npartial'
    );
    expect(lines).toEqual(['{"type":"agent_start"}', '{"type":"message_update"}']);
    expect(remainder).toBe("partial");
  });

  it("returns empty lines for buffer with no newline", () => {
    const { lines, remainder } = parseJsonlBuffer("no-newline-yet");
    expect(lines).toEqual([]);
    expect(remainder).toBe("no-newline-yet");
  });

  it("handles empty buffer", () => {
    const { lines, remainder } = parseJsonlBuffer("");
    expect(lines).toEqual([]);
    expect(remainder).toBe("");
  });

  it("handles trailing newline with no remainder", () => {
    const { lines, remainder } = parseJsonlBuffer('{"type":"done"}\n');
    expect(lines).toEqual(['{"type":"done"}']);
    expect(remainder).toBe("");
  });

  it("splits only on LF, not Unicode line separators", () => {
    const unicodeLine = `{"text":"has  and  inside"}\n`;
    const { lines, remainder } = parseJsonlBuffer(unicodeLine);
    expect(lines).toEqual([`{"text":"has  and  inside"}`]);
    expect(remainder).toBe("");
  });

  it("strips trailing CR from CRLF lines", () => {
    const { lines, remainder } = parseJsonlBuffer('{"type":"ok"}\r\n');
    expect(lines).toEqual(['{"type":"ok"}']);
    expect(remainder).toBe("");
  });
});

describe("RPCClient.sendAndWait", () => {
  it("returns null on timeout when no response arrives", async () => {
    const client = new RPCClient(
      { model: "test", provider: "test", cwd: "/tmp" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    // Don't start — just test sendAndWait returns null when stdin isn't writable
    const result = await client.sendAndWait({ type: "get_session_stats" }, 100);
    expect(result).toBeNull();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd extensions/delegate && npx vitest run tests/rpc-client.test.ts`
Expected: FAIL — `parseJsonlBuffer` not found

- [x] **Step 3: Implement `rpc-client.ts`**

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import type { RPCCommand, RPCEvent } from "./types";

export function parseJsonlBuffer(buffer: string): { lines: string[]; remainder: string } {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === "\n") {
      let line = buffer.slice(start, i);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
      start = i + 1;
    }
  }
  return { lines, remainder: buffer.slice(start) };
}

export type RPCClientOptions = {
  model: string;
  provider: string;
  thinking?: string;
  tools?: string[];
  systemPrompt?: string;
  cwd: string;
  allToolNames?: string[];
  deniedTools?: string[];
};

export type RPCClientCallbacks = {
  onEvent: (event: RPCEvent) => void;
  onExit: (code: number | null, signal: string | null) => void;
  onError: (err: string) => void;
};

export class RPCClient {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private stderr = "";
  private exited = false;
  private exitPromise: Promise<void> | null = null;
  private callbacks: RPCClientCallbacks;
  private responseWaiters = new Map<string, (event: RPCEvent) => void>();
  private requestCounter = 0;

  constructor(
    private options: RPCClientOptions,
    callbacks: RPCClientCallbacks,
  ) {
    this.callbacks = callbacks;
  }

  start(): void {
    const args = this.buildArgs();
    this.proc = spawn("pi", args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.exitPromise = new Promise<void>((resolve) => {
      this.proc!.once("exit", (code, signal) => {
        this.exited = true;
        this.callbacks.onExit(code, signal);
        resolve();
      });
    });

    this.proc.on("error", (err) => {
      this.callbacks.onError(err.message);
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      const { lines, remainder } = parseJsonlBuffer(this.buffer);
      this.buffer = remainder;
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as RPCEvent;
          if (event.type === "response" && event.id) {
            const waiter = this.responseWaiters.get(event.id as string);
            if (waiter) {
              waiter(event);
              continue;
            }
          }
          this.callbacks.onEvent(event);
        } catch {
          // skip malformed lines
        }
      }
    });

    this.proc.stderr!.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
      if (this.stderr.length > 10_000) {
        this.stderr = this.stderr.slice(-5_000);
      }
    });
  }

  send(command: RPCCommand): void {
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify(command) + "\n");
  }

  getStderr(): string {
    return this.stderr;
  }

  async kill(): Promise<void> {
    if (!this.proc || this.exited) return;

    // Step 1: RPC abort for clean shutdown
    this.send({ type: "abort" });
    await Promise.race([this.exitPromise, new Promise((r) => setTimeout(r, 2000))]);
    if (this.exited) return;

    // Step 2: Close stdin to trigger process exit
    this.proc.stdin?.end();
    await Promise.race([this.exitPromise, new Promise((r) => setTimeout(r, 2000))]);
    if (this.exited) return;

    // Step 3: SIGTERM
    this.proc.kill("SIGTERM");
    await Promise.race([this.exitPromise, new Promise((r) => setTimeout(r, 3000))]);
    if (this.exited) return;

    // Step 4: SIGKILL
    this.proc.kill("SIGKILL");
  }

  async sendAndWait(command: RPCCommand, timeoutMs = 2000): Promise<RPCEvent | null> {
    const id = `req-${++this.requestCounter}`;
    const cmd = { ...command, id };

    return new Promise<RPCEvent | null>((resolve) => {
      const timer = setTimeout(() => {
        this.responseWaiters.delete(id);
        resolve(null);
      }, timeoutMs);

      this.responseWaiters.set(id, (event) => {
        clearTimeout(timer);
        this.responseWaiters.delete(id);
        resolve(event);
      });

      this.send(cmd);
    });
  }

  closeStdin(): void {
    this.proc?.stdin?.end();
  }

  isAlive(): boolean {
    return this.proc !== null && !this.exited;
  }

  private buildArgs(): string[] {
    const args = [
      "--mode", "rpc",
      "--no-session",
      "--model", this.options.model,
      "--provider", this.options.provider,
    ];
    // Workers load extensions normally so they can use the user's custom tools.
    // delegate_* tools are excluded via the --tools allowlist to prevent recursive delegation.
    if (this.options.thinking) {
      args.push("--thinking", this.options.thinking);
    }
    if (this.options.tools && this.options.tools.length > 0) {
      args.push("--tools", this.options.tools.join(","));
    } else if (this.options.deniedTools && this.options.deniedTools.length > 0 && this.options.allToolNames) {
      const denied = new Set(this.options.deniedTools);
      const allowed = this.options.allToolNames.filter((t) => !denied.has(t));
      if (allowed.length > 0) {
        args.push("--tools", allowed.join(","));
      } else {
        args.push("--no-tools");
      }
    }
    // Workers auto-load AGENTS.md and CLAUDE.md for project context.
    // Role-specific instructions can be addressed via @worker.md references in AGENTS.md.
    if (this.options.systemPrompt) {
      args.push("--append-system-prompt", this.options.systemPrompt);
    }
    return args;
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd extensions/delegate && npx vitest run tests/rpc-client.test.ts`
Expected: All 7 tests PASS

- [x] **Step 5: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 6: Commit**

```bash
git add extensions/delegate/rpc-client.ts extensions/delegate/tests/rpc-client.test.ts
git commit -m "feat(delegate): add RPC client with JSONL framing and process lifecycle"
```

---


---

## Notes

- RED check: `cd extensions/delegate && npx vitest run tests/rpc-client.test.ts` failed initially with `Cannot find module '../rpc-client'`.
- GREEN check: `cd extensions/delegate && npx vitest run tests/rpc-client.test.ts` passed (`7 passed`).
- Typecheck: `cd extensions/delegate && npx tsc --noEmit` passed (exit 0, no output).
- Commit: `4c14142` on `feature/delegate-extension-impl`. 
