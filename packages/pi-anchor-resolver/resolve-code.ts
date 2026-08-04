import { globSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { Lang, parse, registerDynamicLanguage } from "@ast-grep/napi";
import swift from "@ast-grep/lang-swift";
import type { CodeAnchor, ParseError, ResolvedLocation } from "./types.js";

// Root of a parsed source file, derived from `parse(...).root()` so we avoid importing
// ast-grep's generic SgNode type parameters here.
type ParsedRoot = ReturnType<ReturnType<typeof parse>["root"]>;
interface ParsedFile { file: string; root: ParsedRoot; }

// `parse(lang, src)` accepts `NapiLang = Lang | (string & {})`, so built-in enum
// members and dynamically-registered language names (e.g. "swift") coexist here.
const LANG_MAP: Record<string, string> = {
  typescript: Lang.TypeScript,
  ts: Lang.TypeScript,
  tsx: Lang.Tsx,
  javascript: Lang.JavaScript,
  js: Lang.JavaScript,
  swift: "swift",
};

// `registerDynamicLanguage` should be called exactly once per process, but vitest
// isolates per test file so it can be reached more than once; guard it idempotently.
let swiftRegistered = false;
function ensureSwift(): void {
  if (swiftRegistered) return;
  try {
    registerDynamicLanguage({ swift });
  } catch {
    // already registered in this process; treat as success
  }
  swiftRegistered = true;
}

export function languageToLang(language: string): string {
  const lang = LANG_MAP[language.toLowerCase()];
  if (lang === undefined) {
    throw new Error(`unsupported language "${language}"; supported: ${Object.keys(LANG_MAP).join(", ")}.`);
  }
  return lang;
}

function toPosixRelative(file: string, cwd: string): string {
  const rel = isAbsolute(file) ? relative(cwd, file) : file;
  return rel.split(sep).join("/");
}

// Shared file enumeration: glob → read → parse. Both resolveCodeAnchor (runs the symbol
// rule) and findParseErrors (runs the ERROR rule) consume this, so they provably see the
// identical file set and grammar. Unreadable globbed paths (e.g. directory matches) are
// skipped here exactly as the original resolveCodeAnchor did.
function parseAnchorFiles(anchor: CodeAnchor, cwd: string): ParsedFile[] {
  const lang = languageToLang(anchor.language);
  if (lang === "swift") ensureSwift();
  // anchors.ts guarantees repo-relative globs; globSync yields cwd-relative matches.
  const files = new Set<string>();
  for (const pattern of anchor.files) {
    for (const match of globSync(pattern, { cwd })) files.add(match);
  }
  const parsed: ParsedFile[] = [];
  for (const file of [...files].sort()) {
    const abs = isAbsolute(file) ? file : join(cwd, file);
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue; // globbed path unreadable (e.g. a directory match); skip
    }
    parsed.push({ file: toPosixRelative(file, cwd), root: parse(lang, source).root() });
  }
  return parsed;
}

export function resolveCodeAnchor(anchor: CodeAnchor, cwd: string): ResolvedLocation[] {
  const locations: ResolvedLocation[] = [];
  for (const { file, root } of parseAnchorFiles(anchor, cwd)) {
    for (const node of root.findAll({ rule: anchor.rule })) {
      const range = node.range();
      let symbol: string | undefined;
      try {
        symbol = node.field("name")?.text();
      } catch {
        symbol = undefined;
      }
      locations.push({
        file,
        startLine: range.start.line + 1,
        endLine: range.end.line + 1,
        ...(symbol ? { symbol } : {}),
      });
    }
  }
  return locations;
}

// Diagnostic companion to resolveCodeAnchor, called only on the 0-match (drift) path.
// Detects the universal tree-sitter `ERROR` node kind so a grammar-level parse failure
// (e.g. tree-sitter-swift's `#if` inside a type body) can be distinguished from a genuine
// rename. Language-agnostic: a syntactically broken TS/JS file lights up the same signal.
// Returns the first ERROR line for each affected file, in the shared enumeration order.
export function findParseErrors(anchor: CodeAnchor, cwd: string): ParseError[] {
  const errors: ParseError[] = [];
  for (const { file, root } of parseAnchorFiles(anchor, cwd)) {
    const errorNodes = root.findAll({ rule: { kind: "ERROR" } });
    if (errorNodes.length > 0) {
      errors.push({ file, line: errorNodes[0].range().start.line + 1 });
    }
  }
  return errors;
}
