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

  it("returns a safe denial result for hidden user settings", async () => {
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
    const result = await readTool.execute("call-1", { path: ".pi/secret.txt" }, undefined, undefined, undefined as any);

    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as any).text).toContain("Access denied");
    await temp.cleanup();
  });

  it("denies control-plane reads outside the user workspace roots", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(paths.configDir, { recursive: true });
    await fs.writeFile(path.join(paths.configDir, "familyos.json"), JSON.stringify({ secret: "bot-token" }, null, 2));

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
    const result = await readTool.execute(
      "call-2",
      { path: path.relative(user.homeDir, path.join(paths.configDir, "familyos.json")) },
      undefined,
      undefined,
      undefined as any,
    );

    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as any).text).toContain("Access denied");
    await temp.cleanup();
  });

  it("denies hidden settings paths even if the agent root manifest is overbroad", async () => {
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
          readRoots: [".pi", "Workspace"],
          writeRoots: ["Workspace"],
        },
      },
      vi.fn(),
    );

    const readTool = tools[0]!;
    const result = await readTool.execute("call-3", { path: ".pi/secret.txt" }, undefined, undefined, undefined as any);

    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as any).text).toContain("Access denied");
    await temp.cleanup();
  });

  it("returns safe denials when Workspace is a symlink outside the home", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    const escapedDir = path.join(temp.rootDir, "outside-home");
    await fs.mkdir(escapedDir, { recursive: true });
    await fs.writeFile(path.join(escapedDir, "secret.txt"), "outside");
    await fs.mkdir(path.dirname(user.workspaceDir), { recursive: true });
    await fs.symlink(escapedDir, user.workspaceDir);

    const tools = buildGuardedToolDefinitions(
      user,
      {
        id: "default",
        displayName: "FamilyOS Assistant",
        soul: "You are FamilyOS.",
        sourceDir: path.join(temp.rootDir, "agents", "default"),
        capabilities: {
          tools: ["read"],
          readRoots: ["Workspace"],
          writeRoots: ["Workspace"],
        },
      },
      vi.fn(),
    );

    const readTool = tools[0]!;
    const result = await readTool.execute("call-4", { path: "Workspace/secret.txt" }, undefined, undefined, undefined as any);

    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as any).text).toContain("Access denied");
    await temp.cleanup();
  });
});
