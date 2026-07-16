import { describe, expect, it } from "vitest";
import {
  findExactStringPaths,
  getValueAtPath,
  replaceValueAtPath,
} from "../payload-path";

describe("provider payload paths", () => {
  it("finds exact string values through objects and arrays without matching keys or substrings", () => {
    const payload = {
      RP: "not the prompt",
      system: [{ text: "prefix RP suffix" }, { text: "RP" }],
      messages: [{ content: "unrelated" }],
    };

    expect(findExactStringPaths(payload, "RP")).toEqual([["system", 1, "text"]]);
  });

  it("reports every path when an exact string is ambiguous", () => {
    const payload = {
      system: { text: "RP" },
      messages: [{ content: "RP" }],
    };

    expect(findExactStringPaths(payload, "RP")).toEqual([
      ["system", "text"],
      ["messages", 0, "content"],
    ]);
  });

  it("visits shared objects at each path but stops cycles", () => {
    const shared = { text: "RP" };
    const cyclic: Record<string, unknown> = { prompt: "RP" };
    cyclic.self = cyclic;

    expect(findExactStringPaths({ first: shared, second: shared }, "RP")).toEqual([
      ["first", "text"],
      ["second", "text"],
    ]);
    expect(findExactStringPaths(cyclic, "RP")).toEqual([["prompt"]]);
  });

  it("returns a found result for valid paths and a miss for stale paths", () => {
    const payload = { system: [{ text: "RP" }] };

    expect(getValueAtPath(payload, ["system", 0, "text"])).toEqual({ found: true, value: "RP" });
    expect(getValueAtPath(payload, ["system", 1, "text"])).toEqual({ found: false });
    expect(getValueAtPath(payload, ["system", "0", "text"])).toEqual({ found: false });
  });

  it("replaces only the learned path with copy-on-write structural sharing", () => {
    const cacheControl = { type: "ephemeral" };
    const messages = [{ content: "BP" }];
    const payload = {
      system: [{ text: "BP", cache_control: cacheControl }],
      messages,
      temperature: 0,
    };

    const outcome = replaceValueAtPath(payload, ["system", 0, "text"], "BP", "RP");

    expect(outcome.changed).toBe(true);
    expect(outcome.value).toEqual({
      system: [{ text: "RP", cache_control: cacheControl }],
      messages: [{ content: "BP" }],
      temperature: 0,
    });
    expect(outcome.value).not.toBe(payload);
    expect((outcome.value as typeof payload).system).not.toBe(payload.system);
    expect((outcome.value as typeof payload).system[0]).not.toBe(payload.system[0]);
    expect((outcome.value as typeof payload).system[0].cache_control).toBe(cacheControl);
    expect((outcome.value as typeof payload).messages).toBe(messages);
    expect(payload.system[0].text).toBe("BP");
  });

  it("fails open when the path or expected value is stale", () => {
    const payload = { system: [{ text: "something else" }] };

    expect(replaceValueAtPath(payload, ["system", 0, "text"], "BP", "RP")).toEqual({
      value: payload,
      changed: false,
    });
    expect(replaceValueAtPath(payload, ["missing"], "BP", "RP")).toEqual({
      value: payload,
      changed: false,
    });
  });

  it("can discover and replace a root string payload", () => {
    expect(findExactStringPaths("RP", "RP")).toEqual([[]]);
    expect(replaceValueAtPath("BP", [], "BP", "RP")).toEqual({ value: "RP", changed: true });
  });

  it("ignores null, primitives, functions, and non-plain objects", () => {
    expect(findExactStringPaths(null, "RP")).toEqual([]);
    expect(findExactStringPaths(42, "RP")).toEqual([]);
    expect(findExactStringPaths(() => "RP", "RP")).toEqual([]);
    expect(findExactStringPaths(new Date(), "RP")).toEqual([]);
  });
});
