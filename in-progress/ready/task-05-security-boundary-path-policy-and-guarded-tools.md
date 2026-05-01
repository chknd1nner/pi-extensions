---
task_number: 5
title: 'Implement the security boundary: path policy plus guarded same-name tool definitions'
status: Ready for implementation
lane: ready
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are implementing Task 5 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket:
  - Ticket: in-progress/ready/task-05-security-boundary-path-policy-and-guarded-tools.md
  - Plan: docs/superpowers/plans/2026-04-30-familyos-telegram.md
  - Spec: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md

  Work only on this task. Follow the plan excerpt in this ticket exactly.
  When implementation and verification are complete:
  - move this ticket to in-progress/review/
  - set status to Ready for review
  - set lane to review
  - replace next_prompt with the review prompt template from this ticket or an updated equivalent
  - add brief notes about verification and any follow-up concerns
review_prompt_template: |-
  You are reviewing Task 5 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket and the current git diff.
  Review only the scope in this ticket plan excerpt.
  If the task passes review:
  - move this ticket to in-progress/done/
  - set status to Done
  - set lane to done
  - add a short approval note

  If the task needs changes:
  - move this ticket to in-progress/needs-fix/
  - set status to Needs fix
  - set lane to needs-fix
  - replace next_prompt with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
---

# Task 05 — Implement the security boundary: path policy plus guarded same-name tool definitions

## Plan excerpt


**Files:**
- Create: `services/familyos/src/pi/path-policy.ts`
- Create: `services/familyos/src/pi/guarded-tools.ts`
- Create: `services/familyos/tests/path-policy.test.ts`
- Create: `services/familyos/tests/guarded-tools.test.ts`

- [ ] **Step 1: Write the failing path-policy and guarded-tool tests**

Create `services/familyos/tests/path-policy.test.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PathPolicy } from "../src/pi/path-policy";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { createTempRoot } from "./helpers/temp-root";

describe("PathPolicy", () => {
  it("allows reads inside Inbox, Workspace, and Exports but blocks .pi", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(user.workspaceDir, { recursive: true });
    await fs.mkdir(path.dirname(user.piSettingsPath), { recursive: true });
    await fs.writeFile(path.join(user.workspaceDir, "notes.txt"), "workspace ok");
    await fs.writeFile(path.join(path.dirname(user.piSettingsPath), "secret.txt"), "nope");

    const policy = new PathPolicy(user, {
      id: "default",
      displayName: "FamilyOS Assistant",
      soul: "You are FamilyOS.",
      sourceDir: path.join(temp.rootDir, "agents", "default"),
      capabilities: {
        tools: ["read", "grep", "find", "ls"],
        readRoots: ["Inbox", "Workspace", "Exports"],
        writeRoots: ["Workspace", "Exports"],
      },
    });

    await expect(policy.resolveReadable("Workspace/notes.txt")).resolves.toContain("notes.txt");
    await expect(policy.resolveReadable(".pi/secret.txt")).rejects.toThrow("outside allowed read roots");
    await temp.cleanup();
  });

  it("blocks symlink escapes", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(user.workspaceDir, { recursive: true });
    await fs.mkdir(path.dirname(user.piSettingsPath), { recursive: true });
    await fs.writeFile(path.join(path.dirname(user.piSettingsPath), "secret.txt"), "nope");
    await fs.symlink(path.join(path.dirname(user.piSettingsPath), "secret.txt"), path.join(user.workspaceDir, "secret-link.txt"));

    const policy = new PathPolicy(user, {
      id: "default",
      displayName: "FamilyOS Assistant",
      soul: "You are FamilyOS.",
      sourceDir: path.join(temp.rootDir, "agents", "default"),
      capabilities: {
        tools: ["read", "grep", "find", "ls"],
        readRoots: ["Inbox", "Workspace", "Exports"],
        writeRoots: ["Workspace", "Exports"],
      },
    });

    await expect(policy.resolveReadable("Workspace/secret-link.txt")).rejects.toThrow("outside allowed read roots");
    await temp.cleanup();
  });
});
```

