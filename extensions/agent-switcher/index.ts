import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type Agent,
  DEFAULT_NAME,
  clearSystem,
  discover,
  formatAgentLabel,
  formatDefaultLabel,
  pointAt,
  systemState,
} from "./lib.js";

/**
 * /agent — choose the persona that backs .pi/SYSTEM.md (the "soul doc").
 *
 * Agents are plain .md files discovered from two scopes:
 *   - project : <cwd>/.pi/agents/*.md
 *   - home    : ~/.pi/agent/agents/*.md
 *
 * Optional per-scope sidecar `agents.json` supplies one-line descriptions for
 * the picker. It is read only by this extension — never by Pi — so descriptions
 * never leak into the system prompt (frontmatter inside a linked .md would).
 *
 * The synthetic "default" entry REMOVES the symlink so the harness falls
 * through to its built-in prompt. Selecting a custom agent (re)creates the link.
 *
 * Changes apply on the NEXT system-prompt build, so the command offers to
 * /reload for you (or you can /reload // /new later).
 */

export default function (pi: ExtensionAPI) {
  pi.registerCommand("agent", {
    description: "Switch the active agent persona (manages .pi/SYSTEM.md)",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const agents = discover(cwd);
      const state = systemState(cwd);

      const isDefaultActive = state.kind === "none";
      const isAgentActive = (a: Agent) =>
        state.kind === "agent" && path.resolve(a.absPath) === state.target;

      // Resolve the selection. `null` => default (remove symlink).
      let selection: Agent | null | undefined; // undefined = cancelled/invalid

      const argName = (args || "").trim();
      if (argName) {
        if (argName === DEFAULT_NAME) {
          selection = null;
        } else {
          selection =
            agents.find((a) => a.scope === "project" && a.name === argName) ??
            agents.find((a) => a.name === argName);
          if (!selection) {
            ctx.ui.notify(`No agent named "${argName}".`, "error");
            return;
          }
        }
      } else {
        // Build picker: default entry first, then discovered agents.
        const labels: string[] = [formatDefaultLabel(isDefaultActive)];
        const byLabel = new Map<string, Agent | null>([[labels[0], null]]);
        for (const a of agents) {
          const l = formatAgentLabel(a, isAgentActive(a));
          labels.push(l);
          byLabel.set(l, a);
        }
        const picked = await ctx.ui.select("Select agent persona:", labels);
        if (!picked) return; // cancelled
        selection = byLabel.get(picked);
        if (selection === undefined) return;
      }

      // No-op guards.
      if (selection === null && isDefaultActive) {
        ctx.ui.notify("Already on the built-in default (no SYSTEM.md).", "info");
        return;
      }
      if (selection && isAgentActive(selection)) {
        ctx.ui.notify(`"${selection.name}" is already the active agent.`, "info");
        return;
      }

      // Apply.
      let backedUp: string | null = null;
      let summary: string;
      try {
        if (selection === null) {
          backedUp = clearSystem(cwd).backedUp;
          summary = "default (built-in — SYSTEM.md removed)";
        } else {
          backedUp = pointAt(cwd, selection).backedUp;
          summary = `${selection.name} (${selection.scope})`;
        }
      } catch (e) {
        ctx.ui.notify(`Failed to switch: ${(e as Error).message}`, "error");
        return;
      }

      if (backedUp) {
        ctx.ui.notify(`Backed up existing SYSTEM.md → ${path.basename(backedUp)}`, "info");
      }
      ctx.ui.notify(`Persona → ${summary}. Reload or /new to apply.`, "info");

      const reloadNow = await ctx.ui.confirm(
        "Apply now?",
        `Reload this session to load ${summary}? (No = apply later with /reload or /new)`,
      );
      if (reloadNow) {
        await ctx.reload();
        return; // reload is terminal for this handler
      }
    },
  });
}
