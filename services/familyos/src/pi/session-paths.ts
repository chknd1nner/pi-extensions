import path from "node:path";

export function encodeSessionCwd(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function getSharedSessionDir(cwd: string, agentDir: string) {
  return path.join(agentDir, "sessions", encodeSessionCwd(cwd));
}
