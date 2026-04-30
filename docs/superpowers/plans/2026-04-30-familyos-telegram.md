# FamilyOS Telegram MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram-first FamilyOS server that embeds the Pi SDK in-process, enforces the spec’s default-deny tool boundaries, and exposes `/new`, `/resume`, `/tree`, `/compact`, `/model`, `/agent`, `/cancel`, and `/whoami` through native Telegram UX.

**Architecture:** Put the runnable service in `services/familyos/`, but keep runtime assets in the repo root (`config/`, `agents/`, `users/`, `logs/`) so the on-disk layout matches the approved spec. A channel-agnostic `FamilyOSService` owns users, agents, state, runtimes, and session operations; a `grammY` adapter translates Telegram updates into those operations. Pi integration uses `createAgentSessionRuntime()` plus a FamilyOS-only extension factory for guarded same-name tools, one-shot handoff injection, and audit/event hooks.

**Tech Stack:** TypeScript, Node.js, `grammY`, `@mariozechner/pi-coding-agent`, TypeBox, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-30-familyos-telegram-design.md`

---

## File Structure

```text
.env.sample
agents/
└── default/
    ├── SOUL.md
    └── agent.json
config/
└── familyos.json
services/
└── familyos/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── README.md
    ├── src/
    │   ├── main.ts
    │   ├── types.ts
    │   ├── paths.ts
    │   ├── config.ts
    │   ├── json-file.ts
    │   ├── audit-log.ts
    │   ├── flow-store.ts
    │   ├── reply-format.ts
    │   ├── typing-indicator.ts
    │   ├── attachments/
    │   │   ├── classify.ts
    │   │   └── store.ts
    │   ├── identity/
    │   │   ├── user-store.ts
    │   │   └── state-store.ts
    │   ├── config/
    │   │   ├── merge.ts
    │   │   └── agent-loader.ts
    │   ├── core/
    │   │   ├── session-view.ts
    │   │   └── familyos-service.ts
    │   ├── pi/
    │   │   ├── path-policy.ts
    │   │   ├── guarded-tools.ts
    │   │   ├── handoff.ts
    │   │   ├── familyos-extension.ts
    │   │   ├── runtime-factory.ts
    │   │   ├── prompt-runner.ts
    │   │   └── runtime-registry.ts
    │   └── telegram/
    │       ├── bot.ts
    │       ├── router.ts
    │       ├── keyboards.ts
    │       └── updates.ts
    └── tests/
        ├── helpers/
        │   ├── temp-root.ts
        │   └── fake-telegram.ts
        ├── config.test.ts
        ├── json-file.test.ts
        ├── user-store.test.ts
        ├── merge.test.ts
        ├── agent-loader.test.ts
        ├── path-policy.test.ts
        ├── guarded-tools.test.ts
        ├── handoff.test.ts
        ├── session-view.test.ts
        ├── flow-store.test.ts
        ├── reply-format.test.ts
        ├── typing-indicator.test.ts
        ├── attachments.test.ts
        └── integration/
            ├── runtime-isolation.test.ts
            ├── onboarding.test.ts
            └── telegram-flows.test.ts
```

### Why this layout

- `services/familyos/src/` stays focused on the runnable app and testable modules.
- Root-level `agents/` and `config/` mirror the approved FamilyOS runtime layout instead of hiding those assets inside the package.
- `users/`, `logs/`, and the shared Pi control-plane directory remain runtime data, not committed source.
- `core/` is intentionally channel-agnostic; `telegram/` is the only adapter-specific directory.
- `pi/` contains the security-critical code so guarded tools, runtime creation, and handoff behavior are easy to audit.

---

### Task 1: Scaffold the service package and ship the root runtime assets

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
export type TreeFilter = "all" | "no-tools" | "user-only" | "labeled";
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

### Task 2: Add bootstrap config, root-path discovery, atomic JSON helpers, and audit logging

**Files:**
- Create: `services/familyos/src/paths.ts`
- Create: `services/familyos/src/config.ts`
- Create: `services/familyos/src/json-file.ts`
- Create: `services/familyos/src/audit-log.ts`
- Create: `services/familyos/tests/helpers/temp-root.ts`
- Create: `services/familyos/tests/config.test.ts`
- Create: `services/familyos/tests/json-file.test.ts`

- [ ] **Step 1: Write the failing bootstrap and file-helper tests**

Create `services/familyos/tests/helpers/temp-root.ts`:

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempRoot() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-"));

  await fs.mkdir(path.join(rootDir, "config"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "agents", "default"), { recursive: true });

  await fs.writeFile(
    path.join(rootDir, "config", "familyos.json"),
    JSON.stringify(
      {
        defaultAgentId: "default",
        sharedPiAgentDir: ".familyos-pi",
        telegram: {
          flowTtlSeconds: 900,
          typingIntervalMs: 4000,
          pageSize: 8,
        },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(rootDir, "agents", "default", "agent.json"),
    JSON.stringify(
      {
        id: "default",
        displayName: "FamilyOS Assistant",
        capabilities: {
          tools: ["read", "grep", "find", "ls"],
          readRoots: ["Inbox", "Workspace", "Exports"],
          writeRoots: ["Workspace", "Exports"],
        },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(path.join(rootDir, "agents", "default", "SOUL.md"), "You are FamilyOS.");

  return {
    rootDir,
    cleanup: () => fs.rm(rootDir, { recursive: true, force: true }),
  };
}
```

Create `services/familyos/tests/config.test.ts`:

```typescript
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBootstrapConfig } from "../src/config";
import { resolveFamilyOSRoot } from "../src/paths";
import { createTempRoot } from "./helpers/temp-root";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("resolveFamilyOSRoot", () => {
  it("prefers FAMILYOS_ROOT when it is set", async () => {
    const temp = await createTempRoot();
    cleanups.push(temp.cleanup);

    const resolved = await resolveFamilyOSRoot(process.cwd(), {
      ...process.env,
      FAMILYOS_ROOT: temp.rootDir,
    });

    expect(resolved).toBe(temp.rootDir);
  });

  it("walks upward until it finds config/familyos.json", async () => {
    const temp = await createTempRoot();
    cleanups.push(temp.cleanup);

    const nested = path.join(temp.rootDir, "services", "familyos");
    const resolved = await resolveFamilyOSRoot(nested, process.env);

    expect(resolved).toBe(temp.rootDir);
  });
});

describe("loadBootstrapConfig", () => {
  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    await expect(loadBootstrapConfig({}, process.cwd())).rejects.toThrow("TELEGRAM_BOT_TOKEN is required.");
  });

  it("returns parsed config and resolved paths", async () => {
    const temp = await createTempRoot();
    cleanups.push(temp.cleanup);

    const loaded = await loadBootstrapConfig(
      {
        TELEGRAM_BOT_TOKEN: "token-123",
        FAMILYOS_ROOT: temp.rootDir,
      },
      temp.rootDir,
    );

    expect(loaded.telegramToken).toBe("token-123");
    expect(loaded.rootConfig.defaultAgentId).toBe("default");
    expect(loaded.paths.auditLogPath).toBe(path.join(temp.rootDir, "logs", "audit.jsonl"));
    expect(loaded.paths.sharedPiAgentDir).toBe(path.join(temp.rootDir, ".familyos-pi"));
  });
});
```

Create `services/familyos/tests/json-file.test.ts`:

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditLog } from "../src/audit-log";
import { readJsonFile, writeJsonAtomic } from "../src/json-file";

describe("writeJsonAtomic", () => {
  it("writes the final file and removes the temp file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-json-"));
    const filePath = path.join(dir, "state.json");

    await writeJsonAtomic(filePath, { activeAgentId: "default" });

    const content = JSON.parse(await fs.readFile(filePath, "utf8"));
    await expect(fs.access(`${filePath}.tmp`)).rejects.toThrow();
    expect(content).toEqual({ activeAgentId: "default" });
  });

  it("returns the fallback when the file does not exist", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-json-"));
    const filePath = path.join(dir, "missing.json");

    const value = await readJsonFile(filePath, { hello: "world" });

    expect(value).toEqual({ hello: "world" });
  });
});

