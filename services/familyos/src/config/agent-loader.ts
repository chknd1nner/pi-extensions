import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentManifest,
  FamilyOSPaths,
  FamilyOSRootConfig,
  ResolvedAgent,
  ResolvedUser,
  ToolName,
} from "../types.js";

const ALLOWED_TOOLS = new Set<ToolName>(["read", "write", "edit", "grep", "find", "ls"]);
const ALLOWED_WORKSPACE_ROOTS = new Set(["Inbox", "Workspace", "Exports"]);

type AgentManifestJson = {
  id: string;
  displayName: string;
  capabilities: {
    tools: string[];
    readRoots: string[];
    writeRoots: string[];
  };
};

async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function validateCapabilityRoot(agentId: string, relativePath: string): string {
  const posixPath = relativePath.replaceAll("\\", "/");
  const rawSegments = posixPath.split("/").filter((segment) => segment.length > 0);

  if (path.posix.isAbsolute(posixPath) || rawSegments.includes("..")) {
    throw new Error(
      `Agent "${agentId}" is invalid: root paths must be relative to the user's home and stay within Inbox, Workspace, or Exports.`,
    );
  }

  const normalizedPath = path.posix.normalize(posixPath);
  const topLevelRoot = normalizedPath.split("/")[0];

  if (!ALLOWED_WORKSPACE_ROOTS.has(topLevelRoot)) {
    throw new Error(
      `Agent "${agentId}" is invalid: root paths must stay within Inbox, Workspace, or Exports in MVP.`,
    );
  }

  return normalizedPath;
}

function validateManifest(manifest: AgentManifestJson): AgentManifest {
  const tools: ToolName[] = [];

  for (const tool of manifest.capabilities.tools) {
    if (tool === "bash") {
      throw new Error(`Agent "${manifest.id}" is invalid: bash is not allowed in MVP.`);
    }

    if (!ALLOWED_TOOLS.has(tool as ToolName)) {
      throw new Error(`Agent "${manifest.id}" is invalid: Unknown tool name "${tool}".`);
    }

    tools.push(tool as ToolName);
  }

  const readRoots = manifest.capabilities.readRoots.map((relativePath) =>
    validateCapabilityRoot(manifest.id, relativePath),
  );
  const writeRoots = manifest.capabilities.writeRoots.map((relativePath) =>
    validateCapabilityRoot(manifest.id, relativePath),
  );

  return {
    id: manifest.id,
    displayName: manifest.displayName,
    capabilities: {
      tools,
      readRoots,
      writeRoots,
    },
  };
}

async function loadBundle(bundleDir: string): Promise<ResolvedAgent> {
  const rawManifest = JSON.parse(
    await fs.readFile(path.join(bundleDir, "agent.json"), "utf8"),
  ) as AgentManifestJson;
  const manifest = validateManifest(rawManifest);
  const soul = await fs.readFile(path.join(bundleDir, "SOUL.md"), "utf8");

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

  private userAgentDir(user?: ResolvedUser): string | undefined {
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
