---
task_number: 10
title: Build the Telegram adapter, native command flows, and callback handling
status: Ready for implementation
lane: ready
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are implementing Task 10 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket:
  - Ticket: in-progress/ready/task-10-telegram-adapter-command-flows-and-callback-handling.md
  - Plan: docs/superpowers/plans/2026-04-30-familyos-telegram.md
  - Spec: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md

  Work only on this task. Follow the plan excerpt in this ticket exactly.
  When implementation and verification are complete:
  - move this ticket to in-progress/review/
  - set status to Ready for review
  - set lane to review
  - replace next_prompt with the review prompt template from this ticket or an updated equivalent
  - add brief notes about verification and any follow-up concerns
review_prompt_template: |-
  You are reviewing Task 10 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket and the current git diff.
  Review only the scope in this ticket plan excerpt.
  If the task passes review:
  - move this ticket to in-progress/done/
  - set status to Done
  - set lane to done
  - add a short approval note

  If the task needs changes:
  - move this ticket to in-progress/needs-fix/
  - set status to Needs fix
  - set lane to needs-fix
  - replace next_prompt with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
---

# Task 10 — Build the Telegram adapter, native command flows, and callback handling

## Plan excerpt


**Files:**
- Create: `services/familyos/src/telegram/keyboards.ts`
- Create: `services/familyos/src/telegram/updates.ts`
- Create: `services/familyos/src/telegram/router.ts`
- Modify: `services/familyos/src/main.ts`
- Create: `services/familyos/src/telegram/bot.ts`
- Create: `services/familyos/tests/helpers/fake-telegram.ts`
- Create: `services/familyos/tests/integration/onboarding.test.ts`
- Create: `services/familyos/tests/integration/telegram-flows.test.ts`

- [ ] **Step 1: Write the failing Telegram adapter tests**

Create `services/familyos/tests/helpers/fake-telegram.ts`:

```typescript
export class FakeTelegramResponder {
  sent: Array<{ text: string; parseMode?: string; keyboard?: any }> = [];
  edited: Array<{ messageId: number; text: string; parseMode?: string; keyboard?: any }> = [];
  callbackAnswers: string[] = [];
  typingCount = 0;

  async reply(text: string, options?: { parseMode?: string; keyboard?: any }) {
    this.sent.push({ text, parseMode: options?.parseMode, keyboard: options?.keyboard });
    return { messageId: this.sent.length };
  }

  async edit(messageId: number, text: string, options?: { parseMode?: string; keyboard?: any }) {
    this.edited.push({ messageId, text, parseMode: options?.parseMode, keyboard: options?.keyboard });
  }

  async answerCallback(text: string) {
    this.callbackAnswers.push(text);
  }

  async sendTyping() {
    this.typingCount += 1;
  }
}
```

