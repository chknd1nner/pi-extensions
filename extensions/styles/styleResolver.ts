import fs from "node:fs";
import path from "node:path";

export const CONFIG_FILE = "_config.json";
export const RESERVED_STYLE_ARGS = new Set<string>(["auto", "off", "none", "clear"]);

export type WarningSink = (id: string, message: string) => void;
export type StyleSource = "file" | "folder";
export type StyleScope = "project" | "home";

export interface StyleRoot {
  dir: string;
  scope: StyleScope;
}

export interface ListedStyle {
  name: string;
  source: StyleSource;
  scope: StyleScope;
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
  scope: StyleScope;
  models: string[];
  style: string;
}

interface ConfigFileCacheEntry {
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

export type StyleResolverRootsInput = string | StyleRoot[] | (() => StyleRoot[]);

function normalizeRootsInput(input: StyleResolverRootsInput): () => StyleRoot[] {
  if (typeof input === "string") {
    const roots: StyleRoot[] = [{ dir: input, scope: "project" }];
    return () => roots;
  }
  if (typeof input === "function") return input;
  return () => input;
}

export class StyleResolver {
  private readonly configFileCache = new Map<string, ConfigFileCacheEntry>();
  private readonly contentCache = new Map<string, TextCacheEntry>();
  private readonly warned = new Set<string>();
  private warningSink: WarningSink | null;
  private readonly rootsProvider: () => StyleRoot[];

  constructor(roots: StyleResolverRootsInput, warningSink?: WarningSink | null) {
    this.rootsProvider = normalizeRootsInput(roots);
    this.warningSink = warningSink ?? null;
  }

  setWarningSink(warningSink?: WarningSink | null): void {
    this.warningSink = warningSink ?? null;
  }

  clearCaches(): void {
    this.configFileCache.clear();
    this.contentCache.clear();
  }

  /**
   * Roots in lookup order: project → home.
   * Deduplicated by resolved absolute path so configurations that accidentally
   * point two scopes at the same directory don't get scanned twice. First
   * occurrence wins, preserving scope precedence.
   */
  roots(): StyleRoot[] {
    const seen = new Set<string>();
    const out: StyleRoot[] = [];
    for (const root of this.rootsProvider()) {
      const key = path.resolve(root.dir);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(root);
    }
    return out;
  }

  /**
   * Directory new styles should be written to. Project wins; otherwise the
   * first declared root. Treats "closest to user intent" as project-scoped.
   */
  writableDir(): string {
    const roots = this.roots();
    const project = roots.find((r) => r.scope === "project");
    if (project) return project.dir;
    if (roots[0]) return roots[0].dir;
    throw new Error("styles: no roots configured");
  }

  ensureWritableDir(): void {
    try {
      fs.mkdirSync(this.writableDir(), { recursive: true });
    } catch {
      /* ignore directory creation errors; later reads/writes report their own failures */
    }
  }

  styleExists(name: string): boolean {
    if (!isStyleBasename(name)) return false;
    for (const root of this.roots()) {
      if (isFile(safeStat(this.simpleFile(root.dir, name)))) return true;
      if (isFile(safeStat(this.defaultFile(root.dir, name)))) return true;
    }
    return false;
  }

  listStyles(): ListedStyle[] {
    const styles = new Map<string, ListedStyle>(); // first-write wins → project shadows home shadows bundled

    for (const root of this.roots()) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root.dir, { withFileTypes: true });
      } catch {
        continue; // missing root is fine — layered discovery
      }

