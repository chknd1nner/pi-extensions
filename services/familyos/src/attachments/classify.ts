import type { PendingAttachment } from "../types.js";

export function classifyTelegramMedia(message: Record<string, any>): {
  attachments: PendingAttachment[];
  unsupportedMessage?: string;
  text: string;
} {
  const text =
    typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo.at(-1)!;
    return {
      text,
      attachments: [
        {
          kind: "image",
          fileId: largest.file_id,
          fileName: `photo-${largest.file_id}.jpg`,
          mimeType: "image/jpeg",
        },
      ],
    };
  }

  if (message.document?.file_id) {
    return {
      text,
      attachments: [
        {
          kind: "document",
          fileId: message.document.file_id,
          fileName: message.document.file_name ?? `document-${message.document.file_id}`,
          mimeType: message.document.mime_type,
        },
      ],
    };
  }

  if (message.voice || message.video || message.sticker || message.animation) {
    return {
      text,
      attachments: [],
      unsupportedMessage: "That media type is unsupported in FamilyOS MVP yet.",
    };
  }

  return {
    text,
    attachments: [],
  };
}
