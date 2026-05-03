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

export type WorkerUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  lastAssistantInput: number | null;
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
