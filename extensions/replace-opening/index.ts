/**
 * Replace opening system prompt line
 *
 * Place this file in ~/.pi/agent/extensions/ or .pi/extensions/ in your project.
 * Optionally place a prompt.md next to this file containing the replacement text.
 *
 * Behavior:
 * - On before_agent_start, if the built-in opening sentence is present in the
 *   computed system prompt, it will be replaced with your custom string.
 * - If prompt.md exists next to this file, its contents (trimmed) are used.
 * - Otherwise a hardcoded fallback is used.
 * - If the target sentence is not found, nothing is returned (no change).
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function replaceOpeningPrompt(pi: ExtensionAPI) {
  // Exact sentence we want to replace (must match default verbatim)
  const TARGET =
    "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

  // Resolve directory of this extension file (works in ESM runtime)
  let extDir = process.cwd();
  try {
    extDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    // fallback to cwd if import.meta.url is unavailable
    extDir = process.cwd();
  }

  // Try to read prompt.md next to the extension
  const promptPath = join(extDir, "prompt.md");
  let replacementText: string | undefined;
  try {
    if (fs.existsSync(promptPath)) {
      replacementText = fs.readFileSync(promptPath, "utf8").trim();
    }
  } catch (err) {
    // ignore read errors and fall back to hardcoded default below
  }

  // Fallback replacement if no prompt.md present
  if (!replacementText) {
    replacementText =
      "You are a specialised assistant focussed on pragmatic, step-by-step code changes and clear explanations.";
  }

  // Hook: modify the system prompt just before agent start
  pi.on("before_agent_start", async (event) => {
    const base = event.systemPrompt ?? "";
    // Only act when the exact target sentence is present
    if (!base.includes(TARGET)) {
      return undefined; // leave prompt unchanged
    }

    // Replace only the first occurrence
    const newPrompt = base.replace(TARGET, replacementText!);

    return { systemPrompt: newPrompt };
  });
}