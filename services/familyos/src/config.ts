import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "./json-file.js";
import { buildFamilyOSPaths, resolveFamilyOSRoot } from "./paths.js";
import type { FamilyOSPaths, FamilyOSRootConfig } from "./types.js";

export interface BootstrapConfig {
  telegramToken: string;
  rootConfig: FamilyOSRootConfig;
  paths: FamilyOSPaths;
}

export const DEFAULT_ROOT_CONFIG: FamilyOSRootConfig = {
  defaultAgentId: "default",
  sharedPiAgentDir: ".familyos-pi",
  telegram: {
    flowTtlSeconds: 900,
    typingIntervalMs: 4000,
    pageSize: 8,
  },
};

export async function loadBootstrapConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<BootstrapConfig> {
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const rootDir = await resolveFamilyOSRoot(cwd, env);
  const configPath = path.join(rootDir, "config", "familyos.json");
  const rootConfig = await readJsonFile(configPath, DEFAULT_ROOT_CONFIG);
  const paths = buildFamilyOSPaths(rootDir, rootConfig);

  await fs.mkdir(paths.logsDir, { recursive: true });
  await fs.mkdir(paths.sharedPiAgentDir, { recursive: true });

  return {
    telegramToken,
    rootConfig,
    paths,
  };
}
