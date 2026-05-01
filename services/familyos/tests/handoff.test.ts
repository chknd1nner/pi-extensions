import { describe, expect, it, vi } from "vitest";
import { createFamilyOSExtension } from "../src/pi/familyos-extension";
import { HANDOFF_PROMPT, OneShotHandoff, injectHandoffIntoProviderPayload } from "../src/pi/handoff";

describe("OneShotHandoff", () => {
  it("arms once and clears after consume", () => {
    const handoff = new OneShotHandoff();
    handoff.arm(HANDOFF_PROMPT);

    expect(handoff.peek()).toContain("different assistant");
    expect(handoff.consume()).toContain("different assistant");
    expect(handoff.consume()).toBeUndefined();
  });
});

describe("injectHandoffIntoProviderPayload", () => {
  it("appends one uncached text item and preserves the cached prefix bytes", () => {
    const payload = {
      system: [
        { type: "text", text: "persona", cache_control: { type: "ephemeral" } },
        { type: "text", text: "tool-guidelines" },
      ],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };

    const beforePrefix = JSON.stringify(payload.system);
    const result = injectHandoffIntoProviderPayload(payload, "handoff");

    expect(result.injected).toBe(true);
    expect(JSON.stringify((result.payload as any).system.slice(0, -1))).toBe(beforePrefix);
    expect((result.payload as any).system.at(-1)).toEqual({ type: "text", text: "handoff" });
    expect((result.payload as any).messages).toEqual(payload.messages);
  });

  it("leaves unsupported payload shapes untouched instead of mutating messages", () => {
    const payload = { system: "plain string", messages: [{ role: "user", content: "hello" }] };
    const result = injectHandoffIntoProviderPayload(payload, "handoff");

    expect(result.injected).toBe(false);
    expect(result.payload).toEqual(payload);
  });
});

describe("createFamilyOSExtension – one-shot handoff on unsupported payload", () => {
  it("consumes the handoff exactly once even when the payload has no system array", () => {
    const handoff = new OneShotHandoff();

    let capturedHandler: ((event: { payload: unknown }) => unknown) | undefined;
    const mockPi: any = {
      on: (event: string, handler: any) => {
        if (event === "before_provider_request") capturedHandler = handler;
      },
    };
    const appendSpy = vi.fn();
    const mockAudit: any = { append: appendSpy };
    const mockUser: any = { slug: "martin" };

    createFamilyOSExtension({ user: mockUser, handoff, audit: mockAudit })(mockPi);

    handoff.arm(HANDOFF_PROMPT);
    expect(handoff.peek()).toBeDefined();

    // Simulate a before_provider_request with an unsupported payload shape.
    capturedHandler!({ payload: { system: "plain string", messages: [] } });

    // The handoff must be cleared even though injection was skipped.
    expect(handoff.peek()).toBeUndefined();
    expect(handoff.consume()).toBeUndefined();

    // The audit event must still be recorded.
    expect(appendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "handoff_payload_unsupported", userSlug: "martin" }),
    );
  });
});
