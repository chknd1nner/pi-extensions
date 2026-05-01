import type { AgentToolResult, ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { ResolvedAgent, ResolvedUser, ToolName } from "../types.js";
import { PathPolicy } from "./path-policy.js";

const TOOL_PROMPTS: Record<ToolName, { promptSnippet: string; promptGuidelines: string[] }> = {
  read: {
    promptSnippet: "Read files inside Inbox, Workspace, or Exports.",
    promptGuidelines: [
      "Use read only for files inside the user's allowed workspace roots.",
      "If read returns an access denial, do not retry the same hidden or control-plane path.",
    ],
  },
  write: {
    promptSnippet: "Write new files only inside writable workspace roots.",
    promptGuidelines: [
      "Use write only for paths inside writable workspace roots.",
      "Do not use write to overwrite hidden config or control-plane files.",
    ],
  },
  edit: {
    promptSnippet: "Apply exact text replacements inside writable workspace roots.",
    promptGuidelines: [
      "Use edit only for files inside writable workspace roots.",
      "Do not use edit when you cannot match the exact original text.",
    ],
  },
  grep: {
    promptSnippet: "Search text inside readable workspace roots.",
    promptGuidelines: [
      "Use grep only inside readable workspace roots.",
      "If no path is provided, grep searches Workspace by default.",
    ],
  },
  find: {
    promptSnippet: "Find files inside readable workspace roots.",
    promptGuidelines: [
      "Use find only inside readable workspace roots.",
      "If no path is provided, find searches Workspace by default.",
    ],
  },
  ls: {
    promptSnippet: "List directories inside readable workspace roots.",
    promptGuidelines: [
      "Use ls only inside readable workspace roots.",
      "If no path is provided, ls lists Workspace by default.",
    ],
  },
};

function blockedResult(message: string): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text: `Access denied: ${message}` }],
    details: undefined,
  };
}

export function buildGuardedToolDefinitions(
  user: ResolvedUser,
  agent: ResolvedAgent,
  onAudit: (event: { type: string; userSlug: string; data: Record<string, unknown> }) => void,
): ToolDefinition[] {
  const policy = new PathPolicy(user, agent);

  const read = createReadToolDefinition(user.homeDir);
  const write = createWriteToolDefinition(user.homeDir);
  const edit = createEditToolDefinition(user.homeDir);
  const grep = createGrepToolDefinition(user.homeDir);
  const find = createFindToolDefinition(user.homeDir);
  const ls = createLsToolDefinition(user.homeDir);

  const guardedRead: typeof read = {
    ...read,
    promptSnippet: TOOL_PROMPTS.read.promptSnippet,
    promptGuidelines: TOOL_PROMPTS.read.promptGuidelines,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const absolutePath = await policy.resolveReadable(params.path);
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "read", path: absolutePath, allowed: true } });
        return read.execute(toolCallId, { ...params, path: absolutePath }, signal, onUpdate, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onAudit({
          type: "tool_call",
          userSlug: user.slug,
          data: { toolName: "read", path: params.path, allowed: false, message },
        });
        return blockedResult(message);
      }
    },
  };

  const guardedWrite: typeof write = {
    ...write,
    promptSnippet: TOOL_PROMPTS.write.promptSnippet,
    promptGuidelines: TOOL_PROMPTS.write.promptGuidelines,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const absolutePath = await policy.resolveWritable(params.path);
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "write", path: absolutePath, allowed: true } });
        return write.execute(toolCallId, { ...params, path: absolutePath }, signal, onUpdate, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onAudit({
          type: "tool_call",
          userSlug: user.slug,
          data: { toolName: "write", path: params.path, allowed: false, message },
        });
        return blockedResult(message);
      }
    },
  };

  const guardedEdit: typeof edit = {
    ...edit,
    promptSnippet: TOOL_PROMPTS.edit.promptSnippet,
    promptGuidelines: TOOL_PROMPTS.edit.promptGuidelines,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const absolutePath = await policy.resolveWritable(params.path);
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "edit", path: absolutePath, allowed: true } });
        return edit.execute(toolCallId, { ...params, path: absolutePath }, signal, onUpdate, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onAudit({
          type: "tool_call",
          userSlug: user.slug,
          data: { toolName: "edit", path: params.path, allowed: false, message },
        });
        return blockedResult(message);
      }
    },
  };

  const guardedGrep: typeof grep = {
    ...grep,
    promptSnippet: TOOL_PROMPTS.grep.promptSnippet,
    promptGuidelines: TOOL_PROMPTS.grep.promptGuidelines,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const absolutePath = await policy.resolveSearchRoot(params.path);
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "grep", path: absolutePath, allowed: true } });
        return grep.execute(toolCallId, { ...params, path: absolutePath }, signal, onUpdate, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onAudit({
          type: "tool_call",
          userSlug: user.slug,
          data: { toolName: "grep", path: params.path ?? "Workspace", allowed: false, message },
        });
        return blockedResult(message);
      }
    },
  };

  const guardedFind: typeof find = {
    ...find,
    promptSnippet: TOOL_PROMPTS.find.promptSnippet,
    promptGuidelines: TOOL_PROMPTS.find.promptGuidelines,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const absolutePath = await policy.resolveSearchRoot(params.path);
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "find", path: absolutePath, allowed: true } });
        return find.execute(toolCallId, { ...params, path: absolutePath }, signal, onUpdate, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onAudit({
          type: "tool_call",
          userSlug: user.slug,
          data: { toolName: "find", path: params.path ?? "Workspace", allowed: false, message },
        });
        return blockedResult(message);
      }
    },
  };

  const guardedLs: typeof ls = {
    ...ls,
    promptSnippet: TOOL_PROMPTS.ls.promptSnippet,
    promptGuidelines: TOOL_PROMPTS.ls.promptGuidelines,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const absolutePath = await policy.resolveSearchRoot(params.path);
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "ls", path: absolutePath, allowed: true } });
        return ls.execute(toolCallId, { ...params, path: absolutePath }, signal, onUpdate, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onAudit({
          type: "tool_call",
          userSlug: user.slug,
          data: { toolName: "ls", path: params.path ?? "Workspace", allowed: false, message },
        });
        return blockedResult(message);
      }
    },
  };

  const definitionsByName: Record<ToolName, ToolDefinition<any, any, any>> = {
    read: guardedRead,
    write: guardedWrite,
    edit: guardedEdit,
    grep: guardedGrep,
    find: guardedFind,
    ls: guardedLs,
  };

  return agent.capabilities.tools.map((toolName) => definitionsByName[toolName]);
}
