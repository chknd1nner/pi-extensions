import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { createAuditLog } from "./audit-log.js";
import { loadBootstrapConfig } from "./config.js";
import { AgentLoader } from "./config/agent-loader.js";
import { FamilyOSService } from "./core/familyos-service.js";
import { StateStore } from "./identity/state-store.js";
import { UserStore } from "./identity/user-store.js";
import { UserRuntimeRegistry } from "./pi/runtime-registry.js";
import { createTelegramBot } from "./telegram/bot.js";

export async function main() {
  const { telegramToken, rootConfig, paths } = await loadBootstrapConfig();
  const audit = createAuditLog(paths.auditLogPath);
  const userStore = new UserStore(paths);
  const stateStore = new StateStore();
  const agentLoader = new AgentLoader(paths, rootConfig);
  await agentLoader.loadDefaultAgent();

  const authStorage = AuthStorage.create(path.join(paths.sharedPiAgentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, path.join(paths.sharedPiAgentDir, "models.json"));

  const runtimeRegistry = new UserRuntimeRegistry({
    paths,
    rootConfig,
    userStore,
    stateStore,
    agentLoader,
    authStorage,
    modelRegistry,
    audit,
  });

  const service = new FamilyOSService({
    paths,
    rootConfig,
    userStore,
    stateStore,
    agentLoader,
    runtimeRegistry,
    modelRegistry,
    audit,
  });

  const bot = createTelegramBot({
    token: telegramToken,
    service,
    pageSize: rootConfig.telegram.pageSize,
    flowTtlMs: rootConfig.telegram.flowTtlSeconds * 1000,
    typingIntervalMs: rootConfig.telegram.typingIntervalMs,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    bot.stop();
    await audit.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await bot.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
