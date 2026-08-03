import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runResolve, type RunResolveParams } from "./resolve.js";
import { formatReport } from "./drift.js";
import { renderCall, renderResult } from "./render.js";

// Cap the LLM-facing text; the complete structured result always remains in details.
const MAX_REPORT_CHARS = 24000;
function capText(text: string): string {
  return text.length <= MAX_REPORT_CHARS
    ? text
    : `${text.slice(0, MAX_REPORT_CHARS)}\n\n[report truncated at ${MAX_REPORT_CHARS} chars — full sections/drift are in details]`;
}

const AnchorResolveParams = Type.Object({
  mode: StringEnum(["full", "changed", "section"] as const, {
    description: "full: resolve all sections. changed: only sections whose anchors resolve into the given files. section: a single section id.",
  }),
  anchorsPath: Type.Optional(Type.String({
    description: "Path to the anchors registry, relative to the working directory. Default docs/living/anchors.yml.",
  })),
  changed: Type.Optional(Type.Array(Type.String(), {
    description: "For mode=changed: repo-relative file paths; sections whose anchors resolve into any of these are returned.",
  })),
  section: Type.Optional(Type.String({
    description: "For mode=section: the section id <domain>/<heading-slug>, e.g. daemon/session-lifecycle.",
  })),
  report: Type.Optional(Type.Boolean({
    description: "Include the compact markdown drift report as text output. Default true.",
  })),
});

export default function anchorResolverExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "anchor_resolve",
    label: "Anchor Resolve",
    description: "Resolve living-spec anchors (docs/living/anchors.yml) to current code/test locations and report drift (dangling / loose / unresolved-behavior).",
    promptSnippet: "Resolve living-spec anchors to code/test locations and surface drift.",
    promptGuidelines: [
      "Use anchor_resolve(mode=\"section\", section=\"<domain>/<heading-slug>\") to jump from a living-spec section to its exact code/test location.",
      "Use anchor_resolve(mode=\"changed\", changed=[...files]) before planning a change to find which documented sections cover those files.",
      "Use anchor_resolve(mode=\"full\") after a change to surface dangling/loose/unresolved anchors (drift).",
    ],
    parameters: AnchorResolveParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runParams: RunResolveParams = {
        mode: params.mode,
        anchorsPath: params.anchorsPath,
        changed: params.changed,
        section: params.section,
      };
      const result = runResolve(runParams, ctx.cwd);
      const raw = params.report === false
        ? `anchor_resolve: ${Object.keys(result.sections).length} section(s) resolved. Response ID: ${result.responseId}`
        : `${formatReport(result)}\n\n---\nResponse ID: ${result.responseId}`;
      const text = capText(raw);
      // details MUST be a fresh object literal (see Global Constraints), not the ResolveResult variable.
      return {
        content: [{ type: "text" as const, text }],
        details: { responseId: result.responseId, sections: result.sections, drift: result.drift },
      };
    },
    renderCall,
    renderResult,
  });
}
