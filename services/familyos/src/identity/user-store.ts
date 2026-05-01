import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../json-file.js";
import { resolveUserPaths } from "../paths.js";
import type { ChannelIdentity, FamilyOSPaths, ResolvedUser, UserManifest } from "../types.js";

async function readManifest(filePath: string): Promise<UserManifest | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as UserManifest;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export class UserStore {
  constructor(private readonly paths: FamilyOSPaths) {}

  async listUserManifests(): Promise<UserManifest[]> {
    try {
      const entries = await fs.readdir(this.paths.usersDir, { withFileTypes: true });
      const manifests = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readManifest(path.join(this.paths.usersDir, entry.name, "user.json"))),
      );
      return manifests.filter((manifest): manifest is UserManifest => manifest !== null);
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async resolveByChannel(identity: ChannelIdentity): Promise<ResolvedUser | null> {
    if (identity.channel !== "telegram") return null;

    const manifests = await this.listUserManifests();
    const matched = manifests.find((manifest) =>
      manifest.channels.telegram?.userIds.includes(identity.externalUserId),
    );

    return matched ? resolveUserPaths(this.paths, matched) : null;
  }

  async describeTelegramCaller(telegramUserId: string) {
    const user = await this.resolveByChannel({
      channel: "telegram",
      externalUserId: telegramUserId,
      chatId: telegramUserId,
    });

    return {
      telegramUserId,
      slug: user?.slug,
    };
  }

  async ensureHome(user: ResolvedUser): Promise<void> {
    await fs.mkdir(user.inboxDir, { recursive: true });
    await fs.mkdir(user.workspaceDir, { recursive: true });
    await fs.mkdir(user.exportsDir, { recursive: true });
    await fs.mkdir(path.dirname(user.familySettingsPath), { recursive: true });
    await fs.mkdir(path.dirname(user.piSettingsPath), { recursive: true });

    try {
      await fs.access(user.familySettingsPath);
    } catch {
      await writeJsonAtomic(user.familySettingsPath, {});
    }

    try {
      await fs.access(user.piSettingsPath);
    } catch {
      await writeJsonAtomic(user.piSettingsPath, {});
    }
  }
}
