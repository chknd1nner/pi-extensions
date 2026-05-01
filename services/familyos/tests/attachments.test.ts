import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { classifyTelegramMedia } from "../src/attachments/classify";
import { persistAttachments } from "../src/attachments/store";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { createTempRoot } from "./helpers/temp-root";

describe("classifyTelegramMedia", () => {
  it("classifies photos as images and voice notes as unsupported", () => {
    expect(classifyTelegramMedia({ photo: [{ file_id: "file-1" }], caption: "pic" }).attachments[0]?.kind).toBe("image");
    expect(classifyTelegramMedia({ voice: { file_id: "voice-1" } }).unsupportedMessage).toContain("unsupported");
  });
});

describe("persistAttachments", () => {
  it("saves images in Inbox and returns inline image payloads", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(user.inboxDir, { recursive: true });

    const saved = await persistAttachments(
      user,
      [{ kind: "image", fileId: "file-1", fileName: "photo.jpg", mimeType: "image/jpeg" }],
      {
        download: async () => ({
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("fake-image"),
        }),
      },
    );

    expect(saved[0]?.relativePath.startsWith("Inbox/")).toBe(true);
    expect(saved[0]?.inlineImage?.type).toBe("image");
    await temp.cleanup();
  });
});
