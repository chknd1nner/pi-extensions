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
