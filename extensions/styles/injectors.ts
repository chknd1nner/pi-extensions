/**
 * Per-API ephemeral style injectors.
 *
 * Each injector mutates the *final, serialized* provider payload (as seen in the
 * `before_provider_request` hook, i.e. after Pi has already assigned any
 * `cache_control` breakpoints). The style text is spliced in AFTER the last
 * cache breakpoint so it lives outside every cached prefix:
 *
 *   - it is never cache-written,
 *   - it can change every turn without invalidating upstream cache,
 *   - the conversation-history breakpoint keeps rolling forward normally.
 *
 * This mirrors how claude.ai injects <userStyle> and how Claude Code injects
 * <system-reminder>: a trailing, ephemeral, user-role content splice — never the
 * system prompt (which is the most cache-hostile place to put volatile text).
 *
 * Injectors construct their block first and perform a single append last, so a
 * validation failure throws before any mutation (the caller's try/catch then
 * leaves the payload untouched).
 */

export type StyleInjector = (payload: any, styleText: string) => void;

/**
 * anthropic-messages: body is { system, messages[], tools[] }.
 * Pi puts cache_control on the last block of the last user message. Appending a
 * trailing text block to that same user message lands it AFTER the breakpoint,
 * so it is an uncached tail. A user message may hold tool_result blocks followed
 * by text, so this stays valid during tool-calling turns.
 */
export function injectAnthropic(payload: any, styleText: string): void {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("anthropic payload has no messages[]");
  }
  const last = messages[messages.length - 1];
  const block = { type: "text", text: styleText };

  if (last && last.role === "user") {
    if (Array.isArray(last.content)) {
      last.content.push(block); // after the cache_control-bearing block
    } else if (typeof last.content === "string") {
      // caching disabled path: content stayed a string; ordering is irrelevant
      last.content = [{ type: "text", text: last.content }, block];
    } else {
      throw new Error("anthropic last user message has unexpected content shape");
    }
    return;
  }

  // Edge (should not happen at a request boundary): last turn isn't a user
  // message. Append a fresh trailing user message so the style is still last.
  messages.push({ role: "user", content: [block] });
}

/**
 * openai-completions: body is { messages[], tools[] }. Content is either a
 * string or an array of parts ({type:"text"} / {type:"image_url"}). Some
 * providers attach anthropic-format cache_control to the last text part of the
 * last user/assistant message, so we append AFTER existing parts.
 *
 * If the literal last message is not a user turn (e.g. a `tool` result), we
 * attach to the most recent user message instead of pushing a new user message,
 * to avoid role-alternation violations on strict providers.
 */
export function injectOpenAICompletions(payload: any, styleText: string): void {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("openai-completions payload has no messages[]");
  }
  const block = { type: "text", text: styleText };

  const appendTo = (m: any): boolean => {
    if (!m || m.role !== "user") return false;
    if (Array.isArray(m.content)) m.content.push(block);
    else if (typeof m.content === "string") m.content = [{ type: "text", text: m.content }, block];
    else m.content = [block];
    return true;
  };

  if (appendTo(messages[messages.length - 1])) return;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (appendTo(messages[i])) return;
  }

  // No user message at all: push one.
  messages.push({ role: "user", content: [block] });
}

/**
 * openai-responses (gpt-5.x / codex): body is { input[], tools[] }. Caching is
 * automatic longest-prefix, so there is no breakpoint to preserve — a trailing
 * user item is just uncached suffix. User items are
 * { role:"user", content:[{type:"input_text", text}] }.
 */
export function injectOpenAIResponses(payload: any, styleText: string): void {
  const input = payload?.input;
  if (!Array.isArray(input)) {
    throw new Error("openai-responses payload has no input[]");
  }
  input.push({ role: "user", content: [{ type: "input_text", text: styleText }] });
}

/** Registry keyed by `model.api`. Add a provider by adding one entry here. */
export const INJECTORS: Record<string, StyleInjector> = {
  "anthropic-messages": injectAnthropic,
  "openai-responses": injectOpenAIResponses,
  "openai-completions": injectOpenAICompletions,

  // TODO: Claude over Bedrock/Vertex serializes as `amazon-bedrock` /
  // `google-vertex` and wants the SAME explicit-breakpoint treatment as
  // anthropic-messages. Wire these to injectAnthropic once their cache_control
  // placement is verified against the serializer — do not route blind.
  // "amazon-bedrock": injectAnthropic,
  // "google-vertex": injectAnthropic,
};

/**
 * Best-effort splice for an unhandled api. Correctness-safe (the style still
 * applies); only cache *optimality* may be suboptimal on unknown
 * explicit-breakpoint providers — and the one such api we support
 * (anthropic-messages) is handled above, so it never reaches here.
 * Returns true if it managed to inject.
 */
export function genericFallback(payload: any, styleText: string): boolean {
  if (Array.isArray(payload?.input)) {
    injectOpenAIResponses(payload, styleText);
    return true;
  }
  if (Array.isArray(payload?.messages)) {
    injectOpenAICompletions(payload, styleText);
    return true;
  }
  return false;
}
