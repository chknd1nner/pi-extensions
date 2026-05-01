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
      // Source-verified note: SettingsManager.create(cwd, agentDir) already merges
      // shared + project settings; FamilyOS should not manually merge settings files.
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
        // Source-verified note: do NOT use noTools: "all" here; it also removes the
        // allowlist namespace needed for same-name custom tools. Keep allowlist + overlays.
        tools: agent.capabilities.tools,
        customTools: guardedTools,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
}
