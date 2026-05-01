---
task_number: 8
title: Implement prompt execution, per-user runtime management, and the channel-agnostic FamilyOS service
status: Done
lane: done
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are reviewing Task 8 from the FamilyOS Telegram MVP implementation plan.

  The task was previously returned for fixes. Both findings have been addressed:
  1. `activeAgentId` local variable replaced with a mutable `agentIdRef: { current: string }` shared between the factory closure and the handle, so agent switches take effect on runtime rebuild.
  2. `ensureRuntime()` now validates the persisted agent ID and falls back to `rootConfig.defaultAgentId` if the bundle is missing.
  Regression tests were added for both fixes in `tests/runtime-registry.test.ts`.

  Start from this ticket and the current git diff.
  Review only the scope in this ticket's plan excerpt.
  If the task passes review:
  - move this ticket to in-progress/done/
  - set status to Done
  - set lane to done
  - add a short approval note

  If the task still needs changes:
  - move this ticket to in-progress/needs-fix/
  - set status to Needs fix
  - set lane to needs-fix
  - replace next_prompt with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
review_prompt_template: |-
  You are reviewing Task 8 from the FamilyOS Telegram MVP implementation plan.

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

# Task 08 — Implement prompt execution, per-user runtime management, and the channel-agnostic FamilyOS service

## Plan excerpt


**Files:**
- Create: `services/familyos/src/pi/prompt-runner.ts`
- Create: `services/familyos/src/pi/runtime-registry.ts`
- Create: `services/familyos/src/core/familyos-service.ts`
- Create: `services/familyos/tests/runtime-registry.test.ts`
- Create: `services/familyos/tests/integration/runtime-isolation.test.ts`

- [x] **Step 1: Write the failing runtime-registry and service integration tests**

Create `services/familyos/tests/runtime-registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractCarryForwardSummary, isRuntimeHandleIdle } from "../src/pi/runtime-registry";

describe("isRuntimeHandleIdle", () => {
  it("requires both an empty queue and a non-streaming session", () => {
    expect(isRuntimeHandleIdle(undefined as any)).toBe(true);
    expect(isRuntimeHandleIdle({ pendingOperations: 1, runtime: { session: { isStreaming: false } } } as any)).toBe(false);
    expect(isRuntimeHandleIdle({ pendingOperations: 0, runtime: { session: { isStreaming: true } } } as any)).toBe(false);
    expect(isRuntimeHandleIdle({ pendingOperations: 0, runtime: { session: { isStreaming: false } } } as any)).toBe(true);
  });
});

describe("extractCarryForwardSummary", () => {
  it("throws the summarizer error when Pi cannot produce a branch summary", () => {
    expect(() => extractCarryForwardSummary({ error: "summary failed" } as any)).toThrow("summary failed");
  });

  it("throws when Pi returns no summary text", () => {
    expect(() => extractCarryForwardSummary({ summary: "" } as any)).toThrow(
      "Could not generate a carry-forward summary.",
    );
  });
});
```

