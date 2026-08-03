import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Anchor, AnchorRegistry, CodeAnchor } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateId(id: string): void {
  const segments = id.split("/");
  if (segments.length !== 2 || segments.some((s) => s.trim() === "")) {
    throw new Error(`"${id}": id must be "<domain>/<slug>" (exactly two non-empty segments).`);
  }
}

function parseCodeAnchor(raw: unknown, id: string): CodeAnchor {
  if (!isPlainObject(raw)) throw new Error(`${id}: code anchor must be an object.`);
  const { language, rule, files } = raw;
  if (typeof language !== "string" || language.trim() === "") throw new Error(`${id}: code anchor requires a string "language".`);
  if (!isPlainObject(rule)) throw new Error(`${id}: code anchor "rule" must be an object (not an array or scalar).`);
  if (!Array.isArray(files) || files.length === 0) throw new Error(`${id}: code anchor requires a non-empty "files" array.`);
  const cleaned: string[] = [];
  for (const f of files) {
    if (typeof f !== "string" || f.trim() === "") throw new Error(`${id}: every "files" entry must be a non-empty string.`);
    if (isAbsolute(f)) throw new Error(`${id}: "files" globs must be repo-relative, got absolute "${f}".`);
    cleaned.push(f.trim());
  }
  return { language: language.trim(), rule, files: cleaned };
}

function parseAnchor(item: unknown, id: string): Anchor {
  if (!isPlainObject(item)) throw new Error(`${id}: each anchor must be an object with "code" or "behavior".`);
  const hasCode = "code" in item;
  const hasBehavior = "behavior" in item;
  if (hasCode === hasBehavior) throw new Error(`${id}: each anchor must have exactly one of "code" or "behavior".`);
  if (hasCode) {
    const code = parseCodeAnchor(item.code, id);
    return { kind: "code", label: JSON.stringify(code.rule), code };
  }
  const value = item.behavior;
  if (typeof value !== "string" || !value.includes("::")) {
    throw new Error(`${id}: behavior anchor must be a "path::testName" string.`);
  }
  const idx = value.indexOf("::");
  const path = value.slice(0, idx).trim();
  const testName = value.slice(idx + 2).trim();
  if (!path || !testName) throw new Error(`${id}: behavior anchor must be a "path::testName" string.`);
  return { kind: "behavior", label: value, behavior: { raw: value, path, testName } };
}

export function loadAnchors(absPath: string): AnchorRegistry {
  if (!existsSync(absPath)) throw new Error(`anchors file not found: ${absPath}`);
  const text = readFileSync(absPath, "utf8");
  const doc = parseYaml(text) as unknown; // throws on malformed YAML
  if (!isPlainObject(doc)) {
    throw new Error(`anchors file must be a mapping of "<domain>/<slug>" to a list of anchors: ${absPath}`);
  }
  const sections = new Map<string, Anchor[]>();
  for (const [id, value] of Object.entries(doc)) {
    validateId(id);
    if (!Array.isArray(value)) throw new Error(`${id}: section value must be a list of anchors.`);
    if (value.length === 0) throw new Error(`${id}: a section must declare at least one anchor.`);
    sections.set(id, value.map((item) => parseAnchor(item, id)));
  }
  return { sections };
}
