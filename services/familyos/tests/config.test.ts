import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBootstrapConfig } from "../src/config";
import { resolveFamilyOSRoot } from "../src/paths";
import { createTempRoot } from "./helpers/temp-root";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("resolveFamilyOSRoot", () => {
  it("prefers FAMILYOS_ROOT when it is set", async () => {
    const temp = await createTempRoot();
    cleanups.push(temp.cleanup);

    const resolved = await resolveFamilyOSRoot(process.cwd(), {
      ...process.env,
      FAMILYOS_ROOT: temp.rootDir,
    });

    expect(resolved).toBe(temp.rootDir);
  });

  it("walks upward until it finds config/familyos.json", async () => {
    const temp = await createTempRoot();
    cleanups.push(temp.cleanup);

    const nested = path.join(temp.rootDir, "services", "familyos");
    const resolved = await resolveFamilyOSRoot(nested, process.env);

    expect(resolved).toBe(temp.rootDir);
  });
});

describe("loadBootstrapConfig", () => {
  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    await expect(loadBootstrapConfig({}, process.cwd())).rejects.toThrow("TELEGRAM_BOT_TOKEN is required.");
  });

  it("returns parsed config and resolved paths", async () => {
    const temp = await createTempRoot();
    cleanups.push(temp.cleanup);

    const loaded = await loadBootstrapConfig(
      {
        TELEGRAM_BOT_TOKEN: "token-123",
        FAMILYOS_ROOT: temp.rootDir,
      },
      temp.rootDir,
    );

    expect(loaded.telegramToken).toBe("token-123");
    expect(loaded.rootConfig.defaultAgentId).toBe("default");
    expect(loaded.paths.auditLogPath).toBe(path.join(temp.rootDir, "logs", "audit.jsonl"));
    expect(loaded.paths.sharedPiAgentDir).toBe(path.join(temp.rootDir, ".familyos-pi"));
  });
});
