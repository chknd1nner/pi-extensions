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