Create `services/familyos/tests/integration/runtime-isolation.test.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/audit-log";
import { AgentLoader } from "../../src/config/agent-loader";
import { FamilyOSService } from "../../src/core/familyos-service";
import { StateStore } from "../../src/identity/state-store";
import { UserStore } from "../../src/identity/user-store";
import { buildFamilyOSPaths } from "../../src/paths";
import { UserRuntimeRegistry } from "../../src/pi/runtime-registry";
import { getSharedSessionDir } from "../../src/pi/session-paths";
import { createTempRoot } from "../helpers/temp-root";

describe("FamilyOS runtime isolation", () => {
  it("creates separate runtimes per user with user-scoped cwd, state, and shared-agent-dir session storage", async () => {
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
            tools: ["read"],
            readRoots: ["Inbox", "Workspace", "Exports"],
            writeRoots: ["Workspace", "Exports"],
          },
        },
        null,
        2,
      ),
    );

    for (const [slug, telegramId] of [
      ["martin", "101"],
      ["alice", "202"],
    ]) {
      await fs.mkdir(path.join(paths.usersDir, slug), { recursive: true });
      await fs.writeFile(
        path.join(paths.usersDir, slug, "user.json"),
        JSON.stringify(
          {
            id: slug,
            displayName: slug,
            channels: { telegram: { userIds: [telegramId] } },
          },
          null,
          2,
        ),
      );
    }

    const userStore = new UserStore(paths);
    const stateStore = new StateStore();
    const agentLoader = new AgentLoader(paths, rootConfig);
    const authStorage = AuthStorage.create(path.join(paths.sharedPiAgentDir, "auth.json"));
    const modelRegistry = ModelRegistry.create(authStorage, path.join(paths.sharedPiAgentDir, "models.json"));
    const audit = createAuditLog(paths.auditLogPath);

    const runtimeRegistry = new UserRuntimeRegistry({
      paths,
      rootConfig,
      userStore,
      stateStore,
      agentLoader,
      authStorage,
      modelRegistry,
      audit,
    });

    const service = new FamilyOSService({
      paths,
      rootConfig,
      userStore,
      stateStore,
      agentLoader,
      runtimeRegistry,
      modelRegistry,
      audit,
    });

    try {
      const martin = await service.resolveRegisteredUser({ channel: "telegram", externalUserId: "101", chatId: "101" });
      const alice = await service.resolveRegisteredUser({ channel: "telegram", externalUserId: "202", chatId: "202" });

      if (!martin || !alice) throw new Error("Expected both users to resolve");

      const martinRuntime = await runtimeRegistry.ensureRuntime(martin);
      const aliceRuntime = await runtimeRegistry.ensureRuntime(alice);

      expect(martinRuntime.cwd).toBe(martin.homeDir);
      expect(aliceRuntime.cwd).toBe(alice.homeDir);
      expect(martinRuntime.cwd).not.toBe(aliceRuntime.cwd);
      expect(martinRuntime.session.sessionFile).not.toBe(aliceRuntime.session.sessionFile);
      expect(martinRuntime.session.sessionFile?.startsWith(getSharedSessionDir(martin.homeDir, paths.sharedPiAgentDir))).toBe(true);
      expect(aliceRuntime.session.sessionFile?.startsWith(getSharedSessionDir(alice.homeDir, paths.sharedPiAgentDir))).toBe(true);
    } finally {
      await audit.close();
      await temp.cleanup();
    }
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/runtime-registry.test.ts tests/integration/runtime-isolation.test.ts`
Expected: FAIL because `prompt-runner.ts`, `runtime-registry.ts`, and `familyos-service.ts` do not exist yet

- [x] **Step 3: Implement prompt execution and assistant-text collection**

Create `services/familyos/src/pi/prompt-runner.ts`:

```typescript
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { TurnInput } from "../types.js";

export function buildPromptText(input: TurnInput): string {
  const fileLines = input.attachments.map((attachment) => `- ${attachment.relativePath}`);
  if (fileLines.length === 0) return input.text;

  return `${input.text}\n\nUploaded files saved in your workspace:\n${fileLines.join("\n")}`;
}

export async function promptAndCollectReply(session: AgentSession, input: TurnInput): Promise<string> {
  let assistantText = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      assistantText += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(buildPromptText(input), {
      images: input.attachments.flatMap((attachment) =>
        attachment.inlineImage ? [attachment.inlineImage] : [],
      ),
      ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {}),
    });

    return assistantText.trim();
  } finally {
    unsubscribe();
  }
}
```

- [x] **Step 4: Implement the per-user runtime registry with serialized operations**

Create `services/familyos/src/pi/runtime-registry.ts`:

