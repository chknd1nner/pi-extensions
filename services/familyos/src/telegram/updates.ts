import type { Context } from "grammy";
import type { AttachmentDownloader } from "../attachments/store.js";
import { classifyTelegramMedia } from "../attachments/classify.js";
import type { PendingAttachment } from "../types.js";
import type { InlineKeyboard } from "./keyboards.js";

export interface TelegramMessageRequest {
  isPrivateChat: boolean;
  chatId: string;
  telegramUserId: string;
  text: string;
  attachments: PendingAttachment[];
  unsupportedMessage?: string;
}

export interface TelegramCallbackRequest {
  isPrivateChat: boolean;
  chatId: string;
  telegramUserId: string;
  data: string;
  messageId: number;
}

export interface TelegramResponder {
  reply(text: string, options?: { parseMode?: "HTML"; keyboard?: InlineKeyboard }): Promise<{ messageId: number }>;
  edit(messageId: number, text: string, options?: { parseMode?: "HTML"; keyboard?: InlineKeyboard }): Promise<void>;
  answerCallback(text: string): Promise<void>;
  sendTyping(): Promise<void>;
}

export function extractMessageRequest(ctx: Context): TelegramMessageRequest {
  const media = classifyTelegramMedia((ctx.message ?? {}) as Record<string, any>);

  return {
    isPrivateChat: ctx.chat?.type === "private",
    chatId: String(ctx.chat?.id ?? ""),
    telegramUserId: String(ctx.from?.id ?? ""),
    text: media.text,
    attachments: media.attachments,
    unsupportedMessage: media.unsupportedMessage,
  };
}

export function extractCallbackRequest(ctx: Context): TelegramCallbackRequest {
  return {
    isPrivateChat: ctx.chat?.type === "private",
    chatId: String(ctx.chat?.id ?? ""),
    telegramUserId: String(ctx.from?.id ?? ""),
    data: ctx.callbackQuery?.data ?? "",
    messageId: ctx.callbackQuery?.message?.message_id ?? 0,
  };
}

export function createGrammYResponder(ctx: Context): TelegramResponder {
  return {
    async reply(text, options) {
      const sent = await ctx.reply(text, {
        parse_mode: options?.parseMode ?? "HTML",
        reply_markup: options?.keyboard as any,
      });
      return { messageId: sent.message_id };
    },
    async edit(messageId, text, options) {
      await ctx.api.editMessageText(Number(ctx.chat?.id), messageId, text, {
        parse_mode: options?.parseMode ?? "HTML",
        reply_markup: options?.keyboard as any,
      });
    },
    async answerCallback(text) {
      await ctx.answerCallbackQuery({ text });
    },
    async sendTyping() {
      await ctx.api.sendChatAction(Number(ctx.chat?.id), "typing");
    },
  };
}

export function createAttachmentDownloader(token: string, api: Context["api"]): AttachmentDownloader {
  return {
    async download(fileId: string) {
      const file = await api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        fileName: file.file_path?.split("/").at(-1) ?? fileId,
        buffer,
      };
    },
  };
}
