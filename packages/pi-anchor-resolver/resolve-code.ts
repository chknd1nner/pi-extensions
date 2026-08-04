import { globSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { Lang, parse, registerDynamicLanguage } from "@ast-grep/napi";
import swift from "@ast-grep/lang-swift";
import type { CodeAnchor, ResolvedLocation } from "./types.js";

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

export function resolveCodeAnchor(anchor: CodeAnchor, cwd: string): ResolvedLocation[] {
  const lang = languageToLang(anchor.language);
  if (lang === "swift") ensureSwift();
  // anchors.ts guarantees repo-relative globs; globSync yields cwd-relative matches.
  const files = new Set<string>();
  for (const pattern of anchor.files) {
    for (const match of globSync(pattern, { cwd })) files.add(match);
  }
  const locations: ResolvedLocation[] = [];
  for (const file of [...files].sort()) {
    const abs = isAbsolute(file) ? file : join(cwd, file);
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue; // globbed path unreadable (e.g. a directory match); skip
    }
    const root = parse(lang, source).root();
    for (const node of root.findAll({ rule: anchor.rule })) {
      const range = node.range();
      let symbol: string | undefined;
      try {
        symbol = node.field("name")?.text();
      } catch {
        symbol = undefined;
      }
      locations.push({
        file: toPosixRelative(file, cwd),
        startLine: range.start.line + 1,
        endLine: range.end.line + 1,
        ...(symbol ? { symbol } : {}),
      });
    }
  }
  return locations;
}
