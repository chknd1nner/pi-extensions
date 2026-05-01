---
task_number: 6
title: Implement deterministic prompt composition, one-shot handoff state, and the runtime factory
status: Ready for implementation
lane: ready
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are implementing Task 6 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket:
  - Ticket: in-progress/ready/task-06-prompt-composition-handoff-state-and-runtime-factory.md
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
  You are reviewing Task 6 from the FamilyOS Telegram MVP implementation plan.

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

# Task 06 — Implement deterministic prompt composition, one-shot handoff state, and the runtime factory

## Plan excerpt


**Files:**
- Create: `services/familyos/src/pi/handoff.ts`
- Create: `services/familyos/src/pi/prompt-composer.ts`
- Create: `services/familyos/src/pi/session-paths.ts`
- Create: `services/familyos/src/pi/familyos-extension.ts`
- Create: `services/familyos/src/pi/runtime-factory.ts`
- Create: `services/familyos/tests/handoff.test.ts`
- Create: `services/familyos/tests/runtime-factory.test.ts`

- [ ] **Step 1: Write the failing handoff and runtime-factory tests**

Create `services/familyos/tests/handoff.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { HANDOFF_PROMPT, OneShotHandoff, injectHandoffIntoProviderPayload } from "../src/pi/handoff";

describe("OneShotHandoff", () => {
  it("arms once and clears after consume", () => {
    const handoff = new OneShotHandoff();
    handoff.arm(HANDOFF_PROMPT);

    expect(handoff.peek()).toContain("different assistant");
    expect(handoff.consume()).toContain("different assistant");
    expect(handoff.consume()).toBeUndefined();
  });
});

describe("injectHandoffIntoProviderPayload", () => {
  it("appends one uncached text item and preserves the cached prefix bytes", () => {
    const payload = {
      system: [
        { type: "text", text: "persona", cache_control: { type: "ephemeral" } },
        { type: "text", text: "tool-guidelines" },
      ],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };

    const beforePrefix = JSON.stringify(payload.system);
    const result = injectHandoffIntoProviderPayload(payload, "handoff");

    expect(result.injected).toBe(true);
    expect(JSON.stringify((result.payload as any).system.slice(0, -1))).toBe(beforePrefix);
    expect((result.payload as any).system.at(-1)).toEqual({ type: "text", text: "handoff" });
    expect((result.payload as any).messages).toEqual(payload.messages);
  });

  it("leaves unsupported payload shapes untouched instead of mutating messages", () => {
    const payload = { system: "plain string", messages: [{ role: "user", content: "hello" }] };
    const result = injectHandoffIntoProviderPayload(payload, "handoff");

    expect(result.injected).toBe(false);
    expect(result.payload).toEqual(payload);
  });
});
```