      const localFiles = new Set<string>();

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith("_")) continue;
        if (!entry.name.toLowerCase().endsWith(".md")) continue;

        const name = stripMarkdownSuffix(entry.name);
        if (!isStyleBasename(name)) continue;
        localFiles.add(name);

        const reserved = isReservedName(name);
        if (reserved) {
          this.warnOnce(
            `style:reserved:${root.scope}:${name}`,
            `styles: '${name}' is a reserved /style command word; direct activation selects the command, not the style.`,
          );
        }
        if (!styles.has(name)) {
          styles.set(name, {
            name,
            source: "file",
            scope: root.scope,
            reserved,
            label: labelForStyle(name),
          });
        }
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (!isStyleBasename(name)) continue;
        if (!isFile(safeStat(this.defaultFile(root.dir, name)))) continue;

        if (localFiles.has(name)) {
          // collision is per-root — name.md beats name/default.md in the same root
          this.warnOnce(
            `style:collision:${root.scope}:${name}`,
            `styles: both '${name}.md' and '${name}/default.md' exist in ${root.scope} styles dir; using '${name}.md'.`,
          );
          continue;
        }

        const reserved = isReservedName(name);
        if (reserved) {
          this.warnOnce(
            `style:reserved:${root.scope}:${name}`,
            `styles: '${name}' is a reserved /style command word; direct activation selects the command, not the style.`,
          );
        }
        if (!styles.has(name)) {
          styles.set(name, {
            name,
            source: "folder",
            scope: root.scope,
            reserved,
            label: labelForStyle(name),
          });
        }
      }
    }

    return sortedByName([...styles.values()]);
  }

  resolveAutoStyleName(modelId: unknown): string | null {
    if (typeof modelId !== "string" || modelId.length === 0) return null;

    for (const rule of this.readAutoRules()) {
      if (!rule.models.includes(modelId)) continue;
      if (this.styleExists(rule.style)) return rule.style;
      this.warnOnce(
        `config:missing-style:${rule.scope}:${rule.index}:${rule.style}`,
        `styles: auto rule ${rule.index} in ${rule.scope} _config.json matched '${modelId}' but style '${rule.style}' does not exist.`,
      );
    }

    return null;
  }

  resolveStyleContent(name: unknown, modelId: unknown): ResolvedStyleContent | null {
    if (!isStyleBasename(name)) {
      this.warnOnce(
        "style:invalid",
        `styles: invalid style name '${String(name)}'; expected a top-level style basename.`,
      );
      return null;
    }

    for (const root of this.roots()) {
      const simplePath = this.simpleFile(root.dir, name);
      const defaultPath = this.defaultFile(root.dir, name);
      const simpleStat = safeStat(simplePath);
      const defaultStat = safeStat(defaultPath);
      const hasSimple = isFile(simpleStat);
      const hasDefault = isFile(defaultStat);

      if (hasSimple && hasDefault) {
        this.warnOnce(
          `style:collision:${root.scope}:${name}`,
          `styles: both '${name}.md' and '${name}/default.md' exist in ${root.scope} styles dir; using '${name}.md'.`,
        );
      }

      if (hasSimple) return this.readMarkdown(name, simplePath, simpleStat);

      if (hasDefault) {
        let selectedPath = defaultPath;
        let selectedStat = defaultStat;
        if (isSafeVariantBasename(modelId)) {
          const variantPath = this.variantFile(root.dir, name, modelId);
          const variantStat = safeStat(variantPath);
          if (isFile(variantStat)) {
            selectedPath = variantPath;
            selectedStat = variantStat;
          }
        }
        return this.readMarkdown(name, selectedPath, selectedStat);
      }
      // else: try next root
    }

    // No root resolved the name — give the most useful warning we can.
    for (const root of this.roots()) {
      if (isDirectory(safeStat(this.styleFolder(root.dir, name)))) {
        this.warnOnce(
          `style:variant-missing-default:${root.scope}:${name}`,
          `styles: '${name}' is a folder style in ${root.scope} styles dir but is missing default.md; no style injected.`,
        );
        return null;
      }
    }

    this.warnOnce(
      `style:missing:${name}`,
      `styles: selected style '${name}' does not exist; no style injected.`,
    );
    return null;
  }

  private readAutoRules(): ParsedAutoRule[] {
    // Concatenate rules from every existing _config.json in root order.
    // First-match-wins during lookup means project rules override home rules
    // for the same model, but home rules for other models still apply.
    const all: ParsedAutoRule[] = [];
    for (const root of this.roots()) {
      const file = path.join(root.dir, CONFIG_FILE);
      const st = safeStat(file);
      if (!isFile(st)) {
        this.configFileCache.delete(file);
        continue;
      }

      const cached = this.configFileCache.get(file);
      if (cached && cached.mtimeMs === st.mtimeMs) {
        all.push(...cached.rules);
        continue;
      }

      const rules = this.parseConfigFile(file, root.scope);
      this.configFileCache.set(file, { mtimeMs: st.mtimeMs, rules });
      all.push(...rules);
    }
    return all;
  }

  private parseConfigFile(file: string, scope: StyleScope): ParsedAutoRule[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      this.warnOnce(
        `config:parse:${scope}`,
        `styles: could not parse ${scope} _config.json: ${(error as Error).message}`,
      );
      return [];
    }

    const auto = (parsed as { auto?: unknown } | null)?.auto;
    if (!Array.isArray(auto)) {
      this.warnOnce(
        `config:auto:${scope}`,
        `styles: ${scope} _config.json must contain an 'auto' array.`,
      );
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
        this.warnOnce(
          `config:rule:${scope}:${index}:model`,
          `styles: ${scope} _config.json auto rule ${index} has invalid 'model'; expected string or string array.`,
        );
        return;
      }

      const style = (rule as { style?: unknown } | null)?.style;
      if (typeof style !== "string" || !isStyleBasename(style)) {
        this.warnOnce(
          `config:rule:${scope}:${index}:style`,
          `styles: ${scope} _config.json auto rule ${index} has invalid 'style'; expected a top-level style name.`,
        );
        return;
      }

      rules.push({ index, scope, models, style });
    });

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

  private simpleFile(dir: string, name: string): string {
    return path.join(dir, `${name}.md`);
  }

  private styleFolder(dir: string, name: string): string {
    return path.join(dir, name);
  }

  private defaultFile(dir: string, name: string): string {
    return path.join(this.styleFolder(dir, name), "default.md");
  }

  private variantFile(dir: string, name: string, modelId: string): string {
    return path.join(this.styleFolder(dir, name), `${modelId}.md`);
  }
}
