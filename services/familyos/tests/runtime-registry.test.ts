import fs from "node:fs/promises";
import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createAuditLog } from "../src/audit-log";
import { AgentLoader } from "../src/config/agent-loader";
import { StateStore } from "../src/identity/state-store";
import { UserStore } from "../src/identity/user-store";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { extractCarryForwardSummary, isRuntimeHandleIdle, UserRuntimeRegistry } from "../src/pi/runtime-registry";
import { createTempRoot } from "./helpers/temp-root";

describe("isRuntimeHandleIdle", () => {
  it("requires both an empty queue and a non-streaming session", () => {
    expect(isRuntimeHandleIdle(undefined as any)).toBe(true);
    expect(
      isRuntimeHandleIdle({ pendingOperations: 1, runtime: { session: { isStreaming: false } } } as any),
    ).toBe(false);
    expect(
      isRuntimeHandleIdle({ pendingOperations: 0, runtime: { session: { isStreaming: true } } } as any),
    ).toBe(false);
    expect(
      isRuntimeHandleIdle({ pendingOperations: 0, runtime: { session: { isStreaming: false } } } as any),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration-level regression helpers
// ---------------------------------------------------------------------------

async function createRegistryFixture() {
  const temp = await createTempRoot(); // creates rootDir + default agent
  const rootConfig = {
    defaultAgentId: "default",
    sharedPiAgentDir: ".familyos-pi",
    telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
  };
  const paths = buildFamilyOSPaths(temp.rootDir, rootConfig);

  // Second agent used by agent-switch tests
  await fs.mkdir(path.join(paths.agentsDir, "sam"), { recursive: true });
  await fs.writeFile(path.join(paths.agentsDir, "sam", "SOUL.md"), "You are Sam.");
  await fs.writeFile(
    path.join(paths.agentsDir, "sam", "agent.json"),
    JSON.stringify({
      id: "sam",
      displayName: "Sam",
      capabilities: { tools: [], readRoots: [], writeRoots: [] },
    }),
  );

  const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });
  await fs.mkdir(path.dirname(user.manifestPath), { recursive: true });
  await fs.writeFile(
    user.manifestPath,
    JSON.stringify({
      id: "martin",
      displayName: "Martin",
      channels: { telegram: { userIds: ["123"] } },
    }),
  );

  const authStorage = AuthStorage.create(path.join(paths.sharedPiAgentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(paths.sharedPiAgentDir, "models.json"));
  const agentLoader = new AgentLoader(paths, rootConfig);
  const stateStore = new StateStore();
  const userStore = new UserStore(paths);
  const audit = createAuditLog(paths.auditLogPath);

  const registry = new UserRuntimeRegistry({
    paths,
    rootConfig,
    userStore,
    stateStore,
    agentLoader,
    authStorage,
    modelRegistry,
    audit,
  });

  return { temp, paths, user, agentLoader, stateStore, registry, audit };
}

describe("UserRuntimeRegistry", () => {
  it("propagates updated agentId to factory after switchAgent(start_fresh)", async () => {
    const { temp, user, agentLoader, registry, audit } = await createRegistryFixture();
    try {
      await registry.ensureRuntime(user);
      const spy = vi.spyOn(agentLoader, "loadAgent");
      await registry.switchAgent(user, "sam", "start_fresh");
      expect(spy).toHaveBeenCalledWith("sam", user);
    } finally {
      await audit.close();
      await temp.cleanup();
    }
  });

  it("propagates updated agentId to factory after switchAgent(continue_session)", async () => {
    const { temp, user, agentLoader, registry, audit } = await createRegistryFixture();
    try {
      await registry.ensureRuntime(user);
      const spy = vi.spyOn(agentLoader, "loadAgent");
      await registry.switchAgent(user, "sam", "continue_session");
      expect(spy).toHaveBeenCalledWith("sam", user);
    } finally {
      await audit.close();
      await temp.cleanup();
    }
  });

  it("falls back to defaultAgentId when persisted activeAgentId bundle is missing", async () => {
    const { temp, user, stateStore, agentLoader, registry, audit } = await createRegistryFixture();
    try {
      // Pre-write state with a non-existent agent so ensureRuntime must fall back
      await stateStore.write(user, { activeAgentId: "ghost" });
      const spy = vi.spyOn(agentLoader, "loadAgent");
      await registry.ensureRuntime(user);
      const calledWith = spy.mock.calls.map((c) => c[0]);
      // Validation attempt fires for "ghost" (may throw), then succeeds for "default"
      expect(calledWith).toContain("ghost");
      expect(calledWith).toContain("default");
    } finally {
      await audit.close();
      await temp.cleanup();
    }
  });
});

describe("extractCarryForwardSummary", () => {
  it("throws the summarizer error when Pi cannot produce a branch summary", () => {
    expect(() => extractCarryForwardSummary({ error: "summary failed" } as any)).toThrow("summary failed");
  });

  it("throws when Pi returns no summary text", () => {
    expect(() => extractCarryForwardSummary({ summary: "" } as any)).toThrow(
      "Could not generate a carry-forward summary.",
    );
  });
});
