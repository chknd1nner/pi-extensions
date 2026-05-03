import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
};

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<ToolResult>;
};

type EventHandler = (event: unknown, ctx: unknown) => Promise<void> | void;

type IntegrationHarness = {
  getTool: (name: string) => RegisteredTool | undefined;
  trigger: (eventName: string, event?: unknown, ctx?: unknown) => Promise<void>;
};

type DelegateCheckDetails = {
  status: string;
  tool_calls: number;
  last_activity_seconds_ago: number;
  recent_activity: string[];
  input_tokens: number;
  output_tokens: number;
  context_usage_percent: number | null;
  error?: string;
};

type DelegateResultDetails = {
  status: string;
  result: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  error?: string;
  stderr?: string;
};

const RUN_INTEGRATION = process.env.DELEGATE_INTEGRATION === "1";
const TEST_PROVIDER = process.env.DELEGATE_INTEGRATION_PROVIDER ?? "anthropic";
const TEST_MODEL = process.env.DELEGATE_INTEGRATION_MODEL ?? "claude-haiku-4-5";
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TESTS_DIR, "..", "..", "..");

function todayDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function createIntegrationHarness(): IntegrationHarness {
  const registeredTools: RegisteredTool[] = [];
  const eventHandlers = new Map<string, EventHandler[]>();

  const pi = {
    on: (event: string, handler: EventHandler) => {
      const handlers = eventHandlers.get(event) ?? [];
      handlers.push(handler);
      eventHandlers.set(event, handlers);
    },
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [
      { name: "read" },
      { name: "bash" },
      { name: "edit" },
      { name: "write" },
      { name: "delegate_start" },
      { name: "delegate_check" },
      { name: "delegate_steer" },
      { name: "delegate_abort" },
      { name: "delegate_result" },
    ],
  } as unknown as ExtensionAPI;

  delegate(pi);

  return {
    getTool(name: string) {
      return registeredTools.find((tool) => tool.name === name);
    },
    async trigger(eventName: string, event: unknown = {}, ctx: unknown = {}) {
      for (const handler of eventHandlers.get(eventName) ?? []) {
        await handler(event, ctx);
      }
    },
  };
}

async function waitForValue<T>(
  label: string,
  fn: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 60_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

describe.skipIf(!RUN_INTEGRATION)("integration: full delegate lifecycle", () => {
  it(
    "spawns a worker, writes a progress log, and reads the final result",
    async () => {
      const sessionId = `delegate-integration-${Date.now()}`;
      const logDir = path.join(PROJECT_ROOT, ".pi", "delegate", todayDate(), sessionId);
      const logPath = path.join(logDir, "w1.progress.md");
      const harness = createIntegrationHarness();
      const modelRegistry = {
        find: () => ({ contextWindow: 200_000 }),
      };

      fs.rmSync(logDir, { recursive: true, force: true });
      await harness.trigger("session_start", {}, {
        sessionManager: {
          getSessionId: () => sessionId,
        },
      });

      const startTool = harness.getTool("delegate_start");
      const checkTool = harness.getTool("delegate_check");
      const resultTool = harness.getTool("delegate_result");

      expect(startTool).toBeDefined();
      expect(checkTool).toBeDefined();
      expect(resultTool).toBeDefined();

      const workerPrompt = [
        "You MUST use the bash tool exactly once with command `printf DELEGATE_TOOL_OK`.",
        "After the tool call, reply with exactly `DELEGATE_TEST_OK` and nothing else.",
      ].join(" ");

      try {
        const startResult = await startTool!.execute("call-start", {
          task: workerPrompt,
          model: TEST_MODEL,
          provider: TEST_PROVIDER,
          tools: ["bash"],
          timeout: 60,
          cwd: PROJECT_ROOT,
        });

        expect(startResult.details).toEqual({ task_id: "w1", status: "running" });

        await waitForValue(
          "progress log creation",
          () => (fs.existsSync(logPath) ? true : undefined),
          30_000,
        );

        const logContent = await waitForValue(
          "progress log content",
          () => {
            if (!fs.existsSync(logPath)) return undefined;
            const content = fs.readFileSync(logPath, "utf8");
            if (!content.includes("[TOOL: bash]")) return undefined;
            if (!content.includes("DELEGATE_TEST_OK")) return undefined;
            return content;
          },
          60_000,
        );

        expect(logContent).toContain("[TOOL: bash]");
        expect(logContent).toContain("DELEGATE_TOOL_OK");
        expect(logContent).toContain("DELEGATE_TEST_OK");

        const completedCheck = await waitForValue(
          "worker completion",
          async () => {
            const checkResult = await checkTool!.execute(
              "call-check",
              { task_id: "w1", detail: "full" },
              undefined,
              undefined,
              { modelRegistry },
            );
            const details = checkResult.details as DelegateCheckDetails | undefined;
            if (!details || details.status === "running") return undefined;
            return { checkResult, details };
          },
          60_000,
        );

        expect(completedCheck.details.status).toBe("completed");
        expect(completedCheck.details.tool_calls).toBeGreaterThanOrEqual(1);
        expect(completedCheck.details.recent_activity.some((entry) => entry.includes("bash"))).toBe(true);
        expect(completedCheck.checkResult.content[0]?.text).toContain("DELEGATE_TEST_OK");

        const result = await resultTool!.execute("call-result", { task_id: "w1" });
        const resultDetails = result.details as DelegateResultDetails | undefined;

        expect(resultDetails?.status).toBe("completed");
        expect(resultDetails?.result).toContain("DELEGATE_TEST_OK");
        expect(resultDetails?.usage).toMatchObject({
          input: expect.any(Number),
          output: expect.any(Number),
          cacheRead: expect.any(Number),
          cacheWrite: expect.any(Number),
        });
      } finally {
        await harness.trigger("session_shutdown");
        fs.rmSync(logDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
