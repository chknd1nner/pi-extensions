---
task_number: 1
title: Scaffold the service package and ship the root runtime assets
status: Done
lane: done
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
approval_note: |-
  Approved in review on 2026-05-01. The scaffolded service package and root assets match the Task 1 plan scope, and fresh verification succeeded with `cd services/familyos && npm install` plus `cd services/familyos && npm run typecheck`.
review_prompt_template: |-
  You are reviewing Task 1 from the FamilyOS Telegram MVP implementation plan.

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

# Task 01 — Scaffold the service package and ship the root runtime assets

## Plan excerpt


**Files:**
- Create: `services/familyos/package.json`
- Create: `services/familyos/tsconfig.json`
- Create: `services/familyos/vitest.config.ts`
- Create: `services/familyos/src/main.ts`
- Create: `services/familyos/src/types.ts`
- Create: `config/familyos.json`
- Create: `agents/default/agent.json`
- Create: `agents/default/SOUL.md`
- Create: `.env.sample`
- Modify: `.gitignore`

- [ ] **Step 1: Create `services/familyos/package.json`**

```json
{
  "name": "familyos-service",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "grammy": "^1.38.3",
    "typebox": "latest"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create TypeScript and Vitest config**

Create `services/familyos/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create `services/familyos/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Create initial `src/main.ts` and `src/types.ts`**

Create `services/familyos/src/main.ts`:

```typescript
export async function main() {
  throw new Error("FamilyOS bootstrap is not implemented yet.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

Create `services/familyos/src/types.ts`:

```typescript
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
```

- [ ] **Step 4: Create the root runtime config and default agent assets**

Create `config/familyos.json`:

```json
{
  "defaultAgentId": "default",
  "sharedPiAgentDir": ".familyos-pi",
  "telegram": {
    "flowTtlSeconds": 900,
    "typingIntervalMs": 4000,
    "pageSize": 8
  }
}
```

Create `agents/default/agent.json`:

```json
{
  "id": "default",
  "displayName": "FamilyOS Assistant",
  "capabilities": {
    "tools": ["read", "grep", "find", "ls"],
    "readRoots": ["Inbox", "Workspace", "Exports"],
    "writeRoots": ["Workspace", "Exports"]
  }
}
```

Create `agents/default/SOUL.md`:

```markdown
You are the default FamilyOS assistant.

- Be warm, practical, and concise.
- Treat FamilyOS as a household assistant running on a home server.
- Use available tools only when they materially help.
- Never claim to have read, written, or changed files unless tool results confirm it.
- If you are blocked by permissions or missing files, say so plainly and suggest the next step.
```

Create `.env.sample`:

```bash
TELEGRAM_BOT_TOKEN=123456:replace-me
# Optional when running outside the repository root.
# FAMILYOS_ROOT=/absolute/path/to/pi-extensions
```

- [ ] **Step 5: Update `.gitignore` for runtime state**

Append this block to `.gitignore`:

```gitignore
# FamilyOS runtime state
logs/
users/
.familyos-pi/
```

- [ ] **Step 6: Install dependencies**

Run: `cd services/familyos && npm install`
Expected: `node_modules/` created and `package-lock.json` written

- [ ] **Step 7: Verify the empty scaffold typechecks**

Run: `cd services/familyos && npm run typecheck`
Expected: TypeScript exits with code 0

- [ ] **Step 8: Commit**

```bash
git add .env.sample .gitignore agents/default/agent.json agents/default/SOUL.md config/familyos.json services/familyos/package.json services/familyos/tsconfig.json services/familyos/vitest.config.ts services/familyos/src/main.ts services/familyos/src/types.ts services/familyos/package-lock.json
git commit -m "feat(familyos): scaffold service package and root assets"
```

---

## Notes

- Verification run:
  - `cd services/familyos && npm install`
  - `cd services/familyos && npm run typecheck`
- Follow-up concerns:
  - `npm install` reported a transitive deprecation warning for `node-domexception@1.0.0`; no functional impact on this scaffold task.
- Review outcome:
  - Approved on 2026-05-01 after confirming the scaffold files matched the Task 1 plan and rerunning `cd services/familyos && npm install` plus `cd services/familyos && npm run typecheck` successfully.