describe("createAuditLog", () => {
  it("appends one JSON object per line", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-audit-"));
    const logPath = path.join(dir, "audit.jsonl");
    const audit = createAuditLog(logPath);

    audit.append({ type: "test_event", userSlug: "martin" });
    audit.append({ type: "second_event", telegramUserId: "123" });
    await audit.close();

    const lines = (await fs.readFile(logPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe("test_event");
    expect(JSON.parse(lines[1]).type).toBe("second_event");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/config.test.ts tests/json-file.test.ts`
Expected: FAIL because `config.ts`, `paths.ts`, `json-file.ts`, and `audit-log.ts` do not exist yet

- [ ] **Step 3: Implement root discovery and bootstrap loading**

Create `services/familyos/src/paths.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { FamilyOSPaths, FamilyOSRootConfig, ResolvedUser, UserManifest } from "./types.js";

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFamilyOSRoot(
  startDir = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const override = env.FAMILYOS_ROOT?.trim();
  if (override) return path.resolve(override);

  let current = path.resolve(startDir);
  while (true) {
    if (await exists(path.join(current, "config", "familyos.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

export function buildFamilyOSPaths(rootDir: string, config: FamilyOSRootConfig): FamilyOSPaths {
  return {
    rootDir,
    agentsDir: path.join(rootDir, "agents"),
    configDir: path.join(rootDir, "config"),
    usersDir: path.join(rootDir, "users"),
    logsDir: path.join(rootDir, "logs"),
    auditLogPath: path.join(rootDir, "logs", "audit.jsonl"),
    sharedPiAgentDir: path.join(rootDir, config.sharedPiAgentDir),
  };
}

export function resolveUserPaths(paths: FamilyOSPaths, manifest: Pick<UserManifest, "id" | "displayName">): ResolvedUser {
  const userDir = path.join(paths.usersDir, manifest.id);
  const homeDir = path.join(userDir, "home");

  return {
    slug: manifest.id,
    displayName: manifest.displayName,
    manifestPath: path.join(userDir, "user.json"),
    statePath: path.join(userDir, "state.json"),
    homeDir,
    inboxDir: path.join(homeDir, "Inbox"),
    workspaceDir: path.join(homeDir, "Workspace"),
    exportsDir: path.join(homeDir, "Exports"),
    familySettingsPath: path.join(homeDir, ".familyos", "settings.json"),
    piSettingsPath: path.join(homeDir, ".pi", "settings.json"),
  };
}
```

Create `services/familyos/src/config.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./json-file.js";
import { buildFamilyOSPaths, resolveFamilyOSRoot } from "./paths.js";
import type { FamilyOSPaths, FamilyOSRootConfig } from "./types.js";

export interface BootstrapConfig {
  telegramToken: string;
  rootConfig: FamilyOSRootConfig;
  paths: FamilyOSPaths;
}

export const DEFAULT_ROOT_CONFIG: FamilyOSRootConfig = {
  defaultAgentId: "default",
  sharedPiAgentDir: ".familyos-pi",
  telegram: {
    flowTtlSeconds: 900,
    typingIntervalMs: 4000,
    pageSize: 8,
  },
};

export async function loadBootstrapConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<BootstrapConfig> {
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const rootDir = await resolveFamilyOSRoot(cwd, env);
  const configPath = path.join(rootDir, "config", "familyos.json");
  const rootConfig = await readJsonFile(configPath, DEFAULT_ROOT_CONFIG);
  const paths = buildFamilyOSPaths(rootDir, rootConfig);

  await fs.mkdir(paths.logsDir, { recursive: true });
  await fs.mkdir(paths.sharedPiAgentDir, { recursive: true });

  return {
    telegramToken,
    rootConfig,
    paths,
  };
}
```

- [ ] **Step 4: Implement JSON and audit helpers**

Create `services/familyos/src/json-file.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}
```

Create `services/familyos/src/audit-log.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import type { AuditEvent } from "./types.js";

export interface AuditLog {
  append(event: Omit<AuditEvent, "timestamp"> & Partial<Pick<AuditEvent, "timestamp">>): void;
  close(): Promise<void>;
}

export function createAuditLog(filePath: string): AuditLog {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stream = fs.createWriteStream(filePath, { flags: "a" });

  return {
    append(event) {
      const payload: AuditEvent = {
        timestamp: event.timestamp ?? new Date().toISOString(),
        type: event.type,
        userSlug: event.userSlug,
        telegramUserId: event.telegramUserId,
        sessionFile: event.sessionFile,
        data: event.data,
      };
      stream.write(`${JSON.stringify(payload)}\n`);
    },
    close() {
      return new Promise((resolve, reject) => {
        stream.end((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/config.test.ts tests/json-file.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/familyos/src/paths.ts services/familyos/src/config.ts services/familyos/src/json-file.ts services/familyos/src/audit-log.ts services/familyos/tests/helpers/temp-root.ts services/familyos/tests/config.test.ts services/familyos/tests/json-file.test.ts
git commit -m "feat(familyos): add bootstrap config and file helpers"
```

---

### Task 3: Implement user resolution, manual registration lookup, home scaffolding, and state persistence

**Files:**
- Create: `services/familyos/src/identity/user-store.ts`
- Create: `services/familyos/src/identity/state-store.ts`
- Create: `services/familyos/tests/user-store.test.ts`

- [ ] **Step 1: Write the failing user-store tests**

Create `services/familyos/tests/user-store.test.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFamilyOSPaths } from "../src/paths";
import { StateStore } from "../src/identity/state-store";
import { UserStore } from "../src/identity/user-store";
import { createTempRoot } from "./helpers/temp-root";

describe("UserStore", () => {
  it("resolves a Telegram ID to a registered FamilyOS user", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.usersDir, "martin"), { recursive: true });
    await fs.writeFile(
      path.join(paths.usersDir, "martin", "user.json"),
      JSON.stringify(
        {
          id: "martin",
          displayName: "Martin",
          channels: { telegram: { userIds: ["123456789"] } },
        },
        null,
        2,
      ),
    );

    const store = new UserStore(paths);
    const user = await store.resolveByChannel({
      channel: "telegram",
      externalUserId: "123456789",
      chatId: "123456789",
    });

    expect(user?.slug).toBe("martin");
    await temp.cleanup();
  });

  it("scaffolds the user home with both settings files containing {}", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.usersDir, "alice"), { recursive: true });
    await fs.writeFile(
      path.join(paths.usersDir, "alice", "user.json"),
      JSON.stringify(
        {
          id: "alice",
          displayName: "Alice",
          channels: { telegram: { userIds: ["42"] } },
        },
        null,
        2,
      ),
    );

    const store = new UserStore(paths);
    const user = await store.resolveByChannel({
      channel: "telegram",
      externalUserId: "42",
      chatId: "42",
    });

    if (!user) throw new Error("Expected registered user");
    await store.ensureHome(user);

    expect(await fs.readFile(user.familySettingsPath, "utf8")).toBe("{}\n");
    expect(await fs.readFile(user.piSettingsPath, "utf8")).toBe("{}\n");
    await temp.cleanup();
  });
});

describe("StateStore", () => {
  it("returns the default active agent when state.json is missing", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.usersDir, "mum"), { recursive: true });
    await fs.writeFile(
      path.join(paths.usersDir, "mum", "user.json"),
      JSON.stringify(
        {
          id: "mum",
          displayName: "Mum",
          channels: { telegram: { userIds: ["77"] } },
        },
        null,
        2,
      ),
    );

    const store = new UserStore(paths);
    const user = await store.resolveByChannel({
      channel: "telegram",
      externalUserId: "77",
      chatId: "77",
    });

    if (!user) throw new Error("Expected registered user");
    const stateStore = new StateStore();
    const state = await stateStore.read(user, "default");

    expect(state).toEqual({ activeAgentId: "default" });
    await temp.cleanup();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/user-store.test.ts`
Expected: FAIL because `user-store.ts` and `state-store.ts` do not exist yet

- [ ] **Step 3: Implement the user manifest lookup and home scaffolding**

Create `services/familyos/src/identity/user-store.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../json-file.js";
import { resolveUserPaths } from "../paths.js";
import type { ChannelIdentity, FamilyOSPaths, ResolvedUser, UserManifest } from "../types.js";

async function readManifest(filePath: string): Promise<UserManifest | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as UserManifest;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export class UserStore {
  constructor(private readonly paths: FamilyOSPaths) {}

  async listUserManifests(): Promise<UserManifest[]> {
    try {
      const entries = await fs.readdir(this.paths.usersDir, { withFileTypes: true });
      const manifests = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readManifest(path.join(this.paths.usersDir, entry.name, "user.json"))),
      );
      return manifests.filter((manifest): manifest is UserManifest => manifest !== null);
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async resolveByChannel(identity: ChannelIdentity): Promise<ResolvedUser | null> {
    if (identity.channel !== "telegram") return null;

    const manifests = await this.listUserManifests();
    const matched = manifests.find((manifest) =>
      manifest.channels.telegram?.userIds.includes(identity.externalUserId),
    );

    return matched ? resolveUserPaths(this.paths, matched) : null;
  }

  async describeTelegramCaller(telegramUserId: string) {
    const user = await this.resolveByChannel({
      channel: "telegram",
      externalUserId: telegramUserId,
      chatId: telegramUserId,
    });

    return {
      telegramUserId,
      slug: user?.slug,
    };
  }

  async ensureHome(user: ResolvedUser): Promise<void> {
    await fs.mkdir(user.inboxDir, { recursive: true });
    await fs.mkdir(user.workspaceDir, { recursive: true });
    await fs.mkdir(user.exportsDir, { recursive: true });
    await fs.mkdir(path.dirname(user.familySettingsPath), { recursive: true });
    await fs.mkdir(path.dirname(user.piSettingsPath), { recursive: true });

    try {
      await fs.access(user.familySettingsPath);
    } catch {
      await writeJsonAtomic(user.familySettingsPath, {});
    }

    try {
      await fs.access(user.piSettingsPath);
    } catch {
      await writeJsonAtomic(user.piSettingsPath, {});
    }
  }
}
```

- [ ] **Step 4: Implement state persistence**

Create `services/familyos/src/identity/state-store.ts`:

```typescript
import { readJsonFile, writeJsonAtomic } from "../json-file.js";
import type { ResolvedUser, UserState } from "../types.js";

export class StateStore {
  async read(user: ResolvedUser, defaultAgentId: string): Promise<UserState> {
    return readJsonFile(user.statePath, { activeAgentId: defaultAgentId });
  }

  async write(user: ResolvedUser, state: UserState): Promise<void> {
    await writeJsonAtomic(user.statePath, state);
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/user-store.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/familyos/src/identity/user-store.ts services/familyos/src/identity/state-store.ts services/familyos/tests/user-store.test.ts
git commit -m "feat(familyos): add user lookup and state persistence"
```

---

### Task 4: Implement merge semantics and filesystem-defined agent loading

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

### Task 5: Implement the security boundary: path policy plus guarded same-name tool definitions

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

  it("returns a safe denial result for blocked reads", async () => {
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
    const result = await readTool.execute("call-1", { path: ".pi/secret.txt" }, undefined, undefined, {
      cwd: user.homeDir,
      ui: {} as any,
      hasUI: false,
      sessionManager: {} as any,
      modelRegistry: {} as any,
      model: undefined,
      isIdle: () => true,
      signal: undefined,
      abort: () => undefined,
      hasPendingMessages: () => false,
      shutdown: () => undefined,
      getContextUsage: () => undefined,
      compact: () => undefined,
      getSystemPrompt: () => "",
    });

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

  return definitions.filter((definition) =>
    agent.capabilities.tools.includes(definition.name as ToolName),
  );
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

### Task 6: Implement one-shot handoff state, the FamilyOS extension factory, and the runtime factory

**Files:**
- Create: `services/familyos/src/pi/handoff.ts`
- Create: `services/familyos/src/pi/familyos-extension.ts`
- Create: `services/familyos/src/pi/runtime-factory.ts`
- Create: `services/familyos/tests/handoff.test.ts`

- [ ] **Step 1: Write the failing handoff tests**

Create `services/familyos/tests/handoff.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { HANDOFF_PROMPT, OneShotHandoff, injectHandoffIntoPayload } from "../src/pi/handoff";

describe("OneShotHandoff", () => {
  it("arms once and clears after consume", () => {
    const handoff = new OneShotHandoff();
    handoff.arm(HANDOFF_PROMPT);

    expect(handoff.peek()).toContain("different assistant");
    expect(handoff.consume()).toContain("different assistant");
    expect(handoff.consume()).toBeUndefined();
  });
});

describe("injectHandoffIntoPayload", () => {
  it("appends to a string system field", () => {
    const payload = injectHandoffIntoPayload({ system: "base", messages: [] }, "handoff");
    expect((payload as any).system).toContain("handoff");
  });

  it("appends a text item to an array system field", () => {
    const payload = injectHandoffIntoPayload({ system: [{ type: "text", text: "base" }], messages: [] }, "handoff");
    expect((payload as any).system.at(-1)).toEqual({ type: "text", text: "handoff" });
  });

  it("prepends a synthetic system message when the payload only has messages", () => {
    const payload = injectHandoffIntoPayload({ messages: [{ role: "user", content: "hello" }] }, "handoff");
    expect((payload as any).messages[0]).toEqual({ role: "system", content: "handoff" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/handoff.test.ts`
Expected: FAIL because `handoff.ts` does not exist yet

- [ ] **Step 3: Implement one-shot handoff storage and payload rewriting**

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

export function injectHandoffIntoPayload(payload: unknown, handoff: string): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const value = structuredClone(payload as Record<string, unknown>);

  if (typeof value.system === "string") {
    return {
      ...value,
      system: `${value.system}\n\n${handoff}`,
    };
  }

  if (Array.isArray(value.system)) {
    return {
      ...value,
      system: [...value.system, { type: "text", text: handoff }],
    };
  }

  if (Array.isArray(value.messages)) {
    return {
      ...value,
      messages: [{ role: "system", content: handoff }, ...value.messages],
    };
  }

  return value;
}
```

- [ ] **Step 4: Implement the FamilyOS extension factory and runtime factory**

Create `services/familyos/src/pi/familyos-extension.ts`:

```typescript
import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import type { ResolvedAgent, ResolvedUser } from "../types.js";
import { buildGuardedToolDefinitions } from "./guarded-tools.js";
import { injectHandoffIntoPayload, OneShotHandoff } from "./handoff.js";

export interface FamilyOSExtensionOptions {
  user: ResolvedUser;
  agent: ResolvedAgent;
  handoff: OneShotHandoff;
  audit: AuditLog;
  onEvent?: (event: { type: string; userSlug: string; data?: Record<string, unknown> }) => void;
}

export function createFamilyOSExtension(options: FamilyOSExtensionOptions): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let toolsRegistered = false;

    pi.on("session_start", async () => {
      if (!toolsRegistered) {
        const definitions = buildGuardedToolDefinitions(options.user, options.agent, (event) => {
          options.audit.append(event);
        });
        for (const definition of definitions) {
          pi.registerTool(definition);
        }
        toolsRegistered = true;
      }

      pi.setActiveTools(options.agent.capabilities.tools);
    });

    pi.on("before_provider_request", (event) => {
      const handoff = options.handoff.consume();
      if (!handoff) return undefined;
      return injectHandoffIntoPayload(event.payload, handoff);
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

Create `services/familyos/src/pi/runtime-factory.ts`:

```typescript
import fs from "node:fs/promises";
import {
  type AuthStorage,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionServices,
  getDefaultSessionDir,
  type ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import { AgentLoader } from "../config/agent-loader.js";
import type { FamilyOSPaths, FamilyOSRootConfig, ResolvedUser } from "../types.js";
import { createFamilyOSExtension } from "./familyos-extension.js";
import { OneShotHandoff } from "./handoff.js";

export async function createInitialSessionManager(
  paths: FamilyOSPaths,
  user: ResolvedUser,
  activeSessionPath: string | undefined,
) {
  const sessionDir = getDefaultSessionDir(user.homeDir, paths.sharedPiAgentDir);
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
            agent,
            handoff: options.handoff,
            audit: options.audit,
            onEvent: options.onEvent,
          }),
        ],
        systemPromptOverride: () => agent.soul,
        appendSystemPromptOverride: () => [],
      },
    });

    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        noTools: "all",
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/handoff.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/familyos/src/pi/handoff.ts services/familyos/src/pi/familyos-extension.ts services/familyos/src/pi/runtime-factory.ts services/familyos/tests/handoff.test.ts
git commit -m "feat(familyos): add runtime factory and handoff extension"
```

---

### Task 7: Build the session-list and ASCII tree view helpers for `/resume` and `/tree`

**Files:**
- Create: `services/familyos/src/core/session-view.ts`
- Create: `services/familyos/tests/session-view.test.ts`

- [ ] **Step 1: Write the failing session-view tests**

Create `services/familyos/tests/session-view.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildTreePage, formatSessionList } from "../src/core/session-view";

describe("formatSessionList", () => {
  it("uses the explicit session name when present", () => {
    const items = formatSessionList([
      {
        id: "abc123",
        path: "/tmp/session.jsonl",
        cwd: "/tmp/project",
        name: "Refactor auth",
        parentSessionPath: undefined,
        created: new Date("2026-04-30T10:00:00Z"),
        modified: new Date("2026-04-30T12:30:00Z"),
        messageCount: 8,
        firstMessage: "hello",
        allMessagesText: "hello world",
      },
    ]);

    expect(items[0]).toEqual({
      id: "abc123",
      path: "/tmp/session.jsonl",
      title: "Refactor auth",
      subtitle: "2026-04-30 12:30 • 8 msgs",
    });
  });
});

describe("buildTreePage", () => {
  it("renders user-only entries by default with numeric indices", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "message",
          id: "a1",
          parentId: "u1",
          timestamp: "2026-04-30T10:01:00.000Z",
          message: { role: "assistant", content: "Sure" },
        },
        {
          type: "message",
          id: "u2",
          parentId: "a1",
          timestamp: "2026-04-30T10:02:00.000Z",
          message: { role: "user", content: "Try plan B" },
        },
      ] as any,
      "u2",
      "user-only",
      0,
      10,
      () => undefined,
    );

    expect(page.entries.map((entry) => entry.entryId)).toEqual(["u1", "u2"]);
    expect(page.text).toContain("[1]");
    expect(page.text).toContain("[2]");
  });

  it("includes only labeled entries in labeled mode", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "message",
          id: "u2",
          parentId: "u1",
          timestamp: "2026-04-30T10:02:00.000Z",
          message: { role: "user", content: "Try plan B" },
        },
      ] as any,
      "u2",
      "labeled",
      0,
      10,
      (entryId) => (entryId === "u2" ? "checkpoint" : undefined),
    );

    expect(page.entries.map((entry) => entry.entryId)).toEqual(["u2"]);
    expect(page.text).toContain("checkpoint");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/session-view.test.ts`
Expected: FAIL because `session-view.ts` does not exist yet

- [ ] **Step 3: Implement the session-list formatter and ASCII tree renderer**

Create `services/familyos/src/core/session-view.ts`:

```typescript
import type { SessionEntry, SessionInfo } from "@mariozechner/pi-coding-agent";
import type { SessionListItem, TreeFilter, TreePage } from "../types.js";

function formatUtcMinute(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function previewContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String((part as any).text) : "[non-text]"))
      .join(" ");
  }
  return "[unknown]";
}

function entryPreview(entry: SessionEntry, label: string | undefined, activeLeafId: string | null): string {
  const activePrefix = entry.id === activeLeafId ? "→ " : "  ";

  if (entry.type === "message") {
    const preview = previewContent(entry.message.content).replace(/\s+/g, " ").slice(0, 60);
    const suffix = label ? ` [${label}]` : "";
    return `${activePrefix}${entry.message.role}: ${preview}${suffix}`;
  }

  if (entry.type === "compaction") {
    return `${activePrefix}compaction: ${entry.summary.slice(0, 60)}`;
  }

  if (entry.type === "branch_summary") {
    return `${activePrefix}summary: ${entry.summary.slice(0, 60)}`;
  }

  if (entry.type === "session_info") {
    return `${activePrefix}session: ${entry.name ?? "(unnamed)"}`;
  }

  if (entry.type === "label") {
    return `${activePrefix}label: ${entry.label ?? "cleared"}`;
  }

  return `${activePrefix}${entry.type}`;
}

function isVisible(entry: SessionEntry, filter: TreeFilter, label: string | undefined): boolean {
  switch (filter) {
    case "all":
      return true;
    case "no-tools":
      return entry.type !== "custom" && entry.type !== "custom_message";
    case "user-only":
      return entry.type === "message" && entry.message.role === "user";
    case "labeled":
      return Boolean(label);
  }
}

export function formatSessionList(sessions: SessionInfo[]): SessionListItem[] {
  return sessions.map((session) => ({
    id: session.id,
    path: session.path,
    title: session.name ?? session.firstMessage.slice(0, 60),
    subtitle: `${formatUtcMinute(session.modified)} • ${session.messageCount} msgs`,
  }));
}

export function buildTreePage(
  entries: SessionEntry[],
  activeLeafId: string | null,
  filter: TreeFilter,
  page: number,
  pageSize: number,
  getLabel: (entryId: string) => string | undefined,
): TreePage {
  const depthById = new Map<string, number>();
  const visible = entries
    .map((entry) => {
      const depth = entry.parentId ? (depthById.get(entry.parentId) ?? 0) + 1 : 0;
      depthById.set(entry.id, depth);
      const label = getLabel(entry.id);
      return {
        entry,
        depth,
        label,
      };
    })
    .filter(({ entry, label }) => isVisible(entry, filter, label));

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = visible.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const numbered = pageItems.map((item, index) => {
    const humanIndex = index + 1;
    return {
      index: humanIndex,
      entryId: item.entry.id,
      line: `${"  ".repeat(item.depth)}[${humanIndex}] ${entryPreview(item.entry, item.label, activeLeafId)}`,
    };
  });

  return {
    filter,
    page: safePage,
    totalPages,
    text: [
      `Tree filter: ${filter}`,
      `Page ${safePage + 1}/${totalPages}`,
      "",
      ...numbered.map((item) => item.line),
    ].join("\n"),
    entries: numbered,
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/session-view.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/familyos/src/core/session-view.ts services/familyos/tests/session-view.test.ts
git commit -m "feat(familyos): add resume and tree view helpers"
```

---

### Task 8: Implement prompt execution, per-user runtime management, and the channel-agnostic FamilyOS service

**Files:**
- Create: `services/familyos/src/pi/prompt-runner.ts`
- Create: `services/familyos/src/pi/runtime-registry.ts`
- Create: `services/familyos/src/core/familyos-service.ts`
- Create: `services/familyos/tests/integration/runtime-isolation.test.ts`

- [ ] **Step 1: Write the failing runtime/service integration test**

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
import { createTempRoot } from "../helpers/temp-root";

describe("FamilyOS runtime isolation", () => {
  it("creates separate runtimes per user with user-scoped cwd and state", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

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
    const agentLoader = new AgentLoader(paths, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const authStorage = AuthStorage.create(path.join(paths.sharedPiAgentDir, "auth.json"));
    const modelRegistry = ModelRegistry.create(authStorage, path.join(paths.sharedPiAgentDir, "models.json"));
    const audit = createAuditLog(paths.auditLogPath);

    const runtimeRegistry = new UserRuntimeRegistry({
      paths,
      rootConfig: {
        defaultAgentId: "default",
        sharedPiAgentDir: ".familyos-pi",
        telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
      },
      userStore,
      stateStore,
      agentLoader,
      authStorage,
      modelRegistry,
      audit,
    });

    const service = new FamilyOSService({
      paths,
      rootConfig: {
        defaultAgentId: "default",
        sharedPiAgentDir: ".familyos-pi",
        telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
      },
      userStore,
      stateStore,
      agentLoader,
      runtimeRegistry,
      modelRegistry,
      audit,
    });

    const martin = await service.resolveRegisteredUser({ channel: "telegram", externalUserId: "101", chatId: "101" });
    const alice = await service.resolveRegisteredUser({ channel: "telegram", externalUserId: "202", chatId: "202" });

    if (!martin || !alice) throw new Error("Expected both users to resolve");

    const martinRuntime = await runtimeRegistry.ensureRuntime(martin);
    const aliceRuntime = await runtimeRegistry.ensureRuntime(alice);

    expect(martinRuntime.cwd).toBe(martin.homeDir);
    expect(aliceRuntime.cwd).toBe(alice.homeDir);
    expect(martinRuntime.cwd).not.toBe(aliceRuntime.cwd);
    expect(martinRuntime.session.sessionFile).not.toBe(aliceRuntime.session.sessionFile);

    await audit.close();
    await temp.cleanup();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/familyos && npx vitest run tests/integration/runtime-isolation.test.ts`
Expected: FAIL because `prompt-runner.ts`, `runtime-registry.ts`, and `familyos-service.ts` do not exist yet

- [ ] **Step 3: Implement prompt execution and assistant-text collection**

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

- [ ] **Step 4: Implement the per-user runtime registry with serialized operations**

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
    };

    this.handles.set(user.slug, handle);
    await this.persist(handle);
    return runtime;
  }

  private async withHandle<T>(user: ResolvedUser, operation: (handle: UserRuntimeHandle) => Promise<T>): Promise<T> {
    await this.ensureRuntime(user);
    const handle = this.handles.get(user.slug);
    if (!handle) throw new Error(`Missing runtime handle for ${user.slug}`);

    const next = handle.queue.catch(() => undefined).then(() => operation(handle));
    handle.queue = next.then(() => undefined, () => undefined);
    return next;
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

    if (result.error || !result.summary) {
      throw new Error(result.error ?? "Could not generate a carry-forward summary.");
    }

    return result.summary;
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
    const handle = this.handles.get(user.slug);
    return !handle || !handle.runtime.session.isStreaming;
  }

  async cancel(user: ResolvedUser) {
    const handle = this.handles.get(user.slug);
    if (!handle || !handle.runtime.session.isStreaming) return false;
    await handle.runtime.session.abort();
    return true;
  }
}
```

- [ ] **Step 5: Implement the channel-agnostic FamilyOS service**

Create `services/familyos/src/core/familyos-service.ts`:

```typescript
import { SessionManager, getDefaultSessionDir } from "@mariozechner/pi-coding-agent";
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
import { UserRuntimeRegistry } from "../pi/runtime-registry.js";
import { formatSessionList, buildTreePage } from "./session-view.js";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

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
    const sessionDir = getDefaultSessionDir(user.homeDir, this.deps.paths.sharedPiAgentDir);
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

  listAvailableModels() {
    return this.deps.modelRegistry.getAvailable().map((model) => ({
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

- [ ] **Step 6: Run the integration test and typecheck**

Run: `cd services/familyos && npx vitest run tests/integration/runtime-isolation.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/familyos/src/pi/prompt-runner.ts services/familyos/src/pi/runtime-registry.ts services/familyos/src/core/familyos-service.ts services/familyos/tests/integration/runtime-isolation.test.ts
git commit -m "feat(familyos): add runtime registry and core service"
```

---

### Task 9: Add flow tokens, Telegram reply formatting, typing indicators, and attachment persistence

**Files:**
- Create: `services/familyos/src/flow-store.ts`
- Create: `services/familyos/src/reply-format.ts`
- Create: `services/familyos/src/typing-indicator.ts`
- Create: `services/familyos/src/attachments/classify.ts`
- Create: `services/familyos/src/attachments/store.ts`
- Create: `services/familyos/tests/flow-store.test.ts`
- Create: `services/familyos/tests/reply-format.test.ts`
- Create: `services/familyos/tests/typing-indicator.test.ts`
- Create: `services/familyos/tests/attachments.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `services/familyos/tests/flow-store.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { FlowStore } from "../src/flow-store";

describe("FlowStore", () => {
  it("returns undefined after expiry", async () => {
    const store = new FlowStore<{ kind: string }>(10);
    const token = store.create({ kind: "resume" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.get(token)).toBeUndefined();
  });
});
```

Create `services/familyos/tests/reply-format.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatReplyForTelegram } from "../src/reply-format";

describe("formatReplyForTelegram", () => {
  it("keeps fenced code blocks intact across split messages", () => {
    const text = `Before\n\n\`\`\`ts\n${"line\n".repeat(1000)}\`\`\`\n\nAfter`;
    const chunks = formatReplyForTelegram(text, 1000);

    expect(chunks.some((chunk) => chunk.includes("<pre><code>"))).toBe(true);
    expect(chunks.every((chunk) => !chunk.includes("```"))).toBe(true);
  });
});
```

Create `services/familyos/tests/typing-indicator.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { TypingIndicatorLoop } from "../src/typing-indicator";

describe("TypingIndicatorLoop", () => {
  it("starts once per key and stops cleanly", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const loop = new TypingIndicatorLoop(4000);

    loop.start("martin", send);
    loop.start("martin", send);
    await vi.advanceTimersByTimeAsync(4100);
    loop.stop("martin");
    await vi.advanceTimersByTimeAsync(4100);

    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

Create `services/familyos/tests/attachments.test.ts`:

```typescript
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { classifyTelegramMedia } from "../src/attachments/classify";
import { persistAttachments } from "../src/attachments/store";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { createTempRoot } from "./helpers/temp-root";

describe("classifyTelegramMedia", () => {
  it("classifies photos as images and voice notes as unsupported", () => {
    expect(classifyTelegramMedia({ photo: [{ file_id: "file-1" }], caption: "pic" }).attachments[0]?.kind).toBe("image");
    expect(classifyTelegramMedia({ voice: { file_id: "voice-1" } }).unsupportedMessage).toContain("unsupported");
  });
});

describe("persistAttachments", () => {
  it("saves images in Inbox and returns inline image payloads", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(user.inboxDir, { recursive: true });

    const saved = await persistAttachments(
      user,
      [{ kind: "image", fileId: "file-1", fileName: "photo.jpg", mimeType: "image/jpeg" }],
      {
        download: async () => ({
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("fake-image"),
        }),
      },
    );

    expect(saved[0]?.relativePath.startsWith("Inbox/")).toBe(true);
    expect(saved[0]?.inlineImage?.type).toBe("image");
    await temp.cleanup();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts`
Expected: FAIL because the utility files do not exist yet

- [ ] **Step 3: Implement flow tokens and typing loops**

Create `services/familyos/src/flow-store.ts`:

```typescript
import crypto from "node:crypto";

interface StoredFlow<T> {
  expiresAt: number;
  value: T;
}

export class FlowStore<T> {
  private readonly values = new Map<string, StoredFlow<T>>();

  constructor(private readonly ttlMs: number) {}

  create(value: T) {
    const token = crypto.randomBytes(12).toString("base64url");
    this.values.set(token, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return token;
  }

  get(token: string) {
    const record = this.values.get(token);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      this.values.delete(token);
      return undefined;
    }
    return record.value;
  }

  update(token: string, nextValue: T) {
    const record = this.get(token);
    if (!record) return false;
    this.values.set(token, {
      value: nextValue,
      expiresAt: Date.now() + this.ttlMs,
    });
    return true;
  }
}
```

Create `services/familyos/src/typing-indicator.ts`:

```typescript
export class TypingIndicatorLoop {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly intervalMs: number) {}

  start(key: string, sendTyping: () => Promise<void>) {
    if (this.timers.has(key)) return;

    void sendTyping();
    const timer = setInterval(() => {
      void sendTyping();
    }, this.intervalMs);
    this.timers.set(key, timer);
  }

  stop(key: string) {
    const timer = this.timers.get(key);
    if (!timer) return;
    clearInterval(timer);
    this.timers.delete(key);
  }
}
```

- [ ] **Step 4: Implement Telegram-safe reply formatting**

Create `services/familyos/src/reply-format.ts`:

```typescript
function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function tokenizeMarkdown(text: string) {
  return text.split(/(```(?:[a-zA-Z0-9_-]+)?\n[\s\S]*?```)/g).filter(Boolean);
}

function renderToken(token: string) {
  const match = token.match(/^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```$/);
  if (match) {
    return `<pre><code>${escapeHtml(match[1]!.trimEnd())}</code></pre>`;
  }
  return escapeHtml(token);
}

export function formatReplyForTelegram(text: string, maxLength = 4096): string[] {
  const blocks = tokenizeMarkdown(text).map(renderToken);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    if (current.length + block.length <= maxLength) {
      current += block;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (block.length <= maxLength) {
      current = block;
      continue;
    }

    const lines = block.split("\n");
    let partial = "";
    for (const line of lines) {
      const next = partial ? `${partial}\n${line}` : line;
      if (next.length > maxLength) {
        chunks.push(partial);
        partial = line;
      } else {
        partial = next;
      }
    }
    current = partial;
  }

  if (current) chunks.push(current);
  return chunks.map((chunk) => chunk || "Done.");
}
```

- [ ] **Step 5: Implement media classification and Inbox persistence**

Create `services/familyos/src/attachments/classify.ts`:

```typescript
import type { PendingAttachment } from "../types.js";

export function classifyTelegramMedia(message: Record<string, any>): {
  attachments: PendingAttachment[];
  unsupportedMessage?: string;
  text: string;
} {
  const text = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo.at(-1)!;
    return {
      text,
      attachments: [
        {
          kind: "image",
          fileId: largest.file_id,
          fileName: `photo-${largest.file_id}.jpg`,
          mimeType: "image/jpeg",
        },
      ],
    };
  }

  if (message.document?.file_id) {
    return {
      text,
      attachments: [
        {
          kind: "document",
          fileId: message.document.file_id,
          fileName: message.document.file_name ?? `document-${message.document.file_id}`,
          mimeType: message.document.mime_type,
        },
      ],
    };
  }

  if (message.voice || message.video || message.sticker || message.animation) {
    return {
      text,
      attachments: [],
      unsupportedMessage: "That media type is not supported in FamilyOS MVP yet.",
    };
  }

  return {
    text,
    attachments: [],
  };
}
```

Create `services/familyos/src/attachments/store.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { PersistedAttachment, PendingAttachment, ResolvedUser } from "../types.js";

export interface AttachmentDownloader {
  download(fileId: string): Promise<{
    fileName: string;
    mimeType?: string;
    buffer: Buffer;
  }>;
}

function safeName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function persistAttachments(
  user: ResolvedUser,
  attachments: PendingAttachment[],
  downloader: AttachmentDownloader,
): Promise<PersistedAttachment[]> {
  const saved: PersistedAttachment[] = [];

  await fs.mkdir(user.inboxDir, { recursive: true });

  for (const attachment of attachments) {
    const downloaded = await downloader.download(attachment.fileId);
    const stampedName = `${Date.now()}-${safeName(downloaded.fileName)}`;
    const absolutePath = path.join(user.inboxDir, stampedName);
    await fs.writeFile(absolutePath, downloaded.buffer);

    saved.push({
      kind: attachment.kind,
      absolutePath,
      relativePath: path.posix.join("Inbox", stampedName),
      inlineImage:
        attachment.kind === "image"
          ? {
              type: "image",
              source: {
                type: "base64",
                mediaType: downloaded.mimeType ?? "image/jpeg",
                data: downloaded.buffer.toString("base64"),
              },
            }
          : undefined,
    });
  }

  return saved;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/familyos/src/flow-store.ts services/familyos/src/reply-format.ts services/familyos/src/typing-indicator.ts services/familyos/src/attachments/classify.ts services/familyos/src/attachments/store.ts services/familyos/tests/flow-store.test.ts services/familyos/tests/reply-format.test.ts services/familyos/tests/typing-indicator.test.ts services/familyos/tests/attachments.test.ts
git commit -m "feat(familyos): add telegram utility layer"
```

---

### Task 10: Build the Telegram adapter, native command flows, and callback handling

**Files:**
- Create: `services/familyos/src/telegram/keyboards.ts`
- Create: `services/familyos/src/telegram/updates.ts`
- Create: `services/familyos/src/telegram/router.ts`
- Modify: `services/familyos/src/main.ts`
- Create: `services/familyos/src/telegram/bot.ts`
- Create: `services/familyos/tests/helpers/fake-telegram.ts`
- Create: `services/familyos/tests/integration/onboarding.test.ts`
- Create: `services/familyos/tests/integration/telegram-flows.test.ts`

- [ ] **Step 1: Write the failing Telegram adapter tests**

Create `services/familyos/tests/helpers/fake-telegram.ts`:

```typescript
export class FakeTelegramResponder {
  sent: Array<{ text: string; parseMode?: string; keyboard?: unknown }> = [];
  edited: Array<{ messageId: number; text: string; parseMode?: string; keyboard?: unknown }> = [];
  callbackAnswers: string[] = [];
  typingCount = 0;

  async reply(text: string, options?: { parseMode?: string; keyboard?: unknown }) {
    this.sent.push({ text, parseMode: options?.parseMode, keyboard: options?.keyboard });
    return { messageId: this.sent.length };
  }

  async edit(messageId: number, text: string, options?: { parseMode?: string; keyboard?: unknown }) {
    this.edited.push({ messageId, text, parseMode: options?.parseMode, keyboard: options?.keyboard });
  }

  async answerCallback(text: string) {
    this.callbackAnswers.push(text);
  }

  async sendTyping() {
    this.typingCount += 1;
  }
}
```

Create `services/familyos/tests/integration/onboarding.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { FlowStore } from "../../src/flow-store";
import { TypingIndicatorLoop } from "../../src/typing-indicator";
import { TelegramRouter } from "../../src/telegram/router";
import { FakeTelegramResponder } from "../helpers/fake-telegram";

describe("Telegram onboarding", () => {
  it("allows /whoami for unregistered users and blocks other work", async () => {
    const service = {
      getOnboardingMessage: () => "You're not registered with FamilyOS yet. Use `/whoami` to get your Telegram ID, then send it to the admin.",
      describeCaller: vi.fn(async () => ({ telegramId: "123", slug: undefined })),
      resolveRegisteredUser: vi.fn(async () => null),
    } as any;

    const router = new TelegramRouter({
      service,
      flowStore: new FlowStore(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const whoami = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "123",
        telegramUserId: "123",
        text: "/whoami",
        attachments: [],
      },
      whoami,
    );
    expect(whoami.sent[0]?.text).toContain("Telegram ID: 123");

    const normal = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "123",
        telegramUserId: "123",
        text: "hello",
        attachments: [],
      },
      normal,
    );
    expect(normal.sent[0]?.text).toContain("not registered");
  });

  it("ignores non-private chats", async () => {
    const router = new TelegramRouter({
      service: {
        getOnboardingMessage: () => "ignored",
        describeCaller: vi.fn(),
        resolveRegisteredUser: vi.fn(),
      } as any,
      flowStore: new FlowStore(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: false,
        chatId: "group",
        telegramUserId: "123",
        text: "/whoami",
        attachments: [],
      },
      responder,
    );

    expect(responder.sent).toHaveLength(0);
  });
});
```

Create `services/familyos/tests/integration/telegram-flows.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { FlowStore } from "../../src/flow-store";
import { TypingIndicatorLoop } from "../../src/typing-indicator";
import { TelegramRouter } from "../../src/telegram/router";
import { FakeTelegramResponder } from "../helpers/fake-telegram";

describe("TelegramRouter flows", () => {
  it("renders /new confirmation and executes confirm callback", async () => {
    const service = {
      getOnboardingMessage: () => "onboarding",
      describeCaller: vi.fn(),
      resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
      isIdle: vi.fn(() => true),
      startNewSession: vi.fn(async () => undefined),
    } as any;

    const flowStore = new FlowStore<any>(60_000);
    const router = new TelegramRouter({
      service,
      flowStore,
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        text: "/new",
        attachments: [],
      },
      responder,
    );

    const token = [...(flowStore as any).values.keys()][0];
    expect(token).toBeTruthy();

    await router.handleCallback(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        data: `new:${token}:confirm`,
        messageId: 1,
      },
      responder,
    );

    expect(service.startNewSession).toHaveBeenCalled();
    expect(responder.edited.at(-1)?.text).toContain("Started a new session");
  });

  it("blocks state-changing commands while a turn is running", async () => {
    const router = new TelegramRouter({
      service: {
        getOnboardingMessage: () => "onboarding",
        describeCaller: vi.fn(),
        resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
        isIdle: vi.fn(() => false),
      } as any,
      flowStore: new FlowStore(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        text: "/model",
        attachments: [],
      },
      responder,
    );

    expect(responder.sent.at(-1)?.text).toContain("Please wait");
  });

  it("returns the expired-menu message when a callback token is stale", async () => {
    const router = new TelegramRouter({
      service: {
        getOnboardingMessage: () => "onboarding",
        describeCaller: vi.fn(),
        resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
        isIdle: vi.fn(() => true),
      } as any,
      flowStore: new FlowStore(1),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleCallback(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        data: "new:missing-token:confirm",
        messageId: 1,
      },
      responder,
    );

    expect(responder.callbackAnswers.at(-1)).toContain("expired");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/integration/onboarding.test.ts tests/integration/telegram-flows.test.ts`
Expected: FAIL because the Telegram adapter files do not exist yet

- [ ] **Step 3: Implement inline keyboard builders and grammY update extraction**

Create `services/familyos/src/telegram/keyboards.ts`:

```typescript
export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export function confirmKeyboard(prefix: string, token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Confirm", callback_data: `${prefix}:${token}:confirm` },
      { text: "Cancel", callback_data: `${prefix}:${token}:cancel` },
    ]],
  };
}

export function pagedPickerKeyboard(prefix: string, token: string, count: number, page: number, totalPages: number): InlineKeyboard {
  const numberRow = Array.from({ length: count }, (_value, index) => ({
    text: String(index + 1),
    callback_data: `${prefix}:${token}:pick:${index + 1}`,
  }));

  return {
    inline_keyboard: [
      numberRow,
      [
        { text: "Prev", callback_data: `${prefix}:${token}:prev` },
        { text: "Next", callback_data: `${prefix}:${token}:next` },
        { text: "Cancel", callback_data: `${prefix}:${token}:cancel` },
      ].filter((button) => totalPages > 1 || button.text === "Cancel"),
    ],
  };
}

export function treeKeyboard(token: string, count: number): InlineKeyboard {
  const buttons = Array.from({ length: count }, (_value, index) => ({
    text: String(index + 1),
    callback_data: `tree:${token}:pick:${index + 1}`,
  }));

  return {
    inline_keyboard: [
      buttons,
      [
        { text: "All", callback_data: `tree:${token}:filter:all` },
        { text: "No-tools", callback_data: `tree:${token}:filter:no-tools` },
        { text: "User-only", callback_data: `tree:${token}:filter:user-only` },
        { text: "Labeled", callback_data: `tree:${token}:filter:labeled` },
      ],
      [
        { text: "Prev", callback_data: `tree:${token}:prev` },
        { text: "Next", callback_data: `tree:${token}:next` },
        { text: "Cancel", callback_data: `tree:${token}:cancel` },
      ],
    ],
  };
}

export function treeActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Restore full context", callback_data: `tree-action:${token}:restore` },
      { text: "Branch with summary", callback_data: `tree-action:${token}:branch` },
      { text: "Cancel", callback_data: `tree-action:${token}:cancel` },
    ]],
  };
}

export function compactKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Compact now", callback_data: `compact:${token}:now` },
      { text: "Compact with custom instruction", callback_data: `compact:${token}:custom` },
      { text: "Cancel", callback_data: `compact:${token}:cancel` },
    ]],
  };
}

export function listKeyboard(prefix: string, token: string, labels: string[]): InlineKeyboard {
  return {
    inline_keyboard: labels.map((label, index) => [
      { text: label, callback_data: `${prefix}:${token}:pick:${index + 1}` },
    ]),
  };
}

export function modelActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Switch anyway", callback_data: `model-action:${token}:switch_anyway` },
      { text: "Branch + compact, then switch", callback_data: `model-action:${token}:branch_compact_then_switch` },
      { text: "New session", callback_data: `model-action:${token}:new_session` },
      { text: "Cancel", callback_data: `model-action:${token}:cancel` },
    ]],
  };
}

