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

  it("denies root-level workspace symlink escapes", async () => {
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

    const policy = new PathPolicy(user, {
      id: "default",
      displayName: "FamilyOS Assistant",
      soul: "You are FamilyOS.",
      sourceDir: path.join(temp.rootDir, "agents", "default"),
      capabilities: {
        tools: ["read", "grep", "find", "ls"],
        readRoots: ["Workspace"],
        writeRoots: ["Workspace"],
      },
    });

    await expect(policy.resolveReadable("Workspace/secret.txt")).rejects.toThrow("outside allowed read roots");
    await temp.cleanup();
  });

  it("denies control-plane paths even if agent roots are overbroad", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(path.dirname(user.piSettingsPath), { recursive: true });
    await fs.writeFile(path.join(path.dirname(user.piSettingsPath), "secret.txt"), "blocked");

    const policy = new PathPolicy(user, {
      id: "default",
      displayName: "FamilyOS Assistant",
      soul: "You are FamilyOS.",
      sourceDir: path.join(temp.rootDir, "agents", "default"),
      capabilities: {
        tools: ["read", "write"],
        readRoots: [".pi", "Workspace"],
        writeRoots: [".familyos", "Workspace"],
      },
    });

    await expect(policy.resolveReadable(".pi/secret.txt")).rejects.toThrow("outside allowed read roots");
    await expect(policy.resolveWritable(".familyos/settings.json")).rejects.toThrow("outside allowed write roots");
    await temp.cleanup();
  });
});
