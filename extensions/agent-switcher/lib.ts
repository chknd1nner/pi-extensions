import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Pure + fs helpers for the /agent switcher. Kept separate from index.ts so the
 * logic is unit-testable without a live Pi runtime.
 */

export type Scope = "project" | "home";

export interface Agent {
  name: string; // file basename without .md
  file: string; // filename (e.g. "pyrite.md")
  absPath: string; // absolute path to the agent .md
  scope: Scope;
  desc?: string; // optional one-line description from agents.json
}

export const DEFAULT_NAME = "default";

/**
 * Files that must never be offered as agents. SYSTEM.md is the symlink itself;
 * APPEND_SYSTEM.md is Pi's append-prompt file; agents.json is our sidecar.
 */
export const EXCLUDE = new Set(["SYSTEM.md", "APPEND_SYSTEM.md"]);

export const MANIFEST_FILE = "agents.json";

export function agentDirs(cwd: string, home: string = os.homedir()): Array<{ dir: string; scope: Scope }> {
  return [
    { dir: path.join(cwd, ".pi", "agents"), scope: "project" },
    { dir: path.join(home, ".pi", "agent", "agents"), scope: "home" },
  ];
}

export function systemPath(cwd: string): string {
  return path.join(cwd, ".pi", "SYSTEM.md");
}

/**
 * Load an optional sidecar manifest mapping agent name -> { desc }.
 * The manifest is NEVER read by Pi into the system prompt; only this extension
 * reads it, which is why descriptions can live here instead of in frontmatter
 * (frontmatter inside a linked .md would leak into the prompt verbatim).
 * Malformed JSON is tolerated and yields an empty map.
 */
export function loadManifest(dir: string): Record<string, { desc?: string }> {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, { desc?: string }>;
    }
  } catch {
    /* missing or malformed — fine */
  }
  return {};
}

export function discover(cwd: string, home: string = os.homedir()): Agent[] {
  const out: Agent[] = [];
  for (const { dir, scope } of agentDirs(cwd, home)) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue; // dir doesn't exist — fine
    }
    const manifest = loadManifest(dir);
    for (const file of entries) {
      if (!file.endsWith(".md")) continue;
      if (file.startsWith(".") || EXCLUDE.has(file)) continue;
      const absPath = path.join(dir, file);
      try {
        if (!fs.statSync(absPath).isFile()) continue;
      } catch {
        continue;
      }
      const name = file.slice(0, -3);
      const desc = manifest[name]?.desc;
      out.push({ name, file, absPath, scope, desc });
    }
  }
  out.sort((a, b) =>
    a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "project" ? -1 : 1,
  );
  return out;
}

export type SystemState =
  | { kind: "none" } // no SYSTEM.md => built-in default is active
  | { kind: "agent"; target: string } // symlink => resolved absolute target
  | { kind: "file" }; // a real (unmanaged) file lives there

export function systemState(cwd: string): SystemState {
  const sys = systemPath(cwd);
  try {
    const lst = fs.lstatSync(sys);
    if (lst.isSymbolicLink()) {
      try {
        return { kind: "agent", target: fs.realpathSync(sys) };
      } catch {
        // dangling symlink — resolve the recorded target without following
        return {
          kind: "agent",
          target: path.resolve(path.dirname(sys), fs.readlinkSync(sys)),
        };
      }
    }
    return { kind: "file" };
  } catch {
    return { kind: "none" };
  }
}

/** Symlink target for an agent: relative for project (repo-portable), absolute for home. */
export function computeTarget(piDir: string, agent: Agent): string {
  return agent.scope === "project" ? path.relative(piDir, agent.absPath) : agent.absPath;
}

/** Back up a real SYSTEM.md file (if present) before we replace/remove it. */
export function backupIfRealFile(sys: string): string | null {
  try {
    const lst = fs.lstatSync(sys);
    if (!lst.isSymbolicLink() && lst.isFile()) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = `${sys}.bak-${stamp}`;
      fs.copyFileSync(sys, backup);
      return backup;
    }
  } catch {
    /* nothing there */
  }
  return null;
}

/** Point SYSTEM.md at an agent (atomic temp-symlink + rename). */
export function pointAt(cwd: string, agent: Agent): { target: string; backedUp: string | null } {
  const sys = systemPath(cwd);
  const piDir = path.dirname(sys);
  fs.mkdirSync(piDir, { recursive: true });

  const backedUp = backupIfRealFile(sys);
  const target = computeTarget(piDir, agent);

  const tmp = path.join(piDir, `.SYSTEM.md.swap-${process.pid}-${Date.now()}`);
  try {
    fs.symlinkSync(target, tmp);
    fs.renameSync(tmp, sys); // atomic on same fs; replaces symlink or file
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw e;
  }
  return { target, backedUp };
}

/** Remove SYSTEM.md so the harness falls through to its built-in default. */
export function clearSystem(cwd: string): { removed: boolean; backedUp: string | null } {
  const sys = systemPath(cwd);
  const state = systemState(cwd);
  if (state.kind === "none") return { removed: false, backedUp: null };

  const backedUp = state.kind === "file" ? backupIfRealFile(sys) : null;
  fs.rmSync(sys, { force: true }); // unlinks a symlink or a file
  return { removed: true, backedUp };
}

export function formatAgentLabel(a: Agent, active: boolean): string {
  const marker = active ? "●" : "○";
  const tail = a.desc ? `  — ${a.desc}` : "";
  return `${marker} ${a.name.padEnd(14)} (${a.scope})${tail}`;
}

export function formatDefaultLabel(active: boolean): string {
  const marker = active ? "●" : "○";
  return `${marker} ${DEFAULT_NAME.padEnd(14)} (built-in — no SYSTEM.md)`;
}