export function agentActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Continue current session", callback_data: `agent-action:${token}:continue_session` },
      { text: "Start fresh session", callback_data: `agent-action:${token}:start_fresh` },
      { text: "Branch with summary, then switch agent", callback_data: `agent-action:${token}:branch_then_switch` },
      { text: "Cancel", callback_data: `agent-action:${token}:cancel` },
    ]],
  };
}
```

Create `services/familyos/src/telegram/updates.ts`:

```typescript
import type { Context } from "grammy";
import type { AttachmentDownloader } from "../attachments/store.js";
import { classifyTelegramMedia } from "../attachments/classify.js";
import type { PendingAttachment } from "../types.js";
import type { InlineKeyboard } from "./keyboards.js";

export interface TelegramMessageRequest {
  isPrivateChat: boolean;
  chatId: string;
  telegramUserId: string;
  text: string;
  attachments: PendingAttachment[];
  unsupportedMessage?: string;
}

export interface TelegramCallbackRequest {
  isPrivateChat: boolean;
  chatId: string;
  telegramUserId: string;
  data: string;
  messageId: number;
}

export interface TelegramResponder {
  reply(text: string, options?: { parseMode?: "HTML"; keyboard?: InlineKeyboard }): Promise<{ messageId: number }>;
  edit(messageId: number, text: string, options?: { parseMode?: "HTML"; keyboard?: InlineKeyboard }): Promise<void>;
  answerCallback(text: string): Promise<void>;
  sendTyping(): Promise<void>;
}

