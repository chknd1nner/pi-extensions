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
