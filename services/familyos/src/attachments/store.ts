import fs from "node:fs/promises";
import path from "node:path";
import type { PersistedAttachment, PendingAttachment, ResolvedUser } from "../types.js";

export interface AttachmentDownloader {
  download(fileId: string): Promise<{
    fileName: string;
    mimeType?: string;
    buffer: Buffer;
  }>;
}

function safeName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function persistAttachments(
  user: ResolvedUser,
  attachments: PendingAttachment[],
  downloader: AttachmentDownloader,
): Promise<PersistedAttachment[]> {
  const saved: PersistedAttachment[] = [];

  await fs.mkdir(user.inboxDir, { recursive: true });

  for (const attachment of attachments) {
    const downloaded = await downloader.download(attachment.fileId);
    const stampedName = `${Date.now()}-${safeName(downloaded.fileName)}`;
    const absolutePath = path.join(user.inboxDir, stampedName);
    await fs.writeFile(absolutePath, downloaded.buffer);

    saved.push({
      kind: attachment.kind,
      absolutePath,
      relativePath: path.posix.join("Inbox", stampedName),
      inlineImage:
        attachment.kind === "image"
          ? {
              type: "image",
              mimeType: downloaded.mimeType ?? "image/jpeg",
              data: downloaded.buffer.toString("base64"),
            }
          : undefined,
    });
  }

  return saved;
}
