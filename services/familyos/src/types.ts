import type { ImageContent } from "@mariozechner/pi-ai";

export type ToolName = "read" | "write" | "edit" | "grep" | "find" | "ls";
export type TreeFilter = "default" | "no-tools" | "user-only" | "labeled-only" | "all";
export type ModelSwitchChoice = "switch_anyway" | "branch_compact_then_switch" | "new_session";
export type AgentSwitchChoice = "continue_session" | "start_fresh" | "branch_then_switch";

export interface FamilyOSRootConfig {
  defaultAgentId: string;
  sharedPiAgentDir: string;
  telegram: {
    flowTtlSeconds: number;
    typingIntervalMs: number;
    pageSize: number;
  };
}

export interface FamilyOSPaths {
  rootDir: string;
  agentsDir: string;
  configDir: string;
  usersDir: string;
  logsDir: string;
  auditLogPath: string;
  sharedPiAgentDir: string;
}

export interface UserManifest {
  id: string;
  displayName: string;
  channels: {
    telegram?: {
      userIds: string[];
    };
  };
}

export interface UserState {
  activeAgentId: string;
  activeSessionPath?: string;
}

export interface ResolvedUser {
  slug: string;
  displayName: string;
  manifestPath: string;
  statePath: string;
  homeDir: string;
  inboxDir: string;
  workspaceDir: string;
  exportsDir: string;
  familySettingsPath: string;
  piSettingsPath: string;
}

export interface AgentManifest {
  id: string;
  displayName: string;
  capabilities: {
    tools: ToolName[];
    readRoots: string[];
    writeRoots: string[];
  };
}

export interface ResolvedAgent {
  id: string;
  displayName: string;
  soul: string;
  sourceDir: string;
  capabilities: AgentManifest["capabilities"];
}

export interface ChannelIdentity {
  channel: "telegram";
  externalUserId: string;
  chatId: string;
}

export interface PendingAttachment {
  kind: "image" | "document";
  fileId: string;
  fileName: string;
  mimeType?: string;
}

export interface PersistedAttachment {
  kind: "image" | "document";
  absolutePath: string;
  relativePath: string;
  inlineImage?: ImageContent;
}

export interface TurnInput {
  text: string;
  attachments: PersistedAttachment[];
}

export interface TurnResult {
  replyText: string;
}

export interface SessionListItem {
  id: string;
  path: string;
  title: string;
  subtitle: string;
}

export interface TreePageEntry {
  index: number;
  entryId: string;
  line: string;
}

export interface TreePage {
  filter: TreeFilter;
  page: number;
  totalPages: number;
  text: string;
  entries: TreePageEntry[];
}

export interface AuditEvent {
  timestamp: string;
  type: string;
  userSlug?: string;
  telegramUserId?: string;
  sessionFile?: string;
  data?: Record<string, unknown>;
}
