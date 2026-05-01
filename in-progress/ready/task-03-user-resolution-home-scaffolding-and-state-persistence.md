---
task_number: 3
title: Implement user resolution, manual registration lookup, home scaffolding, and state persistence
status: Ready for implementation
lane: ready
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are implementing Task 3 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket:
  - Ticket: in-progress/ready/task-03-user-resolution-home-scaffolding-and-state-persistence.md
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
  You are reviewing Task 3 from the FamilyOS Telegram MVP implementation plan.

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

# Task 03 — Implement user resolution, manual registration lookup, home scaffolding, and state persistence

## Plan excerpt


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