```typescript
import {
  type AgentSessionRuntime,
  createAgentSessionRuntime,
  generateBranchSummary,
  type AuthStorage,
  type ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import { AgentLoader } from "../config/agent-loader.js";
import type {
  AgentSwitchChoice,
  FamilyOSPaths,
  FamilyOSRootConfig,
  ModelSwitchChoice,
  ResolvedUser,
  TurnInput,
  UserState,
} from "../types.js";
import { StateStore } from "../identity/state-store.js";
import { UserStore } from "../identity/user-store.js";
import { HANDOFF_PROMPT, OneShotHandoff } from "./handoff.js";
import { promptAndCollectReply } from "./prompt-runner.js";
import { createInitialSessionManager, createUserRuntimeFactory } from "./runtime-factory.js";

interface UserRuntimeHandle {
  user: ResolvedUser;
  runtime: AgentSessionRuntime;
  activeAgentId: string;
  activeSessionPath?: string;
  handoff: OneShotHandoff;
  queue: Promise<unknown>;
  pendingOperations: number;
}

export function isRuntimeHandleIdle(handle?: Pick<UserRuntimeHandle, "pendingOperations" | "runtime">) {
  return !handle || (handle.pendingOperations === 0 && !handle.runtime.session.isStreaming);
}

export function extractCarryForwardSummary(result: { summary?: string; error?: string }) {
  if (result.error || !result.summary?.trim()) {
    throw new Error(result.error ?? "Could not generate a carry-forward summary.");
  }
  return result.summary;
}

export class UserRuntimeRegistry {
  private readonly handles = new Map<string, UserRuntimeHandle>();

  constructor(private readonly deps: {
    paths: FamilyOSPaths;
    rootConfig: FamilyOSRootConfig;
    userStore: UserStore;
    stateStore: StateStore;
    agentLoader: AgentLoader;
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
    audit: AuditLog;
  }) {}

  private async persist(handle: UserRuntimeHandle) {
    const nextState: UserState = {
      activeAgentId: handle.activeAgentId,
      activeSessionPath: handle.activeSessionPath,
    };
    await this.deps.stateStore.write(handle.user, nextState);
  }

  async ensureRuntime(user: ResolvedUser) {
    const cached = this.handles.get(user.slug);
    if (cached) return cached.runtime;

    await this.deps.userStore.ensureHome(user);
    const persisted = await this.deps.stateStore.read(user, this.deps.rootConfig.defaultAgentId);

    let activeAgentId = persisted.activeAgentId;
    const handoff = new OneShotHandoff();

    const runtime = await createAgentSessionRuntime(
      createUserRuntimeFactory({
        paths: this.deps.paths,
        rootConfig: this.deps.rootConfig,
        user,
        agentLoader: this.deps.agentLoader,
        authStorage: this.deps.authStorage,
        modelRegistry: this.deps.modelRegistry,
        handoff,
        audit: this.deps.audit,
        getActiveAgentId: () => activeAgentId,
      }),
      {
        cwd: user.homeDir,
        agentDir: this.deps.paths.sharedPiAgentDir,
        sessionManager: await createInitialSessionManager(this.deps.paths, user, persisted.activeSessionPath),
      },
    );

    await runtime.session.bindExtensions({});
    runtime.setRebindSession(async (session) => {
      await session.bindExtensions({});
    });

    const handle: UserRuntimeHandle = {
      user,
      runtime,
      activeAgentId,
      activeSessionPath: runtime.session.sessionFile,
      handoff,
      queue: Promise.resolve(),
      pendingOperations: 0,
    };

    this.handles.set(user.slug, handle);
    await this.persist(handle);
    return runtime;
  }

  private async withHandle<T>(user: ResolvedUser, operation: (handle: UserRuntimeHandle) => Promise<T>): Promise<T> {
    await this.ensureRuntime(user);
    const handle = this.handles.get(user.slug);
    if (!handle) throw new Error(`Missing runtime handle for ${user.slug}`);

    handle.pendingOperations += 1;
    const next = handle.queue.catch(() => undefined).then(() => operation(handle));
    handle.queue = next.then(() => undefined, () => undefined);

    try {
      return await next;
    } finally {
      handle.pendingOperations -= 1;
    }
  }

  async sendTurn(user: ResolvedUser, input: TurnInput) {
    return this.withHandle(user, async (handle) => {
      const replyText = await promptAndCollectReply(handle.runtime.session, input);
      handle.activeSessionPath = handle.runtime.session.sessionFile;
      await this.persist(handle);
      return { replyText };
    });
  }

  async newSession(user: ResolvedUser) {
    return this.withHandle(user, async (handle) => {
      await handle.runtime.newSession();
      handle.activeSessionPath = handle.runtime.session.sessionFile;
      await this.persist(handle);
    });
  }

  async resumeSession(user: ResolvedUser, sessionPath: string) {
    return this.withHandle(user, async (handle) => {
      await handle.runtime.switchSession(sessionPath);
      handle.activeSessionPath = handle.runtime.session.sessionFile;
      await this.persist(handle);
    });
  }

  async navigateTree(user: ResolvedUser, entryId: string, summarize: boolean) {
    return this.withHandle(user, async (handle) => {
      await handle.runtime.session.navigateTree(entryId, summarize ? { summarize: true } : undefined);
      handle.activeSessionPath = handle.runtime.session.sessionFile;
      await this.persist(handle);
    });
  }

  async compact(user: ResolvedUser, customInstructions?: string) {
    return this.withHandle(user, async (handle) => {
      return handle.runtime.session.compact(customInstructions);
    });
  }

  async switchModel(user: ResolvedUser, provider: string, modelId: string, choice: ModelSwitchChoice) {
    return this.withHandle(user, async (handle) => {
      const model = this.deps.modelRegistry.find(provider, modelId);
      if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

      if (choice === "switch_anyway") {
        await handle.runtime.session.setModel(model);
        return;
      }

      if (choice === "branch_compact_then_switch") {
        await handle.runtime.session.compact("Summarize the current work before the model changes.");
        await handle.runtime.session.setModel(model);
        return;
      }

      await handle.runtime.newSession({
        withSession: async (ctx) => {
          const ok = await ctx.setModel(model);
          if (!ok) throw new Error(`No auth configured for ${provider}/${modelId}`);
        },
      });
      handle.activeSessionPath = handle.runtime.session.sessionFile;
      await this.persist(handle);
    });
  }

  private async buildCarryForwardSummary(handle: UserRuntimeHandle) {
    const model = handle.runtime.session.model;
    if (!model) throw new Error("Cannot summarize without an active model.");

    const auth = await this.deps.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      throw new Error(auth.ok ? `No API key available for ${model.provider}/${model.id}` : auth.error);
    }

    const result = await generateBranchSummary(handle.runtime.session.sessionManager.getBranch(), {
      model,
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: new AbortController().signal,
      customInstructions:
        "Summarize the user's work so a different assistant persona can continue without copying the prior assistant's voice.",
    });

    return extractCarryForwardSummary(result);
  }

  async switchAgent(user: ResolvedUser, targetAgentId: string, choice: AgentSwitchChoice) {
    return this.withHandle(user, async (handle) => {
      const previousAgentId = handle.activeAgentId;
      const previousSessionPath = handle.activeSessionPath;

      if (choice === "continue_session") {
        handle.activeAgentId = targetAgentId;
        handle.handoff.arm(HANDOFF_PROMPT);
        try {
          await handle.runtime.switchSession(handle.runtime.session.sessionFile!);
          handle.activeSessionPath = handle.runtime.session.sessionFile;
          await this.persist(handle);
        } catch (error) {
          handle.activeAgentId = previousAgentId;
          handle.handoff.consume();
          throw error;
        }
        return;
      }

      if (choice === "start_fresh") {
        handle.activeAgentId = targetAgentId;
        try {
          await handle.runtime.newSession();
          handle.activeSessionPath = handle.runtime.session.sessionFile;
          await this.persist(handle);
        } catch (error) {
          handle.activeAgentId = previousAgentId;
          throw error;
        }
        return;
      }

      const summary = await this.buildCarryForwardSummary(handle);
      handle.activeAgentId = targetAgentId;
      try {
        await handle.runtime.newSession({
          parentSession: previousSessionPath,
          withSession: async (ctx) => {
            await ctx.sendMessage(
              {
                customType: "familyos-branch-summary",
                content: `Carry-forward summary from the previous session:\n\n${summary}`,
                display: false,
                details: { sourceSession: previousSessionPath },
              },
              { deliverAs: "nextTurn" },
            );
          },
        });
        handle.activeSessionPath = handle.runtime.session.sessionFile;
        await this.persist(handle);
      } catch (error) {
        handle.activeAgentId = previousAgentId;
        throw error;
      }
    });
  }

  isIdle(user: ResolvedUser) {
    return isRuntimeHandleIdle(this.handles.get(user.slug));
  }

  async cancel(user: ResolvedUser) {
    const handle = this.handles.get(user.slug);
    if (!handle || !handle.runtime.session.isStreaming) return false;
    await handle.runtime.session.abort();
    return true;
  }
}
```