Create `services/familyos/tests/runtime-factory.test.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  createAgentSessionRuntime,
} from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createAuditLog } from "../src/audit-log";
import { AgentLoader } from "../src/config/agent-loader";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { HANDOFF_PROMPT, OneShotHandoff } from "../src/pi/handoff";
import { createInitialSessionManager, createUserRuntimeFactory } from "../src/pi/runtime-factory";
import { getSharedSessionDir } from "../src/pi/session-paths";
import { createTempRoot } from "./helpers/temp-root";

async function createRuntimeFixture() {
  const temp = await createTempRoot();
  const rootConfig = {
    defaultAgentId: "default",
    sharedPiAgentDir: ".familyos-pi",
    telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
  };
  const paths = buildFamilyOSPaths(temp.rootDir, rootConfig);

  await fs.mkdir(path.join(paths.agentsDir, "default"), { recursive: true });
  await fs.writeFile(path.join(paths.agentsDir, "default", "SOUL.md"), "You are FamilyOS.");
  await fs.writeFile(
    path.join(paths.agentsDir, "default", "agent.json"),
    JSON.stringify(
      {
        id: "default",
        displayName: "FamilyOS Assistant",
        capabilities: {
          tools: ["read", "ls"],
          readRoots: ["Inbox", "Workspace", "Exports"],
          writeRoots: ["Workspace", "Exports"],
        },
      },
      null,
      2,
    ),
  );

  const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });
  await fs.mkdir(path.dirname(user.manifestPath), { recursive: true });
  await fs.writeFile(
    user.manifestPath,
    JSON.stringify(
      {
        id: "martin",
        displayName: "Martin",
        channels: { telegram: { userIds: ["123"] } },
      },
      null,
      2,
    ),
  );
  await fs.mkdir(user.homeDir, { recursive: true });

  const authStorage = AuthStorage.create(path.join(paths.sharedPiAgentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(paths.sharedPiAgentDir, "models.json"));
  const agentLoader = new AgentLoader(paths, rootConfig);
  const audit = createAuditLog(paths.auditLogPath);
  const handoff = new OneShotHandoff();
  const onEvent = vi.fn();

  const runtime = await createAgentSessionRuntime(
    createUserRuntimeFactory({
      paths,
      rootConfig,
      user,
      agentLoader,
      authStorage,
      modelRegistry,
      handoff,
      audit,
      getActiveAgentId: () => "default",
      onEvent,
    }),
    {
      cwd: user.homeDir,
      agentDir: paths.sharedPiAgentDir,
      sessionManager: await createInitialSessionManager(paths, user, undefined),
    },
  );

  await runtime.session.bindExtensions({});

  return { temp, paths, user, audit, handoff, runtime, onEvent };
}

describe("createUserRuntimeFactory", () => {
  it("loads only approved same-name custom tools and builds a deterministic system prompt", async () => {
    const fixture = await createRuntimeFixture();

    try {
      const toolNames = fixture.runtime.session.getAllTools().map((tool) => tool.name);
      expect(toolNames).toEqual(["read", "ls"]);
      expect(toolNames).not.toContain("bash");

      const systemPrompt = fixture.runtime.session.extensionRunner.createContext().getSystemPrompt();
      expect(systemPrompt).toContain("You are FamilyOS.");
      expect(systemPrompt).toContain("Read files inside Inbox, Workspace, or Exports.");
      expect(systemPrompt).toContain("Use ls only inside readable workspace roots.");

      expect(fixture.runtime.session.sessionFile?.startsWith(getSharedSessionDir(fixture.user.homeDir, fixture.paths.sharedPiAgentDir))).toBe(true);
    } finally {
      await fixture.audit.close();
      await fixture.temp.cleanup();
    }
  });

  it("rebinds extensions after newSession so handoff and audit hooks still execute", async () => {
    const fixture = await createRuntimeFixture();

    try {
      fixture.runtime.setRebindSession(async (session) => {
        await session.bindExtensions({});
      });

      const payload = {
        system: [{ type: "text", text: "persona", cache_control: { type: "ephemeral" } }],
        messages: [],
      };

      fixture.handoff.arm(HANDOFF_PROMPT);
      const firstPayload = await fixture.runtime.session.extensionRunner.emitBeforeProviderRequest(payload);
      expect((firstPayload as any).system.at(-1)).toEqual({ type: "text", text: HANDOFF_PROMPT });
      await fixture.runtime.session.extensionRunner.emit({ type: "agent_start" });
      expect(fixture.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_start", userSlug: "martin" }));

      const firstSessionFile = fixture.runtime.session.sessionFile;
      await fixture.runtime.newSession();
      expect(fixture.runtime.session.sessionFile).not.toBe(firstSessionFile);

      fixture.handoff.arm(HANDOFF_PROMPT);
      const secondPayload = await fixture.runtime.session.extensionRunner.emitBeforeProviderRequest(payload);
      expect((secondPayload as any).system.at(-1)).toEqual({ type: "text", text: HANDOFF_PROMPT });
      await fixture.runtime.session.extensionRunner.emit({ type: "agent_start" });
      expect(fixture.onEvent).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.audit.close();
      await fixture.temp.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/handoff.test.ts tests/runtime-factory.test.ts`
Expected: FAIL because `handoff.ts`, `prompt-composer.ts`, `session-paths.ts`, `familyos-extension.ts`, and `runtime-factory.ts` do not exist yet

- [ ] **Step 3: Implement one-shot handoff storage and provider-payload rewriting**