Create `services/familyos/tests/guarded-tools.test.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildGuardedToolDefinitions } from "../src/pi/guarded-tools";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { createTempRoot } from "./helpers/temp-root";

describe("buildGuardedToolDefinitions", () => {
  it("only exposes the agent's allowed tools and re-authored prompt metadata", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    const tools = buildGuardedToolDefinitions(
      user,
      {
        id: "default",
        displayName: "FamilyOS Assistant",
        soul: "You are FamilyOS.",
        sourceDir: path.join(temp.rootDir, "agents", "default"),
        capabilities: {
          tools: ["read", "ls"],
          readRoots: ["Inbox", "Workspace", "Exports"],
          writeRoots: ["Workspace", "Exports"],
        },
      },
      vi.fn(),
    );

    expect(tools.map((tool) => tool.name)).toEqual(["read", "ls"]);
    expect(tools.every((tool) => tool.promptSnippet && tool.promptGuidelines?.length)).toBe(true);
    await temp.cleanup();
  });

  it("returns a safe denial result for hidden user settings", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(path.dirname(user.piSettingsPath), { recursive: true });
    await fs.writeFile(path.join(path.dirname(user.piSettingsPath), "secret.txt"), "blocked");

    const tools = buildGuardedToolDefinitions(
      user,
      {
        id: "default",
        displayName: "FamilyOS Assistant",
        soul: "You are FamilyOS.",
        sourceDir: path.join(temp.rootDir, "agents", "default"),
        capabilities: {
          tools: ["read"],
          readRoots: ["Inbox", "Workspace", "Exports"],
          writeRoots: ["Workspace", "Exports"],
        },
      },
      vi.fn(),
    );

    const readTool = tools[0]!;
    const result = await readTool.execute("call-1", { path: ".pi/secret.txt" }, undefined, undefined, undefined as any);

    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as any).text).toContain("Access denied");
    await temp.cleanup();
  });

  it("denies control-plane reads outside the user workspace roots", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(paths.configDir, { recursive: true });
    await fs.writeFile(path.join(paths.configDir, "familyos.json"), JSON.stringify({ secret: "bot-token" }, null, 2));

    const tools = buildGuardedToolDefinitions(
      user,
      {
        id: "default",
        displayName: "FamilyOS Assistant",
        soul: "You are FamilyOS.",
        sourceDir: path.join(temp.rootDir, "agents", "default"),
        capabilities: {
          tools: ["read"],
          readRoots: ["Inbox", "Workspace", "Exports"],
          writeRoots: ["Workspace", "Exports"],
        },
      },
      vi.fn(),
    );

    const readTool = tools[0]!;
    const result = await readTool.execute(
      "call-2",
      { path: path.relative(user.homeDir, path.join(paths.configDir, "familyos.json")) },
      undefined,
      undefined,
      undefined as any,
    );

    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as any).text).toContain("Access denied");
    await temp.cleanup();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/path-policy.test.ts tests/guarded-tools.test.ts`
Expected: FAIL because `path-policy.ts` and `guarded-tools.ts` do not exist yet

- [ ] **Step 3: Implement canonical path checking and root enforcement**