Source-verified with the installed SDK before writing this step:
- `generateBranchSummary(entries, { model, apiKey, headers, signal, customInstructions })`
- `ctx.sendMessage({ customType, content, display, details }, { deliverAs: "nextTurn" })`

- [x] **Step 5: Implement the channel-agnostic FamilyOS service**

Create `services/familyos/src/core/familyos-service.ts`:

```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import { AgentLoader } from "../config/agent-loader.js";
import type {
  AgentSwitchChoice,
  ChannelIdentity,
  FamilyOSPaths,
  FamilyOSRootConfig,
  ModelSwitchChoice,
  ResolvedUser,
  TreeFilter,
  TurnInput,
} from "../types.js";
import { StateStore } from "../identity/state-store.js";
import { UserStore } from "../identity/user-store.js";
import { getSharedSessionDir } from "../pi/session-paths.js";
import { UserRuntimeRegistry } from "../pi/runtime-registry.js";
import { buildTreePage, formatSessionList } from "./session-view.js";

export class FamilyOSService {
  constructor(private readonly deps: {
    paths: FamilyOSPaths;
    rootConfig: FamilyOSRootConfig;
    userStore: UserStore;
    stateStore: StateStore;
    agentLoader: AgentLoader;
    runtimeRegistry: UserRuntimeRegistry;
    modelRegistry: ModelRegistry;
    audit: AuditLog;
  }) {}

  getOnboardingMessage() {
    return "You're not registered with FamilyOS yet. Use `/whoami` to get your Telegram ID, then send it to the admin.";
  }

  async describeCaller(identity: ChannelIdentity) {
    const resolved = await this.deps.userStore.resolveByChannel(identity);
    this.deps.audit.append({
      type: "channel_identity_resolution",
      telegramUserId: identity.externalUserId,
      userSlug: resolved?.slug,
    });
    return {
      telegramId: identity.externalUserId,
      slug: resolved?.slug,
    };
  }

  async resolveRegisteredUser(identity: ChannelIdentity): Promise<ResolvedUser | null> {
    const user = await this.deps.userStore.resolveByChannel(identity);
    this.deps.audit.append({
      type: user ? "channel_identity_resolution" : "unregistered_access",
      telegramUserId: identity.externalUserId,
      userSlug: user?.slug,
      data: { channel: identity.channel, chatId: identity.chatId },
    });
    return user;
  }

  async sendTurn(user: ResolvedUser, input: TurnInput) {
    this.deps.audit.append({
      type: "chat_turn",
      userSlug: user.slug,
      data: { attachmentCount: input.attachments.length },
    });
    return this.deps.runtimeRegistry.sendTurn(user, input);
  }

  async startNewSession(user: ResolvedUser) {
    this.deps.audit.append({ type: "session_new", userSlug: user.slug });
    return this.deps.runtimeRegistry.newSession(user);
  }

  async listSessions(user: ResolvedUser) {
    const sessionDir = getSharedSessionDir(user.homeDir, this.deps.paths.sharedPiAgentDir);
    const sessions = await SessionManager.list(user.homeDir, sessionDir);
    return formatSessionList(sessions);
  }

  async resumeSession(user: ResolvedUser, sessionPath: string) {
    this.deps.audit.append({ type: "session_resume", userSlug: user.slug, sessionFile: sessionPath });
    return this.deps.runtimeRegistry.resumeSession(user, sessionPath);
  }

  async buildTreePage(user: ResolvedUser, filter: TreeFilter, page: number) {
    const runtime = await this.deps.runtimeRegistry.ensureRuntime(user);
    return buildTreePage(
      runtime.session.sessionManager.getEntries(),
      runtime.session.sessionManager.getLeafId(),
      filter,
      page,
      this.deps.rootConfig.telegram.pageSize,
      (entryId) => runtime.session.sessionManager.getLabel(entryId),
    );
  }

  async restoreTreeEntry(user: ResolvedUser, entryId: string) {
    this.deps.audit.append({ type: "session_tree_restore", userSlug: user.slug, data: { entryId } });
    return this.deps.runtimeRegistry.navigateTree(user, entryId, false);
  }

  async branchTreeEntry(user: ResolvedUser, entryId: string) {
    this.deps.audit.append({ type: "session_tree_branch", userSlug: user.slug, data: { entryId } });
    return this.deps.runtimeRegistry.navigateTree(user, entryId, true);
  }

  async compact(user: ResolvedUser, customInstructions?: string) {
    this.deps.audit.append({ type: "manual_compaction", userSlug: user.slug, data: { custom: Boolean(customInstructions) } });
    return this.deps.runtimeRegistry.compact(user, customInstructions);
  }

  async listAvailableModels() {
    const models = await Promise.resolve(this.deps.modelRegistry.getAvailable());
    return models.map((model) => ({
      provider: model.provider,
      id: model.id,
      label: `${model.provider}/${model.id}`,
    }));
  }

  async switchModel(user: ResolvedUser, provider: string, modelId: string, choice: ModelSwitchChoice) {
    this.deps.audit.append({
      type: "model_switch",
      userSlug: user.slug,
      data: { provider, modelId, choice },
    });
    return this.deps.runtimeRegistry.switchModel(user, provider, modelId, choice);
  }

  async listAvailableAgents(user: ResolvedUser) {
    const agents = await this.deps.agentLoader.listAgents(user);
    return agents.map((agent) => ({
      id: agent.id,
      label: agent.displayName,
    }));
  }

  async switchAgent(user: ResolvedUser, agentId: string, choice: AgentSwitchChoice) {
    this.deps.audit.append({
      type: "agent_switch",
      userSlug: user.slug,
      data: { agentId, choice },
    });
    return this.deps.runtimeRegistry.switchAgent(user, agentId, choice);
  }

  isIdle(user: ResolvedUser) {
    return this.deps.runtimeRegistry.isIdle(user);
  }

  async cancel(user: ResolvedUser) {
    this.deps.audit.append({ type: "cancel_request", userSlug: user.slug });
    return this.deps.runtimeRegistry.cancel(user);
  }
}
```

