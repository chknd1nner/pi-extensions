import { randomUUID } from "node:crypto";

export interface SnapshotSessionManager {
  getBranch(fromId?: string): object[];
}

export function buildSessionSnapshot(
  sessionManager: SnapshotSessionManager,
  workerCwd: string,
  anchorEntryId: string | null,
): string {
  const header = {
    type: "session",
    version: 3,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: workerCwd,
  };

  const lines: string[] = [JSON.stringify(header)];

  if (anchorEntryId !== null) {
    for (const entry of sessionManager.getBranch(anchorEntryId)) {
      lines.push(JSON.stringify(entry));
    }
  }

  return `${lines.join("\n")}\n`;
}
