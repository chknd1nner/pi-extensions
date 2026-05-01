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
      const martin = await service.resolveRegisteredUser({
        channel: "telegram",
        externalUserId: "101",
        chatId: "101",
      });
      const alice = await service.resolveRegisteredUser({
        channel: "telegram",
        externalUserId: "202",
        chatId: "202",
      });

      if (!martin || !alice) throw new Error("Expected both users to resolve");

      const martinRuntime = await runtimeRegistry.ensureRuntime(martin);
      const aliceRuntime = await runtimeRegistry.ensureRuntime(alice);

      expect(martinRuntime.cwd).toBe(martin.homeDir);
      expect(aliceRuntime.cwd).toBe(alice.homeDir);
      expect(martinRuntime.cwd).not.toBe(aliceRuntime.cwd);
      expect(martinRuntime.session.sessionFile).not.toBe(aliceRuntime.session.sessionFile);
      expect(
        martinRuntime.session.sessionFile?.startsWith(getSharedSessionDir(martin.homeDir, paths.sharedPiAgentDir)),
      ).toBe(true);
      expect(
        aliceRuntime.session.sessionFile?.startsWith(getSharedSessionDir(alice.homeDir, paths.sharedPiAgentDir)),
      ).toBe(true);
    } finally {
      await audit.close();
      await temp.cleanup();
    }
  });
});
