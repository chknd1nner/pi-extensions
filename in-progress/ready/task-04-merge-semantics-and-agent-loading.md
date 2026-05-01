---
task_number: 4
title: Implement merge semantics and filesystem-defined agent loading
status: Ready for implementation
lane: ready
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are implementing Task 4 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket:
  - Ticket: in-progress/ready/task-04-merge-semantics-and-agent-loading.md
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
  You are reviewing Task 4 from the FamilyOS Telegram MVP implementation plan.

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

# Task 04 — Implement merge semantics and filesystem-defined agent loading

## Plan excerpt


**Files:**
- Create: `services/familyos/src/config/merge.ts`
- Create: `services/familyos/src/config/agent-loader.ts`
- Create: `services/familyos/tests/merge.test.ts`
- Create: `services/familyos/tests/agent-loader.test.ts`

- [ ] **Step 1: Write the failing config-merge and agent-loader tests**

Create `services/familyos/tests/merge.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deepMerge } from "../src/config/merge";

describe("deepMerge", () => {
  it("recursively merges nested objects while replacing arrays", () => {
    const merged = deepMerge(
      {
        compaction: { enabled: true, reserveTokens: 16000 },
        extensions: ["root-extension"],
      },
      {
        compaction: { reserveTokens: 8000 },
        extensions: ["user-extension"],
      },
    );

    expect(merged).toEqual({
      compaction: { enabled: true, reserveTokens: 8000 },
      extensions: ["user-extension"],
    });
  });
});
```

Create `services/familyos/tests/agent-loader.test.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { AgentLoader } from "../src/config/agent-loader";
import { createTempRoot } from "./helpers/temp-root";

describe("AgentLoader", () => {
  it("loads the shipped default agent", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    const loader = new AgentLoader(paths, { defaultAgentId: "default", sharedPiAgentDir: ".familyos-pi", telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 } });
    const agent = await loader.loadDefaultAgent();

    expect(agent.id).toBe("default");
    expect(agent.capabilities.tools).toEqual(["read", "grep", "find", "ls"]);
    await temp.cleanup();
  });

  it("lets a user-local agent replace a root agent with the same name", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });
    await fs.mkdir(path.join(path.dirname(user.familySettingsPath), "agents", "default"), { recursive: true });
    await fs.writeFile(
      path.join(path.dirname(user.familySettingsPath), "agents", "default", "agent.json"),
      JSON.stringify(
        {
          id: "default",
          displayName: "Martin Default",
          capabilities: {
            tools: [],
            readRoots: [],
            writeRoots: [],
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(path.join(path.dirname(user.familySettingsPath), "agents", "default", "SOUL.md"), "You are Martin's chat-only assistant.");

    const loader = new AgentLoader(paths, { defaultAgentId: "default", sharedPiAgentDir: ".familyos-pi", telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 } });
    const agent = await loader.loadAgent("default", user);

    expect(agent.displayName).toBe("Martin Default");
    expect(agent.capabilities.tools).toEqual([]);
    await temp.cleanup();
  });

  it("rejects unknown tool names and bash", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.agentsDir, "broken"), { recursive: true });
    await fs.writeFile(path.join(paths.agentsDir, "broken", "SOUL.md"), "Broken");
    await fs.writeFile(
      path.join(paths.agentsDir, "broken", "agent.json"),
      JSON.stringify(
        {
          id: "broken",
          displayName: "Broken",
          capabilities: {
            tools: ["bash", "explode"],
            readRoots: ["Workspace"],
            writeRoots: ["Workspace"],
          },
        },
        null,
        2,
      ),
    );

    const loader = new AgentLoader(paths, { defaultAgentId: "default", sharedPiAgentDir: ".familyos-pi", telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 } });

    await expect(loader.loadAgent("broken")).rejects.toThrow(/Unknown tool name|bash is not allowed/i);
    await temp.cleanup();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/merge.test.ts tests/agent-loader.test.ts`
Expected: FAIL because `merge.ts` and `agent-loader.ts` do not exist yet

