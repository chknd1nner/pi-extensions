import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempRoot() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-"));

  await fs.mkdir(path.join(rootDir, "config"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "agents", "default"), { recursive: true });

  await fs.writeFile(
    path.join(rootDir, "config", "familyos.json"),
    JSON.stringify(
      {
        defaultAgentId: "default",
        sharedPiAgentDir: ".familyos-pi",
        telegram: {
          flowTtlSeconds: 900,
          typingIntervalMs: 4000,
          pageSize: 8,
        },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(rootDir, "agents", "default", "agent.json"),
    JSON.stringify(
      {
        id: "default",
        displayName: "FamilyOS Assistant",
        capabilities: {
          tools: ["read", "grep", "find", "ls"],
          readRoots: ["Inbox", "Workspace", "Exports"],
          writeRoots: ["Workspace", "Exports"],
        },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(path.join(rootDir, "agents", "default", "SOUL.md"), "You are FamilyOS.");

  return {
    rootDir,
    cleanup: () => fs.rm(rootDir, { recursive: true, force: true }),
  };
}
