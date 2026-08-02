import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Activate Pi's built-in grep tool without replacing its implementation.
 *
 * The availability check is intentional: explicit tool allowlists, exclusions,
 * and --no-tools remain authoritative because unavailable tools are not added.
 */
export default function piGrep(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    const grepAvailable = pi.getAllTools().some((tool) => tool.name === "grep");
    if (!grepAvailable) return;

    const activeTools = pi.getActiveTools();
    if (activeTools.includes("grep")) return;

    pi.setActiveTools([...activeTools, "grep"]);
  });
}
