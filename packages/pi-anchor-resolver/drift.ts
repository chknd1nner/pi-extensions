import type { AnchorResolution, DriftReport, ResolveResult, ResolvedSection } from "./types.js";

export function classifyDrift(resolutions: AnchorResolution[]): DriftReport {
  const drift: DriftReport = { dangling: [], loose: [], unresolvedBehavior: [], unparseable: [] };
  for (const { section, anchor, locations, parseErrors } of resolutions) {
    if (anchor.kind === "code") {
      if (locations.length === 0) {
        // A 0-match anchor whose file(s) contain tree-sitter ERROR nodes is a parse
        // failure, not a rename — report it distinctly, naming the first error file+line.
        if (parseErrors && parseErrors.length > 0) {
          const { file, line } = parseErrors[0];
          drift.unparseable.push({ section, anchor: anchor.label, file, line });
        } else {
          drift.dangling.push({ section, anchor: anchor.label });
        }
      } else if (locations.length > 1) drift.loose.push({ section, anchor: anchor.label, count: locations.length });
    } else {
      if (locations.length === 0) drift.unresolvedBehavior.push({ section, id: anchor.label });
    }
  }
  return drift;
}

export function buildSections(resolutions: AnchorResolution[]): Record<string, ResolvedSection> {
  const sections: Record<string, ResolvedSection> = {};
  const kinds = new Map<string, Set<"code" | "behavior">>();
  for (const { section, anchor, locations } of resolutions) {
    if (!sections[section]) sections[section] = { type: "code", locations: [] };
    sections[section].locations.push(...locations);
    if (!kinds.has(section)) kinds.set(section, new Set());
    kinds.get(section)!.add(anchor.kind);
  }
  for (const [section, set] of kinds) {
    sections[section].type = set.size > 1 ? "mixed" : set.has("code") ? "code" : "behavior";
  }
  return sections;
}

export function formatReport(result: ResolveResult): string {
  const { drift, sections } = result;
  const total = drift.dangling.length + drift.loose.length + drift.unresolvedBehavior.length + drift.unparseable.length;
  const lines: string[] = [];
  lines.push(`# anchor_resolve — ${Object.keys(sections).length} section(s), ${total} drift signal(s)`);
  lines.push("");
  lines.push("## Drift");
  if (total === 0) {
    lines.push("No drift detected.");
  } else {
    for (const d of drift.dangling) lines.push(`- DANGLING ${d.section} — 0 matches for \`${d.anchor}\``);
    for (const l of drift.loose) lines.push(`- LOOSE ${l.section} — ${l.count} matches for \`${l.anchor}\``);
    for (const u of drift.unresolvedBehavior) lines.push(`- UNRESOLVED ${u.section} — behavior \`${u.id}\``);
    for (const p of drift.unparseable) lines.push(`- UNPARSEABLE ${p.section} — 0 matches for \`${p.anchor}\`; parse error at ${p.file}:${p.line} (grammar could not build the node)`);
  }
  lines.push("");
  lines.push("## Sections");
  const ids = Object.keys(sections).sort();
  if (ids.length === 0) {
    lines.push("(none)");
  } else {
    for (const id of ids) {
      const s = sections[id];
      const locs = s.locations.map((l) => `${l.file}:${l.startLine}${l.symbol ? ` (${l.symbol})` : ""}`).join(", ");
      lines.push(`- ${id} [${s.type}] → ${locs || "(unresolved)"}`);
    }
  }
  return lines.join("\n");
}