Create `services/familyos/tests/integration/onboarding.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { FlowStore } from "../../src/flow-store";
import { TypingIndicatorLoop } from "../../src/typing-indicator";
import { TelegramRouter } from "../../src/telegram/router";
import { FakeTelegramResponder } from "../helpers/fake-telegram";

describe("Telegram onboarding", () => {
  it("allows /whoami for unregistered users and blocks other work", async () => {
    const service = {
      getOnboardingMessage: () => "You're not registered with FamilyOS yet. Use `/whoami` to get your Telegram ID, then send it to the admin.",
      describeCaller: vi.fn(async () => ({ telegramId: "123", slug: undefined })),
      resolveRegisteredUser: vi.fn(async () => null),
    } as any;

    const router = new TelegramRouter({
      service,
      flowStore: new FlowStore(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const whoami = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "123",
        telegramUserId: "123",
        text: "/whoami",
        attachments: [],
      },
      whoami,
    );
    expect(whoami.sent[0]?.text).toContain("Telegram ID: 123");

    const normal = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "123",
        telegramUserId: "123",
        text: "hello",
        attachments: [],
      },
      normal,
    );
    expect(normal.sent[0]?.text).toContain("not registered");
  });

  it("does not download attachments for unregistered users", async () => {
    const downloader = { download: vi.fn() };
    const router = new TelegramRouter({
      service: {
        getOnboardingMessage: () => "You're not registered with FamilyOS yet. Use `/whoami` to get your Telegram ID, then send it to the admin.",
        describeCaller: vi.fn(),
        resolveRegisteredUser: vi.fn(async () => null),
      } as any,
      flowStore: new FlowStore(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
      downloader: downloader as any,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "123",
        telegramUserId: "123",
        text: "hello",
        attachments: [{ kind: "document", fileId: "file-1", fileName: "big.pdf" }],
      },
      responder,
    );

    expect(downloader.download).not.toHaveBeenCalled();
    expect(responder.sent[0]?.text).toContain("not registered");
  });

  it("ignores non-private chats", async () => {
    const router = new TelegramRouter({
      service: {
        getOnboardingMessage: () => "ignored",
        describeCaller: vi.fn(),
        resolveRegisteredUser: vi.fn(),
      } as any,
      flowStore: new FlowStore(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: false,
        chatId: "group",
        telegramUserId: "123",
        text: "/whoami",
        attachments: [],
      },
      responder,
    );

    expect(responder.sent).toHaveLength(0);
  });
});
```

Create `services/familyos/tests/integration/telegram-flows.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { FlowStore } from "../../src/flow-store";
import { TypingIndicatorLoop } from "../../src/typing-indicator";
import { TelegramRouter } from "../../src/telegram/router";
import { FakeTelegramResponder } from "../helpers/fake-telegram";

function getCallbackData(responder: FakeTelegramResponder, row: number, column: number) {
  return responder.sent.at(-1)?.keyboard?.inline_keyboard?.[row]?.[column]?.callback_data;
}

describe("TelegramRouter flows", () => {
  it("renders /new confirmation and executes confirm callback", async () => {
    const service = {
      getOnboardingMessage: () => "onboarding",
      describeCaller: vi.fn(),
      resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
      isIdle: vi.fn(() => true),
      startNewSession: vi.fn(async () => undefined),
    } as any;

    const router = new TelegramRouter({
      service,
      flowStore: new FlowStore<any>(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        text: "/new",
        attachments: [],
      },
      responder,
    );

    await router.handleCallback(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        data: getCallbackData(responder, 0, 0),
        messageId: 1,
      },
      responder,
    );

    expect(service.startNewSession).toHaveBeenCalled();
    expect(responder.edited.at(-1)?.text).toContain("Started a new session");
  });

  it("stores tree index mappings server-side and does not rebuild the page on pick", async () => {
    const service = {
      getOnboardingMessage: () => "onboarding",
      describeCaller: vi.fn(),
      resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
      isIdle: vi.fn(() => true),
      buildTreePage: vi.fn(async () => ({
        filter: "user-only",
        page: 0,
        totalPages: 1,
        text: "Tree filter: user-only\n\n[1] → user: keep this",
        entries: [{ index: 1, entryId: "entry-a", line: "[1] → user: keep this" }],
      })),
      restoreTreeEntry: vi.fn(async () => undefined),
      branchTreeEntry: vi.fn(async () => undefined),
    } as any;

    const router = new TelegramRouter({
      service,
      flowStore: new FlowStore<any>(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        text: "/tree",
        attachments: [],
      },
      responder,
    );

    const pickCallback = getCallbackData(responder, 0, 0);
    await router.handleCallback(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        data: pickCallback,
        messageId: 1,
      },
      responder,
    );

    expect(service.buildTreePage).toHaveBeenCalledTimes(1);

    const actionCallback = responder.edited.at(-1)?.keyboard?.inline_keyboard?.[0]?.[0]?.callback_data;
    await router.handleCallback(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        data: actionCallback,
        messageId: 1,
      },
      responder,
    );

    expect(service.restoreTreeEntry).toHaveBeenCalledWith({ slug: "martin" }, "entry-a");
  });

  it("surfaces compact failures by editing the status message", async () => {
    const service = {
      getOnboardingMessage: () => "onboarding",
      describeCaller: vi.fn(),
      resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
      isIdle: vi.fn(() => true),
      compact: vi.fn(async () => {
        throw new Error("summary failed");
      }),
    } as any;

    const router = new TelegramRouter({
      service,
      flowStore: new FlowStore<any>(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        text: "/compact",
        attachments: [],
      },
      responder,
    );

    await router.handleCallback(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        data: getCallbackData(responder, 0, 0),
        messageId: 1,
      },
      responder,
    );

    expect(responder.edited.at(-1)?.text).toContain("Compaction failed: summary failed");
  });

  it("blocks state-changing commands while a turn is running", async () => {
    const router = new TelegramRouter({
      service: {
        getOnboardingMessage: () => "onboarding",
        describeCaller: vi.fn(),
        resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
        isIdle: vi.fn(() => false),
      } as any,
      flowStore: new FlowStore(60_000),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleMessage(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        text: "/model",
        attachments: [],
      },
      responder,
    );

    expect(responder.sent.at(-1)?.text).toContain("Please wait");
  });

  it("returns the expired-menu message when a callback token is stale", async () => {
    const router = new TelegramRouter({
      service: {
        getOnboardingMessage: () => "onboarding",
        describeCaller: vi.fn(),
        resolveRegisteredUser: vi.fn(async () => ({ slug: "martin" })),
        isIdle: vi.fn(() => true),
      } as any,
      flowStore: new FlowStore(1),
      typingLoop: new TypingIndicatorLoop(4000),
      pageSize: 8,
    });

    const responder = new FakeTelegramResponder();
    await router.handleCallback(
      {
        isPrivateChat: true,
        chatId: "1",
        telegramUserId: "1",
        data: "new:missing-token:confirm",
        messageId: 1,
      },
      responder,
    );

    expect(responder.callbackAnswers.at(-1)).toContain("expired");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/integration/onboarding.test.ts tests/integration/telegram-flows.test.ts`