export function extractMessageRequest(ctx: Context): TelegramMessageRequest {
  const media = classifyTelegramMedia((ctx.message ?? {}) as Record<string, any>);

  return {
    isPrivateChat: ctx.chat?.type === "private",
    chatId: String(ctx.chat?.id ?? ""),
    telegramUserId: String(ctx.from?.id ?? ""),
    text: media.text,
    attachments: media.attachments,
    unsupportedMessage: media.unsupportedMessage,
  };
}

export function extractCallbackRequest(ctx: Context): TelegramCallbackRequest {
  return {
    isPrivateChat: ctx.chat?.type === "private",
    chatId: String(ctx.chat?.id ?? ""),
    telegramUserId: String(ctx.from?.id ?? ""),
    data: ctx.callbackQuery?.data ?? "",
    messageId: ctx.callbackQuery?.message?.message_id ?? 0,
  };
}

export function createGrammYResponder(ctx: Context): TelegramResponder {
  return {
    async reply(text, options) {
      const sent = await ctx.reply(text, {
        parse_mode: options?.parseMode ?? "HTML",
        reply_markup: options?.keyboard as any,
      });
      return { messageId: sent.message_id };
    },
    async edit(messageId, text, options) {
      await ctx.api.editMessageText(Number(ctx.chat?.id), messageId, text, {
        parse_mode: options?.parseMode ?? "HTML",
        reply_markup: options?.keyboard as any,
      });
    },
    async answerCallback(text) {
      await ctx.answerCallbackQuery({ text });
    },
    async sendTyping() {
      await ctx.api.sendChatAction(Number(ctx.chat?.id), "typing");
    },
  };
}