Create `services/familyos/src/pi/path-policy.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedAgent, ResolvedUser } from "../types.js";

function isInside(target: string, root: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function findExistingAncestor(target: string): Promise<string> {
  let current = path.dirname(target);
  while (true) {
    try {
      return await fs.realpath(current);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export class PathPolicy {
  private readonly readRoots: string[];
  private readonly writeRoots: string[];

  constructor(
    private readonly user: ResolvedUser,
    private readonly agent: ResolvedAgent,
  ) {
    this.readRoots = agent.capabilities.readRoots.map((relative) => path.join(user.homeDir, relative));
    this.writeRoots = agent.capabilities.writeRoots.map((relative) => path.join(user.homeDir, relative));
  }

  async resolveReadable(inputPath: string): Promise<string> {
    const candidate = path.resolve(this.user.homeDir, inputPath);
    const realPath = await fs.realpath(candidate);

    if (!this.readRoots.some((root) => isInside(realPath, root))) {
      throw new Error(`Path "${inputPath}" is outside allowed read roots.`);
    }

    return realPath;
  }

  async resolveSearchRoot(inputPath?: string): Promise<string> {
    return this.resolveReadable(inputPath ?? "Workspace");
  }

  async resolveWritable(inputPath: string): Promise<string> {
    const candidate = path.resolve(this.user.homeDir, inputPath);
    const existingAncestor = await findExistingAncestor(candidate);
    const reconstructed = path.join(existingAncestor, path.relative(existingAncestor, candidate));

    if (!this.writeRoots.some((root) => isInside(reconstructed, root))) {
      throw new Error(`Path "${inputPath}" is outside allowed write roots.`);
    }

    return reconstructed;
  }
}
```

- [ ] **Step 4: Implement guarded tool builders around Pi tool definitions**

Create `services/familyos/src/pi/guarded-tools.ts`:

```typescript
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { ResolvedAgent, ResolvedUser, ToolName } from "../types.js";
import { PathPolicy } from "./path-policy.js";

// Keep the *Definition family here. The package top level exports both
// createReadTool() and createReadToolDefinition(), but FamilyOS needs
// ToolDefinition objects because customTools / pi.registerTool() consume
// definitions, not wrapped AgentTool instances.

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

function blockedResult<TDetails>(message: string): AgentToolResult<TDetails | undefined> {
  return {
    content: [{ type: "text", text: `Access denied: ${message}` }],
    details: undefined as TDetails | undefined,
  };
}

export function buildGuardedToolDefinitions(
  user: ResolvedUser,
  agent: ResolvedAgent,
  onAudit: (event: { type: string; userSlug: string; data: Record<string, unknown> }) => void,
): ToolDefinition[] {
  const policy = new PathPolicy(user, agent);
  const definitions: ToolDefinition[] = [];

  const read = createReadToolDefinition(user.homeDir);
  const write = createWriteToolDefinition(user.homeDir);
  const edit = createEditToolDefinition(user.homeDir);
  const grep = createGrepToolDefinition(user.homeDir);
  const find = createFindToolDefinition(user.homeDir);
  const ls = createLsToolDefinition(user.homeDir);

  definitions.push({
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
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "read", path: params.path, allowed: false, message } });
        return blockedResult(message);
      }
    },
  });

  definitions.push({
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
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "write", path: params.path, allowed: false, message } });
        return blockedResult(message);
      }
    },
  });

  definitions.push({
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
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "edit", path: params.path, allowed: false, message } });
        return blockedResult(message);
      }
    },
  });

  definitions.push({
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
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "grep", path: params.path, allowed: false, message } });
        return blockedResult(message);
      }
    },
  });

  definitions.push({
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
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "find", path: params.path, allowed: false, message } });
        return blockedResult(message);
      }
    },
  });

  definitions.push({
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
        onAudit({ type: "tool_call", userSlug: user.slug, data: { toolName: "ls", path: params.path, allowed: false, message } });
        return blockedResult(message);
      }
    },
  });

  const definitionsByName = new Map(definitions.map((definition) => [definition.name as ToolName, definition]));
  return agent.capabilities.tools.map((toolName) => definitionsByName.get(toolName)!).filter(Boolean);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/path-policy.test.ts tests/guarded-tools.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/familyos/src/pi/path-policy.ts services/familyos/src/pi/guarded-tools.ts services/familyos/tests/path-policy.test.ts services/familyos/tests/guarded-tools.test.ts
git commit -m "feat(familyos): add guarded tool security boundary"
```

---
