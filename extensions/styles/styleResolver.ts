import fs from "node:fs";
import path from "node:path";

export const CONFIG_FILE = "_config.json";
export const RESERVED_STYLE_ARGS = new Set<string>(["auto", "off", "none", "clear"]);

export type WarningSink = (id: string, message: string) => void;
export type StyleSource = "file" | "folder";

export interface ListedStyle {
  name: string;
  source: StyleSource;
  reserved: boolean;
  label: string;
}

export interface ResolvedStyleContent {
  name: string;
  file: string;
  rawText: string;
  wrappedText: string;
}

interface ParsedAutoRule {
  index: number;
  models: string[];
  style: string;
}

interface ConfigCache {
  mtimeMs: number;
  rules: ParsedAutoRule[];
}

interface TextCacheEntry {
  mtimeMs: number;
  rawText: string;
  wrappedText: string;
}

export function isSafeVariantBasename(modelId: unknown): modelId is string {
  return (
    typeof modelId === "string" &&
    /^[A-Za-z0-9_.-]+$/.test(modelId) &&
    modelId !== "." &&
    modelId !== ".." &&
    !modelId.startsWith(".")
  );
}

export function isStyleBasename(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith("_") &&
    !name.toLowerCase().endsWith(".md") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

function safeStat(file: string): fs.Stats | null {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function isFile(st: fs.Stats | null): st is fs.Stats {
  return !!st && st.isFile();
}

function isDirectory(st: fs.Stats | null): st is fs.Stats {
  return !!st && st.isDirectory();
}

function stripMarkdownSuffix(filename: string): string {
  return filename.replace(/\.md$/i, "");
}

function sortedByName(styles: ListedStyle[]): ListedStyle[] {
  return [...styles].sort((a, b) => a.name.localeCompare(b.name));
}

function isReservedName(name: string): boolean {
  return RESERVED_STYLE_ARGS.has(name.toLowerCase());
}

function labelForStyle(name: string): string {
  return isReservedName(name) ? `${name} (style; direct /style ${name} is a command)` : name;
}

export class StyleResolver {
  private configCache: ConfigCache | null = null;
  private readonly contentCache = new Map<string, TextCacheEntry>();
  private readonly warned = new Set<string>();
  private warningSink: WarningSink | null;

  constructor(
    public readonly styleDir: string,
    warningSink?: WarningSink | null,
  ) {
    this.warningSink = warningSink ?? null;
  }

  setWarningSink(warningSink?: WarningSink | null): void {
    this.warningSink = warningSink ?? null;
  }

  clearCaches(): void {
    this.configCache = null;
    this.contentCache.clear();
  }

  ensureDir(): void {
    try {
      fs.mkdirSync(this.styleDir, { recursive: true });
    } catch {
      /* ignore directory creation errors; later reads/writes report their own failures */
    }
  }

  styleExists(name: string): boolean {
    if (!isStyleBasename(name)) return false;
    return isFile(safeStat(this.simpleFile(name))) || isFile(safeStat(this.defaultFile(name)));
  }

  listStyles(): ListedStyle[] {
    this.ensureDir();

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.styleDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const styles = new Map<string, ListedStyle>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith("_")) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;

      const name = stripMarkdownSuffix(entry.name);
      if (!isStyleBasename(name)) continue;
      const reserved = isReservedName(name);
      if (reserved) this.warnOnce(`style:reserved:${name}`, `styles: '${name}' is a reserved /style command word; direct activation selects the command, not the style.`);
      styles.set(name, { name, source: "file", reserved, label: labelForStyle(name) });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (!isStyleBasename(name)) continue;
      if (!isFile(safeStat(this.defaultFile(name)))) continue;

      const reserved = isReservedName(name);
      if (reserved) this.warnOnce(`style:reserved:${name}`, `styles: '${name}' is a reserved /style command word; direct activation selects the command, not the style.`);

      if (styles.has(name)) {
        this.warnOnce(
          `style:collision:${name}`,
          `styles: both '${name}.md' and '${name}/default.md' exist; using '${name}.md'.`,
        );
        continue;
      }

      styles.set(name, { name, source: "folder", reserved, label: labelForStyle(name) });
    }

    return sortedByName([...styles.values()]);
  }

  resolveAutoStyleName(modelId: unknown): string | null {
    if (typeof modelId !== "string" || modelId.length === 0) return null;

    for (const rule of this.readAutoRules()) {
      if (!rule.models.includes(modelId)) continue;
      if (this.styleExists(rule.style)) return rule.style;
      this.warnOnce(
        `config:missing-style:${rule.index}:${rule.style}`,
        `styles: auto rule ${rule.index} matched '${modelId}' but style '${rule.style}' does not exist.`,
      );
    }

    return null;
  }

  resolveStyleContent(name: unknown, modelId: unknown): ResolvedStyleContent | null {
    if (!isStyleBasename(name)) {
      this.warnOnce("style:invalid", `styles: invalid style name '${String(name)}'; expected a top-level style basename.`);
      return null;
    }

    const simplePath = this.simpleFile(name);
    const defaultPath = this.defaultFile(name);
    const simpleStat = safeStat(simplePath);
    const defaultStat = safeStat(defaultPath);
    const hasSimple = isFile(simpleStat);
    const hasDefault = isFile(defaultStat);

    if (hasSimple && hasDefault) {
      this.warnOnce(
        `style:collision:${name}`,
        `styles: both '${name}.md' and '${name}/default.md' exist; using '${name}.md'.`,
      );
    }

    if (hasSimple) return this.readMarkdown(name, simplePath, simpleStat);

    if (hasDefault) {
      let selectedPath = defaultPath;
      let selectedStat = defaultStat;
      if (isSafeVariantBasename(modelId)) {
        const variantPath = this.variantFile(name, modelId);
        const variantStat = safeStat(variantPath);
        if (isFile(variantStat)) {
          selectedPath = variantPath;
          selectedStat = variantStat;
        }
      }
      return this.readMarkdown(name, selectedPath, selectedStat);
    }

    if (isDirectory(safeStat(this.styleFolder(name)))) {
      this.warnOnce(
        `style:variant-missing-default:${name}`,
        `styles: '${name}' is a folder style but is missing default.md; no style injected.`,
      );
      return null;
    }

    this.warnOnce(`style:missing:${name}`, `styles: selected style '${name}' does not exist; no style injected.`);
    return null;
  }

  private readAutoRules(): ParsedAutoRule[] {
    const file = path.join(this.styleDir, CONFIG_FILE);
    const st = safeStat(file);
    if (!isFile(st)) {
      this.configCache = null;
      return [];
    }

    if (this.configCache && this.configCache.mtimeMs === st.mtimeMs) return this.configCache.rules;

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      this.warnOnce("config:parse", `styles: could not parse _config.json: ${(error as Error).message}`);
      this.configCache = { mtimeMs: st.mtimeMs, rules: [] };
      return [];
    }

    const auto = (parsed as { auto?: unknown } | null)?.auto;
    if (!Array.isArray(auto)) {
      this.warnOnce("config:auto", "styles: _config.json must contain an 'auto' array.");
      this.configCache = { mtimeMs: st.mtimeMs, rules: [] };
      return [];
    }

    const rules: ParsedAutoRule[] = [];
    auto.forEach((rule: unknown, index) => {
      const rawModel = (rule as { model?: unknown } | null)?.model;
      let models: string[] | null = null;

      if (typeof rawModel === "string") {
        models = [rawModel];
      } else if (Array.isArray(rawModel) && rawModel.every((item) => typeof item === "string")) {
        models = rawModel;
      }

      if (!models) {
        this.warnOnce(`config:rule:${index}:model`, `styles: _config.json auto rule ${index} has invalid 'model'; expected string or string array.`);
        return;
      }

      const style = (rule as { style?: unknown } | null)?.style;
      if (typeof style !== "string" || !isStyleBasename(style)) {
        this.warnOnce(`config:rule:${index}:style`, `styles: _config.json auto rule ${index} has invalid 'style'; expected a top-level style name.`);
        return;
      }

      rules.push({ index, models, style });
    });

    this.configCache = { mtimeMs: st.mtimeMs, rules };
    return rules;
  }

  private readMarkdown(name: string, file: string, st: fs.Stats): ResolvedStyleContent | null {
    const absoluteFile = path.resolve(file);
    const cached = this.contentCache.get(absoluteFile);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      if (!cached.wrappedText) return null;
      return { name, file: absoluteFile, rawText: cached.rawText, wrappedText: cached.wrappedText };
    }

    const rawText = fs.readFileSync(absoluteFile, "utf8").trim();
    const wrappedText = rawText ? `<userStyle>\n${rawText}\n</userStyle>` : "";
    this.contentCache.set(absoluteFile, { mtimeMs: st.mtimeMs, rawText, wrappedText });

    if (!wrappedText) return null;
    return { name, file: absoluteFile, rawText, wrappedText };
  }

  private warnOnce(id: string, message: string): void {
    if (this.warned.has(id)) return;
    if (!this.warningSink) return;
    this.warned.add(id);
    this.warningSink(id, message);
  }

  private simpleFile(name: string): string {
    return path.join(this.styleDir, `${name}.md`);
  }

  private styleFolder(name: string): string {
    return path.join(this.styleDir, name);
  }

  private defaultFile(name: string): string {
    return path.join(this.styleFolder(name), "default.md");
  }

  private variantFile(name: string, modelId: string): string {
    return path.join(this.styleFolder(name), `${modelId}.md`);
  }
}
