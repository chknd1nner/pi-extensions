import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFamilyOSPaths } from "../src/paths";
import { StateStore } from "../src/identity/state-store";
import { UserStore } from "../src/identity/user-store";
import { createTempRoot } from "./helpers/temp-root";

describe("UserStore", () => {
  it("resolves a Telegram ID to a registered FamilyOS user", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.usersDir, "martin"), { recursive: true });
    await fs.writeFile(
      path.join(paths.usersDir, "martin", "user.json"),
      JSON.stringify(
        {
          id: "martin",
          displayName: "Martin",
          channels: { telegram: { userIds: ["123456789"] } },
        },
        null,
        2,
      ),
    );

    const store = new UserStore(paths);
    const user = await store.resolveByChannel({
      channel: "telegram",
      externalUserId: "123456789",
      chatId: "123456789",
    });

    expect(user?.slug).toBe("martin");
    await temp.cleanup();
  });

  it("scaffolds the user home with both settings files containing {}", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.usersDir, "alice"), { recursive: true });
    await fs.writeFile(
      path.join(paths.usersDir, "alice", "user.json"),
      JSON.stringify(
        {
          id: "alice",
          displayName: "Alice",
          channels: { telegram: { userIds: ["42"] } },
        },
        null,
        2,
      ),
    );

    const store = new UserStore(paths);
    const user = await store.resolveByChannel({
      channel: "telegram",
      externalUserId: "42",
      chatId: "42",
    });

    if (!user) throw new Error("Expected registered user");
    await store.ensureHome(user);

    expect(await fs.readFile(user.familySettingsPath, "utf8")).toBe("{}\n");
    expect(await fs.readFile(user.piSettingsPath, "utf8")).toBe("{}\n");
    await temp.cleanup();
  });
});

describe("StateStore", () => {
  it("returns the default active agent when state.json is missing", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });

    await fs.mkdir(path.join(paths.usersDir, "mum"), { recursive: true });
    await fs.writeFile(
      path.join(paths.usersDir, "mum", "user.json"),
      JSON.stringify(
        {
          id: "mum",
          displayName: "Mum",
          channels: { telegram: { userIds: ["77"] } },
        },
        null,
        2,
      ),
    );

    const store = new UserStore(paths);
    const user = await store.resolveByChannel({
      channel: "telegram",
      externalUserId: "77",
      chatId: "77",
    });

    if (!user) throw new Error("Expected registered user");
    const stateStore = new StateStore();
    const state = await stateStore.read(user, "default");

    expect(state).toEqual({ activeAgentId: "default" });
    await temp.cleanup();
  });
});