export function createAttachmentDownloader(token: string, api: Context["api"]): AttachmentDownloader {
  return {
    async download(fileId: string) {
      const file = await api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        fileName: file.file_path?.split("/").at(-1) ?? fileId,
        buffer,
      };
    },
  };
}
```

- [ ] **Step 4: Implement the Telegram router and grammY bot wiring**

Create `services/familyos/src/telegram/router.ts`:

```typescript
import { persistAttachments, type AttachmentDownloader } from "../attachments/store.js";
import type { FamilyOSService } from "../core/familyos-service.js";
import { FlowStore } from "../flow-store.js";
import { formatReplyForTelegram } from "../reply-format.js";
import { TypingIndicatorLoop } from "../typing-indicator.js";
import type { AgentSwitchChoice, ModelSwitchChoice, TreeFilter } from "../types.js";
import {
  agentActionKeyboard,
  compactKeyboard,
  confirmKeyboard,
  listKeyboard,
  modelActionKeyboard,
  pagedPickerKeyboard,
  treeActionKeyboard,
  treeKeyboard,
} from "./keyboards.js";
import type { InlineKeyboard } from "./keyboards.js";
import type { TelegramCallbackRequest, TelegramMessageRequest, TelegramResponder } from "./updates.js";

type RouterFlow =
  | { kind: "new_confirm" }
  | { kind: "resume"; items: Array<{ path: string; title: string; subtitle: string }>; page: number }
  | { kind: "tree"; filter: TreeFilter; page: number }
  | { kind: "tree_action"; entryId: string }
  | { kind: "compact" }
  | { kind: "model_select"; models: Array<{ provider: string; id: string; label: string }> }
  | { kind: "model_action"; provider: string; modelId: string }
  | { kind: "agent_select"; agents: Array<{ id: string; label: string }> }
  | { kind: "agent_action"; agentId: string };

