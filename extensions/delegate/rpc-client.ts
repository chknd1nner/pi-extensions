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