Create `services/familyos/src/pi/handoff.ts`:

```typescript
export const HANDOFF_PROMPT = `You are taking over an in-progress conversation from a different assistant
persona. The messages above this point in the conversation were authored by
that previous assistant, not by you.

Treat the prior turns as transcript context: read them to understand what the
user has been working on and what they want next. Do not adopt the previous
assistant's voice, commitments, stylistic choices, or stated intentions as
your own — those belong to a different persona with a different role.

Continue the conversation as yourself, in your own voice and within your own
capabilities, from this turn forward. If the previous assistant made promises
or decisions that conflict with your role, raise that openly with the user
rather than silently continuing along the prior path.`;

export class OneShotHandoff {
  private text: string | undefined;

  arm(text: string) {
    this.text = text;
  }

  peek() {
    return this.text;
  }

  consume() {
    const current = this.text;
    this.text = undefined;
    return current;
  }
}

export function injectHandoffIntoProviderPayload(payload: unknown, handoff: string) {
  if (!payload || typeof payload !== "object") {
    return { payload, injected: false };
  }

  const value = structuredClone(payload as Record<string, unknown>);
  if (!Array.isArray(value.system)) {
    return { payload: value, injected: false };
  }

  return {
    injected: true,
    payload: {
      ...value,
      system: [...value.system, { type: "text", text: handoff }],
    },
  };
}
```

- [ ] **Step 4: Implement deterministic prompt composition and shared session-dir helpers**

Create `services/familyos/src/pi/prompt-composer.ts`:

```typescript
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

function dedupe(lines: string[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function composeGuidelines(activeTools: Array<Pick<ToolDefinition, "name" | "promptSnippet" | "promptGuidelines">>) {
  const snippetLines = activeTools
    .filter((tool) => typeof tool.promptSnippet === "string" && tool.promptSnippet.trim().length > 0)
    .map((tool) => `- ${tool.name}: ${tool.promptSnippet!.trim()}`);

  const guidelineLines = dedupe(
    activeTools.flatMap((tool) => (tool.promptGuidelines ?? []).map((line) => line.trim())),
  );

  const sections: string[] = [];
  if (snippetLines.length > 0) {
    sections.push(["## Available tools", ...snippetLines].join("\n"));
  }
  if (guidelineLines.length > 0) {
    sections.push(["## Guidelines", ...guidelineLines.map((line) => `- ${line}`)].join("\n"));
  }

  return sections.join("\n\n");
}

export function composeSystemPrompt(
  soul: string,
  activeTools: Array<Pick<ToolDefinition, "name" | "promptSnippet" | "promptGuidelines">>,
) {
  const guidelineBlock = composeGuidelines(activeTools);
  return guidelineBlock ? `${soul.trim()}\n\n${guidelineBlock}` : soul.trim();
}
```

Create `services/familyos/src/pi/session-paths.ts`:

```typescript
import path from "node:path";

export function encodeSessionCwd(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function getSharedSessionDir(cwd: string, agentDir: string) {
  return path.join(agentDir, "sessions", encodeSessionCwd(cwd));
}
```

- [ ] **Step 5: Implement the FamilyOS extension factory**

Create `services/familyos/src/pi/familyos-extension.ts`:

```typescript
import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import type { ResolvedUser } from "../types.js";
import { injectHandoffIntoProviderPayload, OneShotHandoff } from "./handoff.js";

export interface FamilyOSExtensionOptions {
  user: ResolvedUser;
  handoff: OneShotHandoff;
  audit: AuditLog;
  onEvent?: (event: { type: string; userSlug: string; data?: Record<string, unknown> }) => void;
}

export function createFamilyOSExtension(options: FamilyOSExtensionOptions): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    // Source-verified against the installed SDK: BeforeProviderRequestEvent carries
    // the provider payload on event.payload.
    pi.on("before_provider_request", (event) => {
      const handoff = options.handoff.peek();
      if (!handoff) return undefined;

      const result = injectHandoffIntoProviderPayload(event.payload, handoff);
      if (!result.injected) {
        options.audit.append({
          type: "handoff_payload_unsupported",
          userSlug: options.user.slug,
          data: { hasSystemArray: Array.isArray((event.payload as any)?.system) },
        });
        return undefined;
      }

      options.handoff.consume();
      return result.payload;
    });

    pi.on("agent_start", () => {
      options.onEvent?.({ type: "agent_start", userSlug: options.user.slug });
    });

    pi.on("agent_end", () => {
      options.onEvent?.({ type: "agent_end", userSlug: options.user.slug });
    });

    pi.on("session_compact", () => {
      options.onEvent?.({ type: "session_compact", userSlug: options.user.slug });
    });
  };
}
```

