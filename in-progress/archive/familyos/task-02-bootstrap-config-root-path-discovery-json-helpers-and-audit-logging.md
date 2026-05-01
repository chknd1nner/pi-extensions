---
task_number: 2
title: Add bootstrap config, root-path discovery, atomic JSON helpers, and audit logging
status: Done
lane: done
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
approval_note: |-
  Approved in review on 2026-05-01. The bootstrap config loader, root discovery helpers, atomic JSON helpers, and audit log support match the Task 2 plan scope, and fresh verification succeeded with `cd services/familyos && npx vitest run tests/config.test.ts tests/json-file.test.ts && npm run typecheck`.
review_prompt_template: |-
  You are reviewing Task 2 from the FamilyOS Telegram MVP implementation plan.

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

# Task 02 — Add bootstrap config, root-path discovery, atomic JSON helpers, and audit logging

## Plan excerpt


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

## Notes

- Verification run:
  - `cd services/familyos && npx vitest run tests/config.test.ts tests/json-file.test.ts`
  - `cd services/familyos && npx vitest run tests/config.test.ts tests/json-file.test.ts && npm run typecheck`
- Follow-up concerns:
  - Adjusted `createAuditLog` stream `end` callback typing to satisfy strict TypeScript (`noImplicitAny`) while preserving planned behavior.
