import { Bot } from "grammy";
import type { FamilyOSService } from "../core/familyos-service.js";
import { FlowStore } from "../flow-store.js";
import { TypingIndicatorLoop } from "../typing-indicator.js";
import { TelegramRouter } from "./router.js";
import {
  createAttachmentDownloader,
  createGrammYResponder,
  extractCallbackRequest,
  extractMessageRequest,
} from "./updates.js";

export function createTelegramBot(options: {
  token: string;
  service: FamilyOSService;
  pageSize: number;
  flowTtlMs: number;
  typingIntervalMs: number;
}) {
  const bot = new Bot(options.token);
  const router = new TelegramRouter({
    service: options.service,
    flowStore: new FlowStore(options.flowTtlMs),
    typingLoop: new TypingIndicatorLoop(options.typingIntervalMs),
    pageSize: options.pageSize,
    downloader: createAttachmentDownloader(options.token, bot.api),
  });

  bot.on("message", async (ctx) => {
    await router.handleMessage(extractMessageRequest(ctx), createGrammYResponder(ctx));
  });

  bot.on("callback_query:data", async (ctx) => {
    await router.handleCallback(extractCallbackRequest(ctx), createGrammYResponder(ctx));
  });

  return bot;
}
