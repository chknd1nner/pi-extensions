// Rules configuration for replace-prompt extension
// See docs/usage.md for full documentation
export default {
  // Optional: { file: true } to enable logging
  // logging: { file: true },

  // Rules run in order, top to bottom
  rules: [
    {
      // Unique kebab-case identifier (required)
      id: "replace-opening",

      // "literal" for exact match, "regex" for pattern
      type: "literal",

      // Text to find (string for literal, RegExp for regex)
      target:
        "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",

      // Use ONE of: replacement (inline) or replacementFile (external)
      replacementFile: "opening.md",

      // Optional: "first" (default) or "all"
      // mode: "first",

      // Optional: conditional execution
      // condition: (ctx) => {
      //   ctx.model               // string | undefined - current model ID
      //   ctx.cwd                 // string - current working directory
      //   ctx.systemPrompt        // string - prompt state after previous rules
      //   ctx.originalSystemPrompt // string - unmodified prompt from start
      //   ctx.env                 // NodeJS.ProcessEnv - environment variables
      //   return true;            // must return explicit boolean
      // },
    },
  ],
};