- [x] **Step 6: Run the tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/runtime-registry.test.ts tests/integration/runtime-isolation.test.ts && npm run typecheck`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add services/familyos/src/pi/prompt-runner.ts services/familyos/src/pi/runtime-registry.ts services/familyos/src/core/familyos-service.ts services/familyos/tests/runtime-registry.test.ts services/familyos/tests/integration/runtime-isolation.test.ts
git commit -m "feat(familyos): add runtime registry and core service"
```

---

## Prior review findings

Needs fix. The ticket's verification command still passes (`cd services/familyos && npx vitest run tests/runtime-registry.test.ts tests/integration/runtime-isolation.test.ts && npm run typecheck`), but two blocking correctness issues remain in the Task 8 scope:

1. Agent switches do not actually take effect on runtime rebuild. `ensureRuntime()` captures a local `activeAgentId` and passes `getActiveAgentId: () => activeAgentId` into `createUserRuntimeFactory()` (`services/familyos/src/pi/runtime-registry.ts` and `services/familyos/src/pi/runtime-factory.ts`). Later `/agent` flows only mutate `handle.activeAgentId` inside `switchAgent()`, never the captured local. Pi's runtime API recreates cwd-bound services from that factory on `runtime.newSession()` / `runtime.switchSession()`, so the rebuilt runtime keeps loading the previous agent instead of the newly selected one.
2. Invalid persisted agent IDs do not fall back to the configured default. The design spec requires default fallback when `state.json` contains a missing or invalid `activeAgentId`, but `ensureRuntime()` assigns `persisted.activeAgentId` directly and the factory then calls `agentLoader.loadAgent(...)` without recovery. A stale or deleted agent bundle will therefore fail runtime creation instead of falling back to `rootConfig.defaultAgentId`.

