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