- [ ] **Step 6: Implement the runtime factory with selective same-name custom tools**

Create `services/familyos/src/pi/runtime-factory.ts`:

```typescript
import fs from "node:fs/promises";
import {
  type AuthStorage,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import { AgentLoader } from "../config/agent-loader.js";
import type { FamilyOSPaths, FamilyOSRootConfig, ResolvedUser } from "../types.js";
import { createFamilyOSExtension } from "./familyos-extension.js";
import { buildGuardedToolDefinitions } from "./guarded-tools.js";
import { OneShotHandoff } from "./handoff.js";
import { composeSystemPrompt } from "./prompt-composer.js";
import { getSharedSessionDir } from "./session-paths.js";

export async function createInitialSessionManager(
  paths: FamilyOSPaths,
  user: ResolvedUser,
  activeSessionPath: string | undefined,
) {
  const sessionDir = getSharedSessionDir(user.homeDir, paths.sharedPiAgentDir);
  if (activeSessionPath) {
    try {
      await fs.access(activeSessionPath);
      return SessionManager.open(activeSessionPath, sessionDir);
    } catch {
      return SessionManager.continueRecent(user.homeDir, sessionDir);
    }
  }
  return SessionManager.continueRecent(user.homeDir, sessionDir);
}

export function createUserRuntimeFactory(options: {
  paths: FamilyOSPaths;
  rootConfig: FamilyOSRootConfig;
  user: ResolvedUser;
  agentLoader: AgentLoader;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  handoff: OneShotHandoff;
  audit: AuditLog;
  getActiveAgentId: () => string;
  onEvent?: (event: { type: string; userSlug: string; data?: Record<string, unknown> }) => void;
}): CreateAgentSessionRuntimeFactory {
  return async ({ cwd, sessionManager, sessionStartEvent }) => {
    const agent = await options.agentLoader.loadAgent(options.getActiveAgentId(), options.user);
    const guardedTools = buildGuardedToolDefinitions(options.user, agent, (event) => {
      options.audit.append(event);
    });

    const services = await createAgentSessionServices({
      cwd,
      agentDir: options.paths.sharedPiAgentDir,
      authStorage: options.authStorage,
      modelRegistry: options.modelRegistry,
      settingsManager: SettingsManager.create(cwd, options.paths.sharedPiAgentDir),
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [
          createFamilyOSExtension({
            user: options.user,
            handoff: options.handoff,
            audit: options.audit,
            onEvent: options.onEvent,
          }),
        ],
        systemPromptOverride: () => composeSystemPrompt(agent.soul, guardedTools),
      },
    });

    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        tools: agent.capabilities.tools,
        customTools: guardedTools,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
}
```

Keep two source-verified notes with this step:
- Do **not** use `noTools: "all"` here. On the installed SDK that would also zero out the allowlist for same-name custom tools. FamilyOS instead passes `tools: agent.capabilities.tools` and overlays those names with `customTools`.
- Do **not** manually merge shared Pi settings with `home/.pi/settings.json`. `SettingsManager.create(cwd, agentDir)` already performs the global + project merge that the spec requires.

- [ ] **Step 7: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/handoff.test.ts tests/runtime-factory.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add services/familyos/src/pi/handoff.ts services/familyos/src/pi/prompt-composer.ts services/familyos/src/pi/session-paths.ts services/familyos/src/pi/familyos-extension.ts services/familyos/src/pi/runtime-factory.ts services/familyos/tests/handoff.test.ts services/familyos/tests/runtime-factory.test.ts
git commit -m "feat(familyos): add runtime factory and deterministic handoff flow"
```

---