- [ ] **Step 3: Implement recursive merge semantics**

Create `services/familyos/src/config/merge.ts`:

```typescript
export function deepMerge<T>(base: T, overrides: Partial<T>): T {
  if (Array.isArray(base) || Array.isArray(overrides)) {
    return structuredClone((overrides ?? base) as T);
  }

  if (
    base &&
    overrides &&
    typeof base === "object" &&
    typeof overrides === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(overrides)
  ) {
    const result: Record<string, unknown> = {
      ...(structuredClone(base as Record<string, unknown>) ?? {}),
    };

    for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
      if (value === undefined) continue;

      const current = result[key];
      if (
        current &&
        value &&
        typeof current === "object" &&
        typeof value === "object" &&
        !Array.isArray(current) &&
        !Array.isArray(value)
      ) {
        result[key] = deepMerge(
          current as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        result[key] = structuredClone(value);
      }
    }

    return result as T;
  }

  return structuredClone((overrides ?? base) as T);
}
```

- [ ] **Step 4: Implement agent discovery, replacement-by-name, and validation**

Create `services/familyos/src/config/agent-loader.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { FamilyOSPaths, FamilyOSRootConfig, ResolvedAgent, ResolvedUser, ToolName, AgentManifest } from "../types.js";

const ALLOWED_TOOLS = new Set<ToolName>(["read", "write", "edit", "grep", "find", "ls"]);

async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function loadBundle(bundleDir: string): Promise<ResolvedAgent> {
  const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, "agent.json"), "utf8")) as AgentManifest;
  const soul = await fs.readFile(path.join(bundleDir, "SOUL.md"), "utf8");

  for (const tool of manifest.capabilities.tools) {
    if (tool === "bash") {
      throw new Error(`Agent "${manifest.id}" is invalid: bash is not allowed in MVP.`);
    }
    if (!ALLOWED_TOOLS.has(tool)) {
      throw new Error(`Agent "${manifest.id}" is invalid: Unknown tool name "${tool}".`);
    }
  }

  for (const relativePath of [...manifest.capabilities.readRoots, ...manifest.capabilities.writeRoots]) {
    if (relativePath.startsWith("/") || relativePath.includes("..")) {
      throw new Error(`Agent "${manifest.id}" is invalid: root paths must be relative to the user's home.`);
    }
  }

  return {
    id: manifest.id,
    displayName: manifest.displayName,
    soul,
    sourceDir: bundleDir,
    capabilities: manifest.capabilities,
  };
}

export class AgentLoader {
  constructor(
    private readonly paths: FamilyOSPaths,
    private readonly rootConfig: FamilyOSRootConfig,
  ) {}

  private userAgentDir(user?: ResolvedUser) {
    return user ? path.join(path.dirname(user.familySettingsPath), "agents") : undefined;
  }

  async listAgents(user?: ResolvedUser): Promise<ResolvedAgent[]> {
    const rootIds = await readDirNames(this.paths.agentsDir);
    const userIds = user ? await readDirNames(this.userAgentDir(user)!) : [];

    const ids = new Set<string>([...rootIds, ...userIds]);
    return Promise.all([...ids].sort().map((id) => this.loadAgent(id, user)));
  }

  async loadAgent(agentId: string, user?: ResolvedUser): Promise<ResolvedAgent> {
    const userDir = user ? path.join(this.userAgentDir(user)!, agentId) : undefined;
    const rootDir = path.join(this.paths.agentsDir, agentId);

    if (userDir) {
      try {
        await fs.access(userDir);
        return loadBundle(userDir);
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    return loadBundle(rootDir);
  }

  async loadDefaultAgent(user?: ResolvedUser): Promise<ResolvedAgent> {
    return this.loadAgent(this.rootConfig.defaultAgentId, user);
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/merge.test.ts tests/agent-loader.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/familyos/src/config/merge.ts services/familyos/src/config/agent-loader.ts services/familyos/tests/merge.test.ts services/familyos/tests/agent-loader.test.ts
git commit -m "feat(familyos): add config merge and agent loading"
```

---
