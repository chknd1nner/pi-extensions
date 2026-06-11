import { randomUUID } from "node:crypto";

export interface SnapshotSessionManager {
  getBranch(fromId?: string): object[];
}

export function buildSessionSnapshot(
  sessionManager: SnapshotSessionManager | null,
  workerCwd: string,
  anchorEntryId: string | null,
  packEntries: object[] = [],
): string {
  const header = {
    type: "session",
    version: 3,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: workerCwd,
  };

  const lines: string[] = [JSON.stringify(header)];
  let leafId: string | null = null;

  if (sessionManager !== null && anchorEntryId !== null) {
    for (const entry of sessionManager.getBranch(anchorEntryId)) {
      lines.push(JSON.stringify(entry));
      const id = (entry as { id?: unknown }).id;
      if (typeof id === "string") {
        leafId = id;
      }
    }
  }

  let parentId: string | null = leafId;
  for (const entry of packEntries) {
    const id = randomUUID().slice(0, 8);
    const rewritten = { ...(entry as Record<string, unknown>), id, parentId };
    lines.push(JSON.stringify(rewritten));
    parentId = id;
  }

  return `${lines.join("\n")}\n`;
}