function escapePre(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export class TelegramRouter {
  private readonly pendingCompactInstructions = new Map<string, number>();

  constructor(private readonly deps: {
    service: FamilyOSService;
    flowStore: FlowStore<RouterFlow>;
    typingLoop: TypingIndicatorLoop;
    pageSize: number;
    downloader?: AttachmentDownloader;
  }) {}

  private async replyWhoAmI(request: TelegramMessageRequest, responder: TelegramResponder) {
    const identity = await this.deps.service.describeCaller({
      channel: "telegram",
      externalUserId: request.telegramUserId,
      chatId: request.chatId,
    });

    const lines = [`Telegram ID: ${identity.telegramId}`];
    if (identity.slug) {
      lines.push(`FamilyOS user: ${identity.slug}`);
    }

    await responder.reply(lines.join("\n"), { parseMode: "HTML" });
  }

  private async requireRegisteredUser(request: TelegramMessageRequest | TelegramCallbackRequest, responder: TelegramResponder) {
    const user = await this.deps.service.resolveRegisteredUser({
      channel: "telegram",
      externalUserId: request.telegramUserId,
      chatId: request.chatId,
    });

    if (!user) {
      if ("data" in request) {
        await responder.answerCallback(this.deps.service.getOnboardingMessage());
      } else {
        await responder.reply(this.deps.service.getOnboardingMessage(), { parseMode: "HTML" });
      }
      return null;
    }

    return user;
  }

  private async ensureIdle(user: { slug: string }, responder: TelegramResponder) {
    if (this.deps.service.isIdle(user as any)) {
      return true;
    }

    await responder.reply("Please wait until the current turn finishes, or use /cancel.", {
      parseMode: "HTML",
    });
    return false;
  }

  private renderResumeText(items: Array<{ title: string; subtitle: string }>, page: number) {
    const slice = items.slice(page * this.deps.pageSize, page * this.deps.pageSize + this.deps.pageSize);
    const lines = slice.map((item, index) => `[${index + 1}] ${item.title}\n${item.subtitle}`);
    return lines.join("\n\n") || "No sessions yet.";
  }

  private getPageInfo(totalItems: number, page: number) {
    const totalPages = Math.max(1, Math.ceil(totalItems / this.deps.pageSize));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    return { safePage, totalPages };
  }

  async handleMessage(request: TelegramMessageRequest, responder: TelegramResponder) {
    if (!request.isPrivateChat) return;

    if (request.text === "/whoami") {
      await this.replyWhoAmI(request, responder);
      return;
    }

    const user = await this.requireRegisteredUser(request, responder);
    if (!user) return;

    const pendingCompactExpiry = this.pendingCompactInstructions.get(user.slug);
    if (pendingCompactExpiry && pendingCompactExpiry <= Date.now()) {
      this.pendingCompactInstructions.delete(user.slug);
    }

    if (pendingCompactExpiry && pendingCompactExpiry > Date.now() && request.text && !request.text.startsWith("/")) {
      this.pendingCompactInstructions.delete(user.slug);
      const status = await responder.reply("Compacting session…", { parseMode: "HTML" });
      this.deps.typingLoop.start(user.slug, () => responder.sendTyping());
      try {
        await this.deps.service.compact(user, request.text);
        await responder.edit(status.messageId, "Compacted.", { parseMode: "HTML" });
      } finally {
        this.deps.typingLoop.stop(user.slug);
      }
      return;
    }

    if (request.unsupportedMessage) {
      await responder.reply(request.unsupportedMessage, { parseMode: "HTML" });
      return;
    }

    if (request.text === "/new") {
      if (!(await this.ensureIdle(user, responder))) return;
      const token = this.deps.flowStore.create({ kind: "new_confirm" });
      await responder.reply("Start a new Pi session?", {
        parseMode: "HTML",
        keyboard: confirmKeyboard("new", token),
      });
      return;
    }

    if (request.text === "/resume") {
      if (!(await this.ensureIdle(user, responder))) return;
      const items = await this.deps.service.listSessions(user);
      const token = this.deps.flowStore.create({ kind: "resume", items, page: 0 });
      const { totalPages } = this.getPageInfo(items.length, 0);
      await responder.reply(this.renderResumeText(items, 0), {
        parseMode: "HTML",
        keyboard: pagedPickerKeyboard("resume", token, Math.min(items.length, this.deps.pageSize), 0, totalPages),
      });
      return;
    }

    if (request.text === "/tree") {
      if (!(await this.ensureIdle(user, responder))) return;
      const page = await this.deps.service.buildTreePage(user, "user-only", 0);
      const token = this.deps.flowStore.create({ kind: "tree", filter: "user-only", page: 0 });
      await responder.reply(`<pre>${escapePre(page.text)}</pre>`, {
        parseMode: "HTML",
        keyboard: treeKeyboard(token, page.entries.length),
      });
      return;
    }

    if (request.text === "/compact") {
      if (!(await this.ensureIdle(user, responder))) return;
      const token = this.deps.flowStore.create({ kind: "compact" });
      await responder.reply("Choose a compaction action.", {
        parseMode: "HTML",
        keyboard: compactKeyboard(token),
      });
      return;
    }

    if (request.text === "/model") {
      if (!(await this.ensureIdle(user, responder))) return;
      const models = this.deps.service.listAvailableModels();
      const token = this.deps.flowStore.create({ kind: "model_select", models });
      await responder.reply("Choose a model.", {
        parseMode: "HTML",
        keyboard: listKeyboard("model", token, models.map((model) => model.label)),
      });
      return;
    }

    if (request.text === "/agent") {
      if (!(await this.ensureIdle(user, responder))) return;
      const agents = await this.deps.service.listAvailableAgents(user);
      const token = this.deps.flowStore.create({ kind: "agent_select", agents });
      await responder.reply("Choose an agent.", {
        parseMode: "HTML",
        keyboard: listKeyboard("agent", token, agents.map((agent) => agent.label)),
      });
      return;
    }

    if (request.text === "/cancel") {
      const cancelled = await this.deps.service.cancel(user);
      this.deps.typingLoop.stop(user.slug);
      await responder.reply(cancelled ? "Cancelled current turn." : "Nothing is running right now.", {
        parseMode: "HTML",
      });
      return;
    }

    const persisted = this.deps.downloader
      ? await persistAttachments(user, request.attachments, this.deps.downloader)
      : [];

    this.deps.typingLoop.start(user.slug, () => responder.sendTyping());
    try {
      const result = await this.deps.service.sendTurn(user, {
        text: request.text,
        attachments: persisted,
      });
      for (const chunk of formatReplyForTelegram(result.replyText || "Done.")) {
        await responder.reply(chunk, { parseMode: "HTML" });
      }
    } finally {
      this.deps.typingLoop.stop(user.slug);
    }
  }

  async handleCallback(request: TelegramCallbackRequest, responder: TelegramResponder) {
    if (!request.isPrivateChat) return;

    const user = await this.requireRegisteredUser(request, responder);
    if (!user) return;

    const [kind, token, action, value] = request.data.split(":");
    const flow = this.deps.flowStore.get(token);
    if (!flow) {
      await responder.answerCallback("That menu has expired. Please run the command again.");
      return;
    }

    if (action !== "cancel" && !this.deps.service.isIdle(user as any)) {
      await responder.answerCallback("Please wait until the current turn finishes, or use /cancel.");
      return;
    }

    if (kind === "new" && flow.kind === "new_confirm") {
      if (action === "confirm") {
        await this.deps.service.startNewSession(user);
        await responder.edit(request.messageId, "Started a new session.", { parseMode: "HTML" });
      } else {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
      }
      return;
    }

    if (kind === "resume" && flow.kind === "resume") {
      const { safePage, totalPages } = this.getPageInfo(flow.items.length, flow.page + (action === "next" ? 1 : action === "prev" ? -1 : 0));
      if (action === "pick") {
        const index = Number(value) - 1;
        const item = flow.items[safePage * this.deps.pageSize + index];
        if (item) {
          await this.deps.service.resumeSession(user, item.path);
          await responder.edit(request.messageId, `Resumed ${item.title}.`, { parseMode: "HTML" });
        }
        return;
      }
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      this.deps.flowStore.update(token, { ...flow, page: safePage });
      await responder.edit(request.messageId, this.renderResumeText(flow.items, safePage), {
        parseMode: "HTML",
        keyboard: pagedPickerKeyboard("resume", token, Math.min(flow.items.length - safePage * this.deps.pageSize, this.deps.pageSize), safePage, totalPages),
      });
      return;
    }

    if (kind === "tree" && flow.kind === "tree") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }

      const nextFilter = action === "filter" ? (value as TreeFilter) : flow.filter;
      const nextPage = action === "next" ? flow.page + 1 : action === "prev" ? flow.page - 1 : flow.page;
      const page = await this.deps.service.buildTreePage(user, nextFilter, nextPage);

      if (action === "pick") {
        const entry = page.entries[Number(value) - 1];
        if (!entry) return;
        const nextToken = this.deps.flowStore.create({ kind: "tree_action", entryId: entry.entryId });
        await responder.edit(request.messageId, `<pre>${escapePre(page.text)}</pre>`, {
          parseMode: "HTML",
          keyboard: treeActionKeyboard(nextToken),
        });
        return;
      }

      this.deps.flowStore.update(token, { ...flow, filter: nextFilter, page: page.page });
      await responder.edit(request.messageId, `<pre>${escapePre(page.text)}</pre>`, {
        parseMode: "HTML",
        keyboard: treeKeyboard(token, page.entries.length),
      });
      return;
    }

    if (kind === "tree-action" && flow.kind === "tree_action") {
      if (action === "restore") {
        await this.deps.service.restoreTreeEntry(user, flow.entryId);
        await responder.edit(request.messageId, "Restored the selected tree entry.", { parseMode: "HTML" });
        return;
      }
      if (action === "branch") {
        await this.deps.service.branchTreeEntry(user, flow.entryId);
        await responder.edit(request.messageId, "Branched with summary from the selected tree entry.", { parseMode: "HTML" });
        return;
      }
      await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
      return;
    }

    if (kind === "compact" && flow.kind === "compact") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      if (action === "custom") {
        this.pendingCompactInstructions.set(user.slug, Date.now() + 60_000);
        await responder.edit(request.messageId, "Send one message with the custom compaction instruction.", { parseMode: "HTML" });
        return;
      }
      await responder.edit(request.messageId, "Compacting session…", { parseMode: "HTML" });
      this.deps.typingLoop.start(user.slug, () => responder.sendTyping());
      try {
        await this.deps.service.compact(user);
        await responder.edit(request.messageId, "Compacted.", { parseMode: "HTML" });
      } finally {
        this.deps.typingLoop.stop(user.slug);
      }
      return;
    }

    if (kind === "model" && flow.kind === "model_select") {
      if (action === "pick") {
        const model = flow.models[Number(value) - 1];
        if (!model) return;
        const nextToken = this.deps.flowStore.create({ kind: "model_action", provider: model.provider, modelId: model.id });
        await responder.edit(request.messageId, "Switching models resets cache and can increase cost/usage.", {
          parseMode: "HTML",
          keyboard: modelActionKeyboard(nextToken),
        });
      }
      return;
    }

    if (kind === "model-action" && flow.kind === "model_action") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      await this.deps.service.switchModel(user, flow.provider, flow.modelId, action as ModelSwitchChoice);
      await responder.edit(request.messageId, `Switched to ${flow.provider}/${flow.modelId}.`, { parseMode: "HTML" });
      return;
    }

    if (kind === "agent" && flow.kind === "agent_select") {
      if (action === "pick") {
        const agent = flow.agents[Number(value) - 1];
        if (!agent) return;
        const nextToken = this.deps.flowStore.create({ kind: "agent_action", agentId: agent.id });
        await responder.edit(request.messageId, `Switch to ${agent.label}?`, {
          parseMode: "HTML",
          keyboard: agentActionKeyboard(nextToken),
        });
      }
      return;
    }

    if (kind === "agent-action" && flow.kind === "agent_action") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      await this.deps.service.switchAgent(user, flow.agentId, action as AgentSwitchChoice);
      await responder.edit(request.messageId, `Switched agent to ${flow.agentId}.`, { parseMode: "HTML" });
    }
  }
}
```

Create `services/familyos/src/telegram/bot.ts`:

```typescript
import { Bot } from "grammy";
import type { FamilyOSService } from "../core/familyos-service.js";
import { FlowStore } from "../flow-store.js";
import { TypingIndicatorLoop } from "../typing-indicator.js";
import { TelegramRouter } from "./router.js";
import {
  createAttachmentDownloader,
  createGrammYResponder,
  extractCallbackRequest,
  extractMessageRequest,
} from "./updates.js";

