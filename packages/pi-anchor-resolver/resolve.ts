import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { loadAnchors } from "./anchors.js";
import { ensureMdedit } from "./mdedit.js";
import { headingSlugs, lintDoc } from "./doc-lint.js";
import { classifyDrift, buildSections } from "./drift.js";
import { findParseErrors, resolveCodeAnchor } from "./resolve-code.js";
import { resolveBehaviorAnchor } from "./resolve-behavior.js";
import type { Anchor, AnchorResolution, ResolveMode, ResolveResult } from "./types.js";

export interface RunResolveParams {
  mode: ResolveMode;
  anchorsPath?: string;
  changed?: string[];
  section?: string;
}

export function generateResponseId(): string {
  return `anchor_${randomUUID()}`;
}

// Canonical repo-relative POSIX path (handles ./, .., duplicate/native separators, absolute inputs).
function toRel(p: string, cwd: string): string {
  return relative(cwd, resolve(cwd, p)).split(sep).join("/");
}

function resolveAnchor(section: string, anchor: Anchor, cwd: string): AnchorResolution {
  if (anchor.kind === "behavior") {
    const loc = resolveBehaviorAnchor(anchor.behavior, cwd);
    return { section, anchor, locations: loc ? [loc] : [] };
  }
  const locations = resolveCodeAnchor(anchor.code, cwd);
  // Only on the 0-match (drift) path do we re-scan for tree-sitter ERROR nodes, so the
  // ERROR scan stays off the healthy common path. Distinguishes parse failure from rename.
  const parseErrors = locations.length === 0 ? findParseErrors(anchor.code, cwd) : [];
  return { section, anchor, locations, ...(parseErrors.length > 0 ? { parseErrors } : {}) };
}

// Registry integrity: enforce "the heading is the id" before resolving anything.
function assertRegistryIntegrity(ids: string[], cwd: string): void {
  const byDomain = new Map<string, string[]>();
  for (const id of ids) {
    const domain = id.split("/")[0];
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), id]);
  }
  for (const [domain, domainIds] of byDomain) {
    const docPath = join(cwd, "docs", "living", `${domain}.md`);
    if (!existsSync(docPath)) {
      throw new Error(`referenced living doc not found: docs/living/${domain}.md (required by ${domainIds[0]}).`);
    }
    lintDoc(docPath, `docs/living/${domain}.md`); // delegates to `mdedit validate`; throws on duplicate slug
    const slugs = headingSlugs(docPath);          // addressable heading slugs from `mdedit headings`
    for (const id of domainIds) {
      const slug = id.slice(domain.length + 1);
      if (!slugs.has(slug)) {
        throw new Error(`section "${id}" has no matching heading in docs/living/${domain}.md (a heading nested in a block quote or list item is not addressable and cannot be a section id).`);
      }
    }
  }
}

export function runResolve(params: RunResolveParams, cwd: string): ResolveResult {
  ensureMdedit(); // single preflight: fail fast + clear if the mdedit CLI is missing/too old
  const anchorsPath = join(cwd, params.anchorsPath ?? "docs/living/anchors.yml");
  const registry = loadAnchors(anchorsPath);

  assertRegistryIntegrity([...registry.sections.keys()], cwd);

  // Select section ids.
  let ids: string[];
  if (params.mode === "section") {
    const id = params.section ?? "";
    if (!registry.sections.has(id)) throw new Error(`unknown section "${id}" in anchors registry.`);
    ids = [id];
  } else {
    ids = [...registry.sections.keys()];
  }

  let resolutions: AnchorResolution[] = [];
  for (const id of ids) {
    for (const anchor of registry.sections.get(id)!) resolutions.push(resolveAnchor(id, anchor, cwd));
  }

  if (params.mode === "changed") {
    const changed = new Set((params.changed ?? []).map((p) => toRel(p, cwd)));
    const keep = new Set<string>();
    for (const r of resolutions) {
      if (r.locations.some((l) => changed.has(toRel(l.file, cwd)))) keep.add(r.section);
    }
    resolutions = resolutions.filter((r) => keep.has(r.section));
  }

  return {
    responseId: generateResponseId(),
    sections: buildSections(resolutions),
    drift: classifyDrift(resolutions),
  };
}
