import { persistAttachments, type AttachmentDownloader } from "../attachments/store.js";
import type { FamilyOSService } from "../core/familyos-service.js";
import { FlowStore } from "../flow-store.js";
import { formatReplyForTelegram } from "../reply-format.js";
import { TypingIndicatorLoop } from "../typing-indicator.js";
import type { AgentSwitchChoice, ModelSwitchChoice, ResolvedUser, TreeFilter } from "../types.js";
import {
  agentActionKeyboard,
  compactKeyboard,
  confirmKeyboard,
  listKeyboard,
  modelActionKeyboard,
  pagedPickerKeyboard,
  treeActionKeyboard,
  treeKeyboard,
} from "./keyboards.js";
import type { TelegramCallbackRequest, TelegramMessageRequest, TelegramResponder } from "./updates.js";

type RouterFlow =
  | { kind: "new_confirm" }
  | { kind: "resume"; items: Array<{ path: string; title: string; subtitle: string }>; page: number }
  | { kind: "tree"; filter: TreeFilter; page: number; text: string; indexToEntryId: Record<string, string> }
  | { kind: "tree_action"; entryId: string }
  | { kind: "compact" }
  | { kind: "model_select"; models: Array<{ provider: string; id: string; label: string }> }
  | { kind: "model_action"; provider: string; modelId: string }
  | { kind: "agent_select"; agents: Array<{ id: string; label: string }> }
  | { kind: "agent_action"; agentId: string };

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function treeIndexMap(page: { entries: Array<{ index: number; entryId: string }> }) {
  return Object.fromEntries(page.entries.map((entry) => [String(entry.index), entry.entryId]));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class TelegramRouter {
  private readonly pendingCompactInstructions = new Map<string, number>();

  constructor(
    private readonly deps: {
      service: FamilyOSService;
      flowStore: FlowStore<RouterFlow>;
      typingLoop: TypingIndicatorLoop;
      pageSize: number;
      downloader?: AttachmentDownloader;
    },
  ) {}

  private async replyWhoAmI(request: TelegramMessageRequest, responder: TelegramResponder) {
    const identity = await this.deps.service.describeCaller({
      channel: "telegram",
      externalUserId: request.telegramUserId,
      chatId: request.chatId,
    });

    const lines = [`Telegram ID: ${identity.telegramId}`];
    if (identity.slug) {
      lines.push(`FamilyOS user: ${identity.slug}`);
    }

    await responder.reply(lines.join("\n"), { parseMode: "HTML" });
  }

  private async requireRegisteredUser(request: TelegramMessageRequest | TelegramCallbackRequest, responder: TelegramResponder) {
    const user = await this.deps.service.resolveRegisteredUser({
      channel: "telegram",
      externalUserId: request.telegramUserId,
      chatId: request.chatId,
    });

    if (!user) {
      if ("data" in request) {
        await responder.answerCallback(this.deps.service.getOnboardingMessage());
      } else {
        await responder.reply(this.deps.service.getOnboardingMessage(), { parseMode: "HTML" });
      }
      return null;
    }

    return user;
  }

  private async ensureIdle(user: ResolvedUser, responder: TelegramResponder) {
    if (this.deps.service.isIdle(user)) {
      return true;
    }

    await responder.reply("Please wait until the current turn finishes, or use /cancel.", {
      parseMode: "HTML",
    });
    return false;
  }

  private renderResumeText(items: Array<{ title: string; subtitle: string }>, page: number) {
    const slice = items.slice(page * this.deps.pageSize, page * this.deps.pageSize + this.deps.pageSize);
    const lines = slice.map((item, index) => `[${index + 1}] ${item.title}\n${item.subtitle}`);
    return lines.join("\n\n") || "No sessions yet.";
  }

  private getPageInfo(totalItems: number, page: number) {
    const totalPages = Math.max(1, Math.ceil(totalItems / this.deps.pageSize));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    return { safePage, totalPages };
  }

  async handleMessage(request: TelegramMessageRequest, responder: TelegramResponder) {
    if (!request.isPrivateChat) return;

    if (request.text === "/whoami") {
      await this.replyWhoAmI(request, responder);
      return;
    }

    const user = await this.requireRegisteredUser(request, responder);
    if (!user) return;

    if (request.unsupportedMessage) {
      await responder.reply(request.unsupportedMessage, { parseMode: "HTML" });
      return;
    }

    const pendingCompactExpiry = this.pendingCompactInstructions.get(user.slug);
    if (pendingCompactExpiry && pendingCompactExpiry <= Date.now()) {
      this.pendingCompactInstructions.delete(user.slug);
    }

    if (pendingCompactExpiry && pendingCompactExpiry > Date.now() && request.text && !request.text.startsWith("/")) {
      this.pendingCompactInstructions.delete(user.slug);
      const status = await responder.reply("Compacting session…", { parseMode: "HTML" });
      this.deps.typingLoop.start(user.slug, () => responder.sendTyping());
      try {
        await this.deps.service.compact(user, request.text);
        await responder.edit(status.messageId, "Compacted.", { parseMode: "HTML" });
      } catch (error) {
        await responder.edit(status.messageId, `Compaction failed: ${escapeHtml(getErrorMessage(error))}`, {
          parseMode: "HTML",
        });
      } finally {
        this.deps.typingLoop.stop(user.slug);
      }
      return;
    }

    if (request.text === "/new") {
      if (!(await this.ensureIdle(user, responder))) return;
      const token = this.deps.flowStore.create({ kind: "new_confirm" });
      await responder.reply("Start a new Pi session?", {
        parseMode: "HTML",
        keyboard: confirmKeyboard("new", token),
      });
      return;
    }

    if (request.text === "/resume") {
      if (!(await this.ensureIdle(user, responder))) return;
      const items = await this.deps.service.listSessions(user);
      const token = this.deps.flowStore.create({ kind: "resume", items, page: 0 });
      const { totalPages } = this.getPageInfo(items.length, 0);
      await responder.reply(this.renderResumeText(items, 0), {
        parseMode: "HTML",
        keyboard: pagedPickerKeyboard("resume", token, Math.min(items.length, this.deps.pageSize), 0, totalPages),
      });
      return;
    }

    if (request.text === "/tree") {
      if (!(await this.ensureIdle(user, responder))) return;
      const page = await this.deps.service.buildTreePage(user, "user-only", 0);
      const token = this.deps.flowStore.create({
        kind: "tree",
        filter: "user-only",
        page: page.page,
        text: page.text,
        indexToEntryId: treeIndexMap(page),
      });
      await responder.reply(`<pre>${escapeHtml(page.text)}</pre>`, {
        parseMode: "HTML",
        keyboard: treeKeyboard(token, page.entries.length),
      });
      return;
    }

    if (request.text === "/compact") {
      if (!(await this.ensureIdle(user, responder))) return;
      const token = this.deps.flowStore.create({ kind: "compact" });
      await responder.reply("Choose a compaction action.", {
        parseMode: "HTML",
        keyboard: compactKeyboard(token),
      });
      return;
    }

    if (request.text === "/model") {
      if (!(await this.ensureIdle(user, responder))) return;
      const models = await this.deps.service.listAvailableModels();
      const token = this.deps.flowStore.create({ kind: "model_select", models });
      await responder.reply("Choose a model.", {
        parseMode: "HTML",
        keyboard: listKeyboard("model", token, models.map((model) => model.label)),
      });
      return;
    }

    if (request.text === "/agent") {
      if (!(await this.ensureIdle(user, responder))) return;
      const agents = await this.deps.service.listAvailableAgents(user);
      const token = this.deps.flowStore.create({ kind: "agent_select", agents });
      await responder.reply("Choose an agent.", {
        parseMode: "HTML",
        keyboard: listKeyboard("agent", token, agents.map((agent) => agent.label)),
      });
      return;
    }

    if (request.text === "/cancel") {
      const cancelled = await this.deps.service.cancel(user);
      this.deps.typingLoop.stop(user.slug);
      await responder.reply(cancelled ? "Cancelled current turn." : "Nothing is running right now.", {
        parseMode: "HTML",
      });
      return;
    }

    const persisted = this.deps.downloader ? await persistAttachments(user, request.attachments, this.deps.downloader) : [];

    this.deps.typingLoop.start(user.slug, () => responder.sendTyping());
    try {
      const result = await this.deps.service.sendTurn(user, {
        text: request.text,
        attachments: persisted,
      });
      for (const chunk of formatReplyForTelegram(result.replyText || "Done.")) {
        await responder.reply(chunk, { parseMode: "HTML" });
      }
    } finally {
      this.deps.typingLoop.stop(user.slug);
    }
  }

  async handleCallback(request: TelegramCallbackRequest, responder: TelegramResponder) {
    if (!request.isPrivateChat) return;

    const user = await this.requireRegisteredUser(request, responder);
    if (!user) return;

    const [kind, token, action, value] = request.data.split(":");
    const flow = this.deps.flowStore.get(token);
    if (!flow) {
      await responder.answerCallback("That menu has expired. Please run the command again.");
      return;
    }

    if (action !== "cancel" && !this.deps.service.isIdle(user)) {
      await responder.answerCallback("Please wait until the current turn finishes, or use /cancel.");
      return;
    }

    if (kind === "new" && flow.kind === "new_confirm") {
      if (action === "confirm") {
        await this.deps.service.startNewSession(user);
        await responder.edit(request.messageId, "Started a new session.", { parseMode: "HTML" });
      } else {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
      }
      return;
    }

    if (kind === "resume" && flow.kind === "resume") {
      const { safePage, totalPages } = this.getPageInfo(
        flow.items.length,
        flow.page + (action === "next" ? 1 : action === "prev" ? -1 : 0),
      );
      if (action === "pick") {
        const index = Number(value) - 1;
        const item = flow.items[safePage * this.deps.pageSize + index];
        if (item) {
          await this.deps.service.resumeSession(user, item.path);
          await responder.edit(request.messageId, `Resumed ${item.title}.`, { parseMode: "HTML" });
        }
        return;
      }
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      this.deps.flowStore.update(token, { ...flow, page: safePage });
      await responder.edit(request.messageId, this.renderResumeText(flow.items, safePage), {
        parseMode: "HTML",
        keyboard: pagedPickerKeyboard(
          "resume",
          token,
          Math.min(flow.items.length - safePage * this.deps.pageSize, this.deps.pageSize),
          safePage,
          totalPages,
        ),
      });
      return;
    }

    if (kind === "tree" && flow.kind === "tree") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }

      if (action === "pick") {
        const entryId = flow.indexToEntryId[String(value)];
        if (!entryId) {
          await responder.answerCallback("That menu has expired. Please run the command again.");
          return;
        }
        const nextToken = this.deps.flowStore.create({ kind: "tree_action", entryId });
        await responder.edit(request.messageId, `<pre>${escapeHtml(flow.text)}</pre>`, {
          parseMode: "HTML",
          keyboard: treeActionKeyboard(nextToken),
        });
        return;
      }

      const nextFilter = action === "filter" ? (value as TreeFilter) : flow.filter;
      const nextPage = action === "next" ? flow.page + 1 : action === "prev" ? flow.page - 1 : flow.page;
      const page = await this.deps.service.buildTreePage(user, nextFilter, nextPage);
      this.deps.flowStore.update(token, {
        kind: "tree",
        filter: page.filter,
        page: page.page,
        text: page.text,
        indexToEntryId: treeIndexMap(page),
      });
      await responder.edit(request.messageId, `<pre>${escapeHtml(page.text)}</pre>`, {
        parseMode: "HTML",
        keyboard: treeKeyboard(token, page.entries.length),
      });
      return;
    }

    if (kind === "tree-action" && flow.kind === "tree_action") {
      if (action === "restore") {
        await this.deps.service.restoreTreeEntry(user, flow.entryId);
        await responder.edit(request.messageId, "Restored the selected tree entry.", { parseMode: "HTML" });
        return;
      }
      if (action === "branch") {
        await this.deps.service.branchTreeEntry(user, flow.entryId);
        await responder.edit(request.messageId, "Branched with summary from the selected tree entry.", {
          parseMode: "HTML",
        });
        return;
      }
      await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
      return;
    }

    if (kind === "compact" && flow.kind === "compact") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      if (action === "custom") {
        this.pendingCompactInstructions.set(user.slug, Date.now() + 60_000);
        await responder.edit(request.messageId, "Send one message with the custom compaction instruction.", {
          parseMode: "HTML",
        });
        return;
      }
      await responder.edit(request.messageId, "Compacting session…", { parseMode: "HTML" });
      this.deps.typingLoop.start(user.slug, () => responder.sendTyping());
      try {
        await this.deps.service.compact(user);
        await responder.edit(request.messageId, "Compacted.", { parseMode: "HTML" });
      } catch (error) {
        await responder.edit(request.messageId, `Compaction failed: ${escapeHtml(getErrorMessage(error))}`, {
          parseMode: "HTML",
        });
      } finally {
        this.deps.typingLoop.stop(user.slug);
      }
      return;
    }

    if (kind === "model" && flow.kind === "model_select") {
      if (action === "pick") {
        const model = flow.models[Number(value) - 1];
        if (!model) return;
        const nextToken = this.deps.flowStore.create({
          kind: "model_action",
          provider: model.provider,
          modelId: model.id,
        });
        await responder.edit(request.messageId, "Switching models resets cache and can increase cost/usage.", {
          parseMode: "HTML",
          keyboard: modelActionKeyboard(nextToken),
        });
      }
      return;
    }

    if (kind === "model-action" && flow.kind === "model_action") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      await this.deps.service.switchModel(user, flow.provider, flow.modelId, action as ModelSwitchChoice);
      await responder.edit(request.messageId, `Switched to ${flow.provider}/${flow.modelId}.`, { parseMode: "HTML" });
      return;
    }

    if (kind === "agent" && flow.kind === "agent_select") {
      if (action === "pick") {
        const agent = flow.agents[Number(value) - 1];
        if (!agent) return;
        const nextToken = this.deps.flowStore.create({ kind: "agent_action", agentId: agent.id });
        await responder.edit(request.messageId, `Switch to ${agent.label}?`, {
          parseMode: "HTML",
          keyboard: agentActionKeyboard(nextToken),
        });
      }
      return;
    }

    if (kind === "agent-action" && flow.kind === "agent_action") {
      if (action === "cancel") {
        await responder.edit(request.messageId, "Cancelled.", { parseMode: "HTML" });
        return;
      }
      await this.deps.service.switchAgent(user, flow.agentId, action as AgentSwitchChoice);
      await responder.edit(request.messageId, `Switched agent to ${flow.agentId}.`, { parseMode: "HTML" });
    }
  }
}