export function createTelegramBot(options: {
  token: string;
  service: FamilyOSService;
  pageSize: number;
  flowTtlMs: number;
  typingIntervalMs: number;
}) {
  const bot = new Bot(options.token);
  const router = new TelegramRouter({
    service: options.service,
    flowStore: new FlowStore(options.flowTtlMs),
    typingLoop: new TypingIndicatorLoop(options.typingIntervalMs),
    pageSize: options.pageSize,
    downloader: createAttachmentDownloader(options.token, bot.api),
  });

  bot.on("message", async (ctx) => {
    await router.handleMessage(extractMessageRequest(ctx), createGrammYResponder(ctx));
  });

  bot.on("callback_query:data", async (ctx) => {
    await router.handleCallback(extractCallbackRequest(ctx), createGrammYResponder(ctx));
  });

  return bot;
}
```

Modify `services/familyos/src/main.ts` to the real bootstrap:

```typescript
import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { createAuditLog } from "./audit-log.js";
import { loadBootstrapConfig } from "./config.js";
import { AgentLoader } from "./config/agent-loader.js";
import { FamilyOSService } from "./core/familyos-service.js";
import { StateStore } from "./identity/state-store.js";
import { UserStore } from "./identity/user-store.js";
import { UserRuntimeRegistry } from "./pi/runtime-registry.js";
import { createTelegramBot } from "./telegram/bot.js";

