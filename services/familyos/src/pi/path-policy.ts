import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedAgent, ResolvedUser } from "../types.js";

const WORKSPACE_ROOT_NAMES = ["Inbox", "Workspace", "Exports"] as const;
const WORKSPACE_ROOT_NAME_SET = new Set<string>(WORKSPACE_ROOT_NAMES);
const PROTECTED_HOME_ROOTS = new Set([".pi", ".familyos"]);

type WorkspaceRootName = (typeof WORKSPACE_ROOT_NAMES)[number];

function isInside(target: string, root: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function topLevelSegment(relativePath: string): string | undefined {
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (normalized === "." || normalized.length === 0) return undefined;
  return normalized.split("/").filter((segment) => segment.length > 0)[0];
}

function isProtectedHomePath(targetPath: string, canonicalHomeDir: string): boolean {
  const relativeToHome = path.relative(canonicalHomeDir, targetPath);
  if (relativeToHome === "" || relativeToHome.startsWith("..") || path.isAbsolute(relativeToHome)) {
    return false;
  }

  const topLevel = relativeToHome.split(path.sep)[0];
  return PROTECTED_HOME_ROOTS.has(topLevel);
}

async function resolveThroughExistingAncestor(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }

    const missingSegments: string[] = [];
    let current = target;

    while (true) {
      const parent = path.dirname(current);
      if (parent === current) {
        throw error;
      }

      missingSegments.unshift(path.basename(current));
      current = parent;

      try {
        const realAncestor = await fs.realpath(current);
        return path.join(realAncestor, ...missingSegments);
      } catch (ancestorError: any) {
        if (ancestorError?.code !== "ENOENT") {
          throw ancestorError;
        }
      }
    }
  }
}

export class PathPolicy {
  private readonly canonicalHomeDir: Promise<string>;
  private readonly canonicalWorkspaceRoots: Promise<Map<WorkspaceRootName, string>>;
  private readonly readableRoots: Promise<string[]>;
  private readonly writableRoots: Promise<string[]>;

  constructor(
    private readonly user: ResolvedUser,
    private readonly agent: ResolvedAgent,
  ) {
    this.canonicalHomeDir = resolveThroughExistingAncestor(this.user.homeDir);
    this.canonicalWorkspaceRoots = this.buildCanonicalWorkspaceRoots();
    this.readableRoots = this.resolveAllowedRoots(this.agent.capabilities.readRoots);
    this.writableRoots = this.resolveAllowedRoots(this.agent.capabilities.writeRoots);
  }

  private async buildCanonicalWorkspaceRoots(): Promise<Map<WorkspaceRootName, string>> {
    const canonicalHomeDir = await this.canonicalHomeDir;
    const roots = new Map<WorkspaceRootName, string>();

    for (const rootName of WORKSPACE_ROOT_NAMES) {
      const workspaceRoot = path.resolve(this.user.homeDir, rootName);
      const canonicalWorkspaceRoot = await resolveThroughExistingAncestor(workspaceRoot);

      // Defensive boundary: if a root itself resolves outside the home dir (e.g. root-level symlink),
      // treat it as unavailable rather than trusting it.
      if (isInside(canonicalWorkspaceRoot, canonicalHomeDir)) {
        roots.set(rootName, canonicalWorkspaceRoot);
      }
    }

    return roots;
  }

  private async resolveAllowedRoots(agentRoots: string[]): Promise<string[]> {
    const canonicalWorkspaceRoots = await this.canonicalWorkspaceRoots;
    const allowedRoots = new Set<string>();

    for (const relativeRoot of agentRoots) {
      const topLevelRoot = topLevelSegment(relativeRoot);
      if (!topLevelRoot || !WORKSPACE_ROOT_NAME_SET.has(topLevelRoot)) {
        continue;
      }

      const canonicalWorkspaceRoot = canonicalWorkspaceRoots.get(topLevelRoot as WorkspaceRootName);
      if (!canonicalWorkspaceRoot) {
        continue;
      }

      const absoluteRoot = path.resolve(this.user.homeDir, relativeRoot);
      const canonicalRoot = await resolveThroughExistingAncestor(absoluteRoot);

      // Defensive boundary: keep the manifest root anchored inside the matching
      // canonical workspace root so symlinked sub-roots cannot escape.
      if (isInside(canonicalRoot, canonicalWorkspaceRoot)) {
        allowedRoots.add(canonicalRoot);
      }
    }

    return [...allowedRoots];
  }

  private async resolvePathAgainstRoots(
    inputPath: string,
    allowedRootsPromise: Promise<string[]>,
    accessKind: "read" | "write",
  ): Promise<string> {
    const canonicalHomeDir = await this.canonicalHomeDir;
    const candidatePath = path.resolve(this.user.homeDir, inputPath);
    const canonicalPath = await resolveThroughExistingAncestor(candidatePath);

    if (isProtectedHomePath(canonicalPath, canonicalHomeDir)) {
      throw new Error(`Path "${inputPath}" is outside allowed ${accessKind} roots.`);
    }

    const allowedRoots = await allowedRootsPromise;
    if (!allowedRoots.some((root) => isInside(canonicalPath, root))) {
      throw new Error(`Path "${inputPath}" is outside allowed ${accessKind} roots.`);
    }

    return canonicalPath;
  }

  async resolveReadable(inputPath: string): Promise<string> {
    return this.resolvePathAgainstRoots(inputPath, this.readableRoots, "read");
  }

  async resolveSearchRoot(inputPath?: string): Promise<string> {
    return this.resolveReadable(inputPath ?? "Workspace");
  }

  async resolveWritable(inputPath: string): Promise<string> {
    return this.resolvePathAgainstRoots(inputPath, this.writableRoots, "write");
  }
}
