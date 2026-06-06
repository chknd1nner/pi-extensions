import { describe, expect, it } from "vitest";
import {
  genericFallback,
  injectAnthropic,
  injectOpenAICompletions,
  injectOpenAIResponses,
} from "./injectors";

const STYLE = "<userStyle>\nBe concise.\n</userStyle>";

describe("injectAnthropic", () => {
  it("appends a style text block after existing user content", () => {
    const payload = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    };

    injectAnthropic(payload, STYLE);

    expect(payload.messages[0].content).toEqual([
      {
        type: "text",
        text: "Hello",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: STYLE },
    ]);
  });

  it("pushes a trailing user message when the last message is not user-authored", () => {
    const payload = {
      messages: [{ role: "assistant", content: [{ type: "text", text: "Done" }] }],
    };

    injectAnthropic(payload, STYLE);

    expect(payload.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
      { role: "user", content: [{ type: "text", text: STYLE }] },
    ]);
  });
});

describe("injectOpenAIResponses", () => {
  it("appends a trailing user input item", () => {
    const payload = {
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    };

    injectOpenAIResponses(payload, STYLE);

    expect(payload.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Hello" }] },
      { role: "user", content: [{ type: "input_text", text: STYLE }] },
    ]);
  });
});

describe("injectOpenAICompletions", () => {
  it("appends to the most recent user message when the last message is a tool result", () => {
    const payload = {
      messages: [
        { role: "user", content: "Use the tool" },
        { role: "tool", content: "tool result" },
      ],
    };

    injectOpenAICompletions(payload, STYLE);

    expect(payload.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Use the tool" },
          { type: "text", text: STYLE },
        ],
      },
      { role: "tool", content: "tool result" },
    ]);
  });
});

describe("genericFallback", () => {
  it("uses OpenAI Responses shape when payload has input[]", () => {
    const payload: any = { input: [] };

    expect(genericFallback(payload, STYLE)).toBe(true);
    expect(payload.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: STYLE }] },
    ]);
  });

  it("returns false for unrecognized payloads", () => {
    const payload = { prompt: "Hello" };

    expect(genericFallback(payload, STYLE)).toBe(false);
    expect(payload).toEqual({ prompt: "Hello" });
  });
});