## Review approval

Approved. Re-review confirmed both prior blocking issues are fixed in `e4a25b8`: the runtime factory now reads a shared `agentIdRef.current`, so `/agent` session rebuilds load the newly selected agent, and `ensureRuntime()` now falls back to `rootConfig.defaultAgentId` when persisted agent state points at a missing bundle. Fresh verification passed with `cd services/familyos && npx vitest run tests/runtime-registry.test.ts tests/integration/runtime-isolation.test.ts && npm run typecheck` (`7` tests passed, typecheck clean).

## Implementation notes

- RED evidence: `cd services/familyos && npx vitest run tests/runtime-registry.test.ts tests/integration/runtime-isolation.test.ts` failed first with missing modules (`runtime-registry` and `familyos-service`).
- GREEN evidence: `cd services/familyos && npx vitest run tests/runtime-registry.test.ts tests/integration/runtime-isolation.test.ts` now passes (4 tests).
- Verification evidence: `cd services/familyos && npx vitest run tests/runtime-registry.test.ts tests/integration/runtime-isolation.test.ts && npm run typecheck` passes.
- Follow-up concern: the plan excerpt used `ctx.setModel(...)` in `newSession({ withSession })`; the installed SDK typings do not expose `setModel` on `ReplacedSessionContext`, so `new_session` model switching is implemented as `await runtime.newSession(); await runtime.session.setModel(model);` with equivalent behavior.
