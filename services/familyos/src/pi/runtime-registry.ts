import {
  type AgentSessionRuntime,
  type AuthStorage,
  createAgentSessionRuntime,
  generateBranchSummary,
  type ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import { AgentLoader } from "../config/agent-loader.js";
import { StateStore } from "../identity/state-store.js";
import { UserStore } from "../identity/user-store.js";
import type {
  AgentSwitchChoice,
  FamilyOSPaths,
  FamilyOSRootConfig,
  ModelSwitchChoice,
  ResolvedUser,
  TurnInput,
  UserState,
} from "../types.js";
import { HANDOFF_PROMPT, OneShotHandoff } from "./handoff.js";
import { promptAndCollectReply } from "./prompt-runner.js";
import { createInitialSessionManager, createUserRuntimeFactory } from "./runtime-factory.js";

interface UserRuntimeHandle {
  user: ResolvedUser;
  runtime: AgentSessionRuntime;
  /** Mutable ref shared with the runtime factory closure — mutate `.current` to change agent. */
  agentIdRef: { current: string };
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

  constructor(
    private readonly deps: {
      paths: FamilyOSPaths;
      rootConfig: FamilyOSRootConfig;
      userStore: UserStore;
      stateStore: StateStore;
      agentLoader: AgentLoader;
      authStorage: AuthStorage;
      modelRegistry: ModelRegistry;
      audit: AuditLog;
    },
  ) {}

  private async persist(handle: UserRuntimeHandle) {
    const nextState: UserState = {
      activeAgentId: handle.agentIdRef.current,
      activeSessionPath: handle.activeSessionPath,
    };
    await this.deps.stateStore.write(handle.user, nextState);
  }

  async ensureRuntime(user: ResolvedUser) {
    const cached = this.handles.get(user.slug);
    if (cached) return cached.runtime;

    await this.deps.userStore.ensureHome(user);
    const persisted = await this.deps.stateStore.read(user, this.deps.rootConfig.defaultAgentId);

    // Bug fix: validate the persisted agent exists; fall back to the configured default if missing.
    let resolvedAgentId = persisted.activeAgentId;
    try {
      await this.deps.agentLoader.loadAgent(resolvedAgentId, user);
    } catch {
      resolvedAgentId = this.deps.rootConfig.defaultAgentId;
    }

    // Bug fix: use a mutable ref so switchAgent() mutations are visible to the factory closure.
    const agentIdRef = { current: resolvedAgentId };
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
        getActiveAgentId: () => agentIdRef.current,
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
      agentIdRef,
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
    handle.queue = next.then(
      () => undefined,
      () => undefined,
    );

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

      await handle.runtime.newSession();
      await handle.runtime.session.setModel(model);
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
      const previousAgentId = handle.agentIdRef.current;
      const previousSessionPath = handle.activeSessionPath;

      if (choice === "continue_session") {
        handle.agentIdRef.current = targetAgentId;
        handle.handoff.arm(HANDOFF_PROMPT);
        try {
          await handle.runtime.switchSession(handle.runtime.session.sessionFile!);
          handle.activeSessionPath = handle.runtime.session.sessionFile;
          await this.persist(handle);
        } catch (error) {
          handle.agentIdRef.current = previousAgentId;
          handle.handoff.consume();
          throw error;
        }
        return;
      }

      if (choice === "start_fresh") {
        handle.agentIdRef.current = targetAgentId;
        try {
          await handle.runtime.newSession();
          handle.activeSessionPath = handle.runtime.session.sessionFile;
          await this.persist(handle);
        } catch (error) {
          handle.agentIdRef.current = previousAgentId;
          throw error;
        }
        return;
      }

      const summary = await this.buildCarryForwardSummary(handle);
      handle.agentIdRef.current = targetAgentId;
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
        handle.agentIdRef.current = previousAgentId;
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