export async function main() {
  const { telegramToken, rootConfig, paths } = await loadBootstrapConfig();
  const audit = createAuditLog(paths.auditLogPath);
  const userStore = new UserStore(paths);
  const stateStore = new StateStore();
  const agentLoader = new AgentLoader(paths, rootConfig);
  await agentLoader.loadDefaultAgent();

  const authStorage = AuthStorage.create(path.join(paths.sharedPiAgentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(paths.sharedPiAgentDir, "models.json"));

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

  const bot = createTelegramBot({
    token: telegramToken,
    service,
    pageSize: rootConfig.telegram.pageSize,
    flowTtlMs: rootConfig.telegram.flowTtlSeconds * 1000,
    typingIntervalMs: rootConfig.telegram.typingIntervalMs,
  });

  await bot.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 5: Run the Telegram adapter tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/integration/onboarding.test.ts tests/integration/telegram-flows.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/familyos/src/telegram/keyboards.ts services/familyos/src/telegram/updates.ts services/familyos/src/telegram/router.ts services/familyos/src/telegram/bot.ts services/familyos/src/main.ts services/familyos/tests/helpers/fake-telegram.ts services/familyos/tests/integration/onboarding.test.ts services/familyos/tests/integration/telegram-flows.test.ts
git commit -m "feat(familyos): add telegram adapter and command flows"
```

---

### Task 11: Add operator docs and run the full verification suite

**Files:**
- Create: `services/familyos/README.md`

- [ ] **Step 1: Write the operator README**

Create `services/familyos/README.md`:

````markdown
# FamilyOS Service

Telegram-first FamilyOS MVP built on the Pi SDK.

## Run from this repository

```bash
cd services/familyos
npm install
export TELEGRAM_BOT_TOKEN=123456:replace-me
npm start
```

The service discovers the FamilyOS root by walking upward until it finds `config/familyos.json`.

## Runtime directories

FamilyOS uses the repository root for runtime assets and data:

- `config/familyos.json` — root FamilyOS config
- `agents/default/` — shipped default agent bundle
- `users/<slug>/user.json` — manual registration manifests
- `users/<slug>/state.json` — persisted active session + active agent
- `users/<slug>/home/` — user workspace root
- `logs/audit.jsonl` — append-only audit log
- `.familyos-pi/` — shared Pi auth, models, settings, and session store

## Manual registration

Create `users/<slug>/user.json` before the person can use the bot:

```json
{
  "id": "martin",
  "displayName": "Martin",
  "channels": {
    "telegram": {
      "userIds": ["123456789"]
    }
  }
}
```

FamilyOS lazily scaffolds the rest of the user home on first successful use.

## Verification

```bash
cd services/familyos
npm run test
npm run typecheck
```
````

- [ ] **Step 2: Run the full suite**

Run: `cd services/familyos && npm run test && npm run typecheck`
Expected: PASS — all unit and integration tests green, no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add services/familyos/README.md
git commit -m "docs(familyos): add operator runbook"
```

---

## Spec Coverage Check

- Identity and onboarding: Tasks 3, 8, 10, 11
- Filesystem layout and scaffolding: Tasks 1, 2, 3, 11
- Config layering and agent replacement rules: Task 4
- Security boundary and no-bash enforcement: Tasks 5 and 6
- Session lifecycle, runtime replacement, and user isolation: Tasks 6, 7, and 8
- Telegram command UX and flow expiry: Tasks 7, 9, and 10
- Attachments and typing indicator behavior: Tasks 8, 9, and 10
- Audit logging and bootstrap requirements: Tasks 2, 6, 8, and 11

This plan stays within the single cohesive subsystem described by the spec, so one implementation plan is appropriate.
