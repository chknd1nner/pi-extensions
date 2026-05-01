import { describe, expect, it, vi } from "vitest";
import { TypingIndicatorLoop } from "../src/typing-indicator";

describe("TypingIndicatorLoop", () => {
  it("starts once per key and stops cleanly", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const loop = new TypingIndicatorLoop(4000);

    loop.start("martin", send);
    loop.start("martin", send);
    await vi.advanceTimersByTimeAsync(4100);
    loop.stop("martin");
    await vi.advanceTimersByTimeAsync(4100);

    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
