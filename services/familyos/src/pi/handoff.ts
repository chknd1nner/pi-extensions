export const HANDOFF_PROMPT = `You are taking over an in-progress conversation from a different assistant
persona. The messages above this point in the conversation were authored by
that previous assistant, not by you.

Treat the prior turns as transcript context: read them to understand what the
user has been working on and what they want next. Do not adopt the previous
assistant's voice, commitments, stylistic choices, or stated intentions as
your own — those belong to a different persona with a different role.

Continue the conversation as yourself, in your own voice and within your own
capabilities, from this turn forward. If the previous assistant made promises
or decisions that conflict with your role, raise that openly with the user
rather than silently continuing along the prior path.`;

export class OneShotHandoff {
  private text: string | undefined;

  arm(text: string) {
    this.text = text;
  }

  peek() {
    return this.text;
  }

  consume() {
    const current = this.text;
    this.text = undefined;
    return current;
  }
}

export function injectHandoffIntoProviderPayload(payload: unknown, handoff: string) {
  if (!payload || typeof payload !== "object") {
    return { payload, injected: false };
  }

  const value = structuredClone(payload as Record<string, unknown>);
  if (!Array.isArray(value.system)) {
    return { payload: value, injected: false };
  }

  return {
    injected: true,
    payload: {
      ...value,
      system: [...value.system, { type: "text", text: handoff }],
    },
  };
}
