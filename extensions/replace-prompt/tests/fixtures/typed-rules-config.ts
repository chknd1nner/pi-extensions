import type { RawConfig } from "../../types";

export default {
  rules: [
    {
      id: "claude-only",
      enabled: true,
      type: "literal",
      target: "Hello",
      replacement: "Hi",
      condition: (ctx) => ctx.model?.includes("claude") ?? false,
    },
  ],
} satisfies RawConfig;
