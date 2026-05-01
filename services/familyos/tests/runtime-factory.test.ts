import fs from "node:fs/promises";
import path from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  createAgentSessionRuntime,
} from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createAuditLog } from "../src/audit-log";
import { AgentLoader } from "../src/config/agent-loader";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { HANDOFF_PROMPT, OneShotHandoff } from "../src/pi/handoff";
import { createInitialSessionManager, createUserRuntimeFactory } from "../src/pi/runtime-factory";
import { getSharedSessionDir } from "../src/pi/session-paths";
import { createTempRoot } from "./helpers/temp-root";

async function createRuntimeFixture() {
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
          tools: ["read", "ls"],
          readRoots: ["Inbox", "Workspace", "Exports"],
          writeRoots: ["Workspace", "Exports"],
        },
      },
      null,
      2,
    ),
  );

  const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });
  await fs.mkdir(path.dirname(user.manifestPath), { recursive: true });
  await fs.writeFile(
    user.manifestPath,
    JSON.stringify(
      {
        id: "martin",
        displayName: "Martin",
        channels: { telegram: { userIds: ["123"] } },
      },
      null,
      2,
    ),
  );
  await fs.mkdir(user.homeDir, { recursive: true });

  const authStorage = AuthStorage.create(path.join(paths.sharedPiAgentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(paths.sharedPiAgentDir, "models.json"));
  const agentLoader = new AgentLoader(paths, rootConfig);
  const audit = createAuditLog(paths.auditLogPath);
  const handoff = new OneShotHandoff();
  const onEvent = vi.fn();

  const runtime = await createAgentSessionRuntime(
    createUserRuntimeFactory({
      paths,
      rootConfig,
      user,
      agentLoader,
      authStorage,
      modelRegistry,
      handoff,
      audit,
      getActiveAgentId: () => "default",
      onEvent,
    }),
    {
      cwd: user.homeDir,
      agentDir: paths.sharedPiAgentDir,
      sessionManager: await createInitialSessionManager(paths, user, undefined),
    },
  );

  await runtime.session.bindExtensions({});

  return { temp, paths, user, audit, handoff, runtime, onEvent };
}

describe("createUserRuntimeFactory", () => {
  it("loads only approved same-name custom tools and builds a deterministic system prompt", async () => {
    const fixture = await createRuntimeFixture();

    try {
      const toolNames = fixture.runtime.session.getAllTools().map((tool) => tool.name);
      expect(toolNames).toEqual(["read", "ls"]);
      expect(toolNames).not.toContain("bash");

      const systemPrompt = fixture.runtime.session.extensionRunner.createContext().getSystemPrompt();
      expect(systemPrompt).toContain("You are FamilyOS.");
      expect(systemPrompt).toContain("Read files inside Inbox, Workspace, or Exports.");
      expect(systemPrompt).toContain("Use ls only inside readable workspace roots.");

      expect(fixture.runtime.session.sessionFile?.startsWith(getSharedSessionDir(fixture.user.homeDir, fixture.paths.sharedPiAgentDir))).toBe(true);
    } finally {
      await fixture.audit.close();
      await fixture.temp.cleanup();
    }
  });

  it("rebinds extensions after newSession so handoff and audit hooks still execute", async () => {
    const fixture = await createRuntimeFixture();

    try {
      fixture.runtime.setRebindSession(async (session) => {
        await session.bindExtensions({});
      });

      const payload = {
        system: [{ type: "text", text: "persona", cache_control: { type: "ephemeral" } }],
        messages: [],
      };

      fixture.handoff.arm(HANDOFF_PROMPT);
      const firstPayload = await fixture.runtime.session.extensionRunner.emitBeforeProviderRequest(payload);
      expect((firstPayload as any).system.at(-1)).toEqual({ type: "text", text: HANDOFF_PROMPT });
      await fixture.runtime.session.extensionRunner.emit({ type: "agent_start" });
      expect(fixture.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent_start", userSlug: "martin" }));

      const firstSessionFile = fixture.runtime.session.sessionFile;
      await fixture.runtime.newSession();
      expect(fixture.runtime.session.sessionFile).not.toBe(firstSessionFile);

      fixture.handoff.arm(HANDOFF_PROMPT);
      const secondPayload = await fixture.runtime.session.extensionRunner.emitBeforeProviderRequest(payload);
      expect((secondPayload as any).system.at(-1)).toEqual({ type: "text", text: HANDOFF_PROMPT });
      await fixture.runtime.session.extensionRunner.emit({ type: "agent_start" });
      expect(fixture.onEvent).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.audit.close();
      await fixture.temp.cleanup();
    }
  });
});
