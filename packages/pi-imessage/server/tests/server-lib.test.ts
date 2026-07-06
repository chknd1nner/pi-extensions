import { describe, expect, it } from "vitest";
import { composeText, tokenMatches, validatePayload, validateRecipient } from "../lib.mjs";

describe("validatePayload", () => {
  it("accepts a minimal valid payload", () => {
    const r = validatePayload({ message: "hi" });
    expect(r).toEqual({ ok: true, value: { message: "hi" } });
  });
  it("accepts emoji and context", () => {
    const r = validatePayload({ message: "hi", emoji: "✅", context: "mbp · repo" });
    expect(r).toEqual({ ok: true, value: { message: "hi", emoji: "✅", context: "mbp · repo" } });
  });
  it("rejects non-object bodies", () => {
    expect(validatePayload(null).ok).toBe(false);
    expect(validatePayload("x").ok).toBe(false);
  });
  it("rejects missing/empty/whitespace message", () => {
    expect(validatePayload({}).ok).toBe(false);
    expect(validatePayload({ message: "   " }).ok).toBe(false);
    expect(validatePayload({ message: 7 }).ok).toBe(false);
  });
  it("enforces max lengths (message 4000, emoji 16, context 200)", () => {
    expect(validatePayload({ message: "x".repeat(4001) }).ok).toBe(false);
    expect(validatePayload({ message: "x".repeat(4000) }).ok).toBe(true);
    expect(validatePayload({ message: "hi", emoji: "e".repeat(17) }).ok).toBe(false);
    expect(validatePayload({ message: "hi", context: "c".repeat(201) }).ok).toBe(false);
  });
  it("rejects non-string emoji/context", () => {
    expect(validatePayload({ message: "hi", emoji: 5 }).ok).toBe(false);
    expect(validatePayload({ message: "hi", context: [] }).ok).toBe(false);
  });
  it("preserves newlines in message", () => {
    const r = validatePayload({ message: "a\nb" });
    expect(r).toEqual({ ok: true, value: { message: "a\nb" } });
  });
});

describe("composeText", () => {
  it("message only", () => {
    expect(composeText({ message: "done" })).toBe("done");
  });
  it("emoji prefix with single space", () => {
    expect(composeText({ message: "done", emoji: "✅" })).toBe("✅ done");
  });
  it("context suffix on second line in brackets", () => {
    expect(composeText({ message: "done", context: "mbp · repo" })).toBe("done\n[mbp · repo]");
  });
  it("all fields", () => {
    expect(composeText({ message: "done", emoji: "✅", context: "mbp · repo" })).toBe(
      "✅ done\n[mbp · repo]",
    );
  });
});

describe("validateRecipient", () => {
  it("accepts phone-like values", () => {
    expect(validateRecipient("+61412345678")).toBe(true);
    expect(validateRecipient("0412 345 678")).toBe(true);
  });
  it("accepts email-like values", () => {
    expect(validateRecipient("agent@icloud.com")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(validateRecipient("")).toBe(false);
    expect(validateRecipient("tell app \"Finder\"")).toBe(false);
    expect(validateRecipient("123")).toBe(false);
  });
});

describe("tokenMatches", () => {
  it("matches a correct bearer token", () => {
    expect(tokenMatches("Bearer sekret", "sekret")).toBe(true);
  });
  it("rejects wrong token, wrong scheme, missing header", () => {
    expect(tokenMatches("Bearer nope", "sekret")).toBe(false);
    expect(tokenMatches("Basic sekret", "sekret")).toBe(false);
    expect(tokenMatches(undefined, "sekret")).toBe(false);
  });
  it("rejects length-mismatched tokens without throwing", () => {
    expect(tokenMatches("Bearer s", "sekret")).toBe(false);
  });
});