Expected: FAIL because the Telegram adapter files do not exist yet

- [ ] **Step 3: Implement inline keyboard builders and grammY update extraction**

Create `services/familyos/src/telegram/keyboards.ts`:

```typescript
export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export function confirmKeyboard(prefix: string, token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Confirm", callback_data: `${prefix}:${token}:confirm` },
      { text: "Cancel", callback_data: `${prefix}:${token}:cancel` },
    ]],
  };
}

export function pagedPickerKeyboard(prefix: string, token: string, count: number, page: number, totalPages: number): InlineKeyboard {
  const numberRow = Array.from({ length: count }, (_value, index) => ({
    text: String(index + 1),
    callback_data: `${prefix}:${token}:pick:${index + 1}`,
  }));

  return {
    inline_keyboard: [
      numberRow,
      [
        { text: "Prev", callback_data: `${prefix}:${token}:prev` },
        { text: "Next", callback_data: `${prefix}:${token}:next` },
        { text: "Cancel", callback_data: `${prefix}:${token}:cancel` },
      ].filter((button) => totalPages > 1 || button.text === "Cancel"),
    ],
  };
}

export function treeKeyboard(token: string, count: number): InlineKeyboard {
  const buttons = Array.from({ length: count }, (_value, index) => ({
    text: String(index + 1),
    callback_data: `tree:${token}:pick:${index + 1}`,
  }));

  return {
    inline_keyboard: [
      buttons,
      [
        { text: "Default", callback_data: `tree:${token}:filter:default` },
        { text: "No-tools", callback_data: `tree:${token}:filter:no-tools` },
        { text: "User-only", callback_data: `tree:${token}:filter:user-only` },
      ],
      [
        { text: "Labeled-only", callback_data: `tree:${token}:filter:labeled-only` },
        { text: "All", callback_data: `tree:${token}:filter:all` },
      ],
      [
        { text: "Prev", callback_data: `tree:${token}:prev` },
        { text: "Next", callback_data: `tree:${token}:next` },
        { text: "Cancel", callback_data: `tree:${token}:cancel` },
      ],
    ],
  };
}

export function treeActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Restore full context", callback_data: `tree-action:${token}:restore` },
      { text: "Branch with summary", callback_data: `tree-action:${token}:branch` },
      { text: "Cancel", callback_data: `tree-action:${token}:cancel` },
    ]],
  };
}

export function compactKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Compact now", callback_data: `compact:${token}:now` },
      { text: "Compact with custom instruction", callback_data: `compact:${token}:custom` },
      { text: "Cancel", callback_data: `compact:${token}:cancel` },
    ]],
  };
}

export function listKeyboard(prefix: string, token: string, labels: string[]): InlineKeyboard {
  return {
    inline_keyboard: labels.map((label, index) => [
      { text: label, callback_data: `${prefix}:${token}:pick:${index + 1}` },
    ]),
  };
}

export function modelActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Switch anyway", callback_data: `model-action:${token}:switch_anyway` },
      { text: "Branch + compact, then switch", callback_data: `model-action:${token}:branch_compact_then_switch` },
      { text: "New session", callback_data: `model-action:${token}:new_session` },
      { text: "Cancel", callback_data: `model-action:${token}:cancel` },
    ]],
  };
}

export function agentActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Continue current session", callback_data: `agent-action:${token}:continue_session` },
      { text: "Start fresh session", callback_data: `agent-action:${token}:start_fresh` },
      { text: "Branch with summary, then switch agent", callback_data: `agent-action:${token}:branch_then_switch` },
      { text: "Cancel", callback_data: `agent-action:${token}:cancel` },
    ]],
  };
}
```

