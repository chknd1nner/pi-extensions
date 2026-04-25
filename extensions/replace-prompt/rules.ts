export default {
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target:
        "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
      replacementFile: "opening.md",
    },
  ],
};
