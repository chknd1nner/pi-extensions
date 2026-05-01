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

    const loader = new AgentLoader(paths, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
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
    await fs.writeFile(
      path.join(path.dirname(user.familySettingsPath), "agents", "default", "SOUL.md"),
      "You are Martin's chat-only assistant.",
    );

    const loader = new AgentLoader(paths, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
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

    const loader = new AgentLoader(paths, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await expect(loader.loadAgent("broken")).rejects.toThrow(/Unknown tool name|bash is not allowed/i);
    await temp.cleanup();
  });

  it.each([
    {
      label: ".pi read root",
      readRoots: [".pi"],
      writeRoots: ["Workspace"],
    },
    {
      label: ".familyos write root",
      readRoots: ["Workspace"],
      writeRoots: [".familyos"],
    },
    {
      label: "other non-workspace root",
      readRoots: ["Secrets"],
      writeRoots: ["Workspace"],
    },
  ])("rejects capability roots outside the MVP workspace roots: $label", async ({ readRoots, writeRoots }) => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.agentsDir, "invalid-roots"), { recursive: true });
    await fs.writeFile(path.join(paths.agentsDir, "invalid-roots", "SOUL.md"), "Invalid roots");
    await fs.writeFile(
      path.join(paths.agentsDir, "invalid-roots", "agent.json"),
      JSON.stringify(
        {
          id: "invalid-roots",
          displayName: "Invalid roots",
          capabilities: {
            tools: ["read"],
            readRoots,
            writeRoots,
          },
        },
        null,
        2,
      ),
    );

    const loader = new AgentLoader(paths, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await expect(loader.loadAgent("invalid-roots")).rejects.toThrow(/Inbox, Workspace, or Exports/i);
    await temp.cleanup();
  });
});
