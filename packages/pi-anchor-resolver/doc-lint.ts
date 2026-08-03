import { mdeditHeadings, mdeditValidate } from "./mdedit.js";

// Slugs of every ADDRESSABLE heading (real document sections). Headings nested in block quotes or
// list items get anchors on GitHub but are not sections, so they can never be section ids.
export function headingSlugs(docPath: string): Set<string> {
  const slugs = new Set<string>();
  for (const h of mdeditHeadings(docPath)) {
    if (h.addressable && h.slug) slugs.add(h.slug);
  }
  return slugs;
}

// THROWS on a duplicate heading-slug within the doc. Collision detection is mdedit's — it considers
// EVERY heading (nested included), exactly as GitHub assigns anchors, so a block-quote heading that
// collides with a section is still caught.
export function lintDoc(docPath: string, docLabel: string): void {
  const collision = mdeditValidate(docPath).issues.find((i) => i.kind === "slug-collision");
  if (collision) {
    throw new Error(`${docLabel}: duplicate heading slug "${collision.slug}" — ${collision.message}`);
  }
}
