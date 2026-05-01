import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import { AgentLoader } from "../config/agent-loader.js";
import { StateStore } from "../identity/state-store.js";
import { UserStore } from "../identity/user-store.js";
import { UserRuntimeRegistry } from "../pi/runtime-registry.js";
import { getSharedSessionDir } from "../pi/session-paths.js";
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
import { buildTreePage, formatSessionList } from "./session-view.js";

export class FamilyOSService {
  constructor(
    private readonly deps: {
      paths: FamilyOSPaths;
      rootConfig: FamilyOSRootConfig;
      userStore: UserStore;
      stateStore: StateStore;
      agentLoader: AgentLoader;
      runtimeRegistry: UserRuntimeRegistry;
      modelRegistry: ModelRegistry;
      audit: AuditLog;
    },
  ) {}

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