Create `services/familyos/src/telegram/updates.ts`:

```typescript
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
```

- [ ] **Step 4: Implement the Telegram router and grammY bot wiring**

Create `services/familyos/src/telegram/router.ts`:

```typescript
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

  constructor(private readonly deps: {
    service: FamilyOSService;
    flowStore: FlowStore<RouterFlow>;
    typingLoop: TypingIndicatorLoop;
    pageSize: number;
    downloader?: AttachmentDownloader;
  }) {}

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

    const persisted = this.deps.downloader
      ? await persistAttachments(user, request.attachments, this.deps.downloader)
      : [];

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
      const { safePage, totalPages } = this.getPageInfo(flow.items.length, flow.page + (action === "next" ? 1 : action === "prev" ? -1 : 0));
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
        keyboard: pagedPickerKeyboard("resume", token, Math.min(flow.items.length - safePage * this.deps.pageSize, this.deps.pageSize), safePage, totalPages),
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
        await responder.edit(request.messageId, "Branched with summary from the selected tree entry.", { parseMode: "HTML" });
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
        await responder.edit(request.messageId, "Send one message with the custom compaction instruction.", { parseMode: "HTML" });
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
        const nextToken = this.deps.flowStore.create({ kind: "model_action", provider: model.provider, modelId: model.id });
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
```

Create `services/familyos/src/telegram/bot.ts`:

```typescript
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
```

Modify `services/familyos/src/main.ts` to the real bootstrap:

```typescript
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
```

- [ ] **Step 5: Run the Telegram adapter tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/integration/onboarding.test.ts tests/integration/telegram-flows.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/familyos/src/telegram/keyboards.ts services/familyos/src/telegram/updates.ts services/familyos/src/telegram/router.ts services/familyos/src/telegram/bot.ts services/familyos/src/main.ts services/familyos/tests/helpers/fake-telegram.ts services/familyos/tests/integration/onboarding.test.ts services/familyos/tests/integration/telegram-flows.test.ts
git commit -m "feat(familyos): add telegram adapter and command flows"
```

---
