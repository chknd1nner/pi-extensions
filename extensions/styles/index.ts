/**
 * styles — claude.ai-style output styles for Pi.
 *
 * A `/style` command selects a sticky style mode:
 *
 *   - off: inject nothing
 *   - manual: inject one named style, with optional per-model variants
 *   - auto: choose a style from styles/_config.json by exact model ID
 *
 * The resolved style text is injected EPHEMERALLY into every provider request as
 * a trailing <userStyle> block. It is never persisted to the session and never
 * accumulates in conversation history.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { INJECTORS, genericFallback } from "./injectors";
import {
  RESERVED_STYLE_ARGS,
  StyleResolver,
  type ListedStyle,
  type StyleRoot,
  type StyleScope,
} from "./styleResolver";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Read-only bundled styles that ship with the extension package. */
export const BUNDLED_STYLE_DIR = path.join(HERE, "styles");
/** @deprecated Use BUNDLED_STYLE_DIR; kept for callers that imported the old name. */
export const DEFAULT_STYLE_DIR = BUNDLED_STYLE_DIR;

/**
 * Layered style roots, ordered project → home → bundled. Lookups walk in
 * order so project entries shadow home, which shadow bundled. Auto rules are
 * concatenated and matched first-wins, giving the same precedence without
 * losing home-defined rules for models the project doesn't override.
 */
export function defaultStyleRoots(cwd: string, home: string = os.homedir()): StyleRoot[] {
  return [
    { dir: path.join(cwd, ".pi", "extensions", "styles", "styles"), scope: "project" },
    { dir: path.join(home, ".pi", "agent", "extensions", "styles", "styles"), scope: "home" },
    { dir: BUNDLED_STYLE_DIR, scope: "bundled" },
  ];
}
const ACTIVE_ENTRY = "styles:active";
const DEBUG = !!process.env.PI_STYLES_DEBUG;

const ACT_CREATE = "➕  Create new style…";
const ACT_AUTO = "Auto (choose style by model)";
const ACT_OFF = "None (turn off styles)";

type StyleMode =
  | { kind: "off" }
  | { kind: "manual"; name: string }
  | { kind: "auto" };

export interface StylesExtensionOptions {
  /** Legacy/test override: treat a single directory as the sole project root. */
  styleDir?: string;
  /** Explicit root list (overrides default discovery entirely). For tests/embedders. */
  styleRoots?: StyleRoot[];
}

function debug(...args: unknown[]) {
  if (DEBUG) console.error("[styles]", ...args);
}

function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "style"
  );
}

function modeEntry(mode: StyleMode): unknown {
  if (mode.kind === "auto") return { auto: true };
  if (mode.kind === "manual") return { name: mode.name };
  return { name: null };
}

function restoreModeFromEntries(entries: any[]): StyleMode {
  let mode: StyleMode = { kind: "off" };
  for (const entry of entries) {
    if (entry?.type !== "custom" || entry?.customType !== ACTIVE_ENTRY) continue;
    const data = entry.data;
    if (data?.auto === true) {
      mode = { kind: "auto" };
    } else if (data && Object.prototype.hasOwnProperty.call(data, "name")) {
      mode = typeof data.name === "string" ? { kind: "manual", name: data.name } : { kind: "off" };
    }
  }
  return mode;
}

function styleChoiceLabel(
  style: ListedStyle,
  currentMode: StyleMode,
  showScope: boolean,
): string {
  const mark = currentMode.kind === "manual" && currentMode.name === style.name ? "✓" : " ";
  // Only show scope when multiple scopes are present so single-root setups
  // (and existing tests) keep the clean "  concise" form.
  if (!showScope) return `${mark} ${style.label}`;
  return `${mark} ${style.label} (${scopeText(style.scope)})`;
}

function actionChoiceLabel(active: boolean, label: string): string {
  return `${active ? "✓" : " "} ${label}`;
}

function directStyleNames(styles: ListedStyle[]): string[] {
  return styles.filter((style) => !style.reserved).map((style) => style.name);
}

function scopeText(scope: StyleScope): string {
  return scope === "bundled" ? "built-in" : scope;
}

export function registerStyles(pi: ExtensionAPI, options: StylesExtensionOptions = {}): void {
  let currentCwd = process.cwd();

  function resolveRoots(): StyleRoot[] {
    if (options.styleRoots) return options.styleRoots;
    if (options.styleDir) return [{ dir: options.styleDir, scope: "project" }];
    return defaultStyleRoots(currentCwd);
  }

  const resolver = new StyleResolver(() => resolveRoots());
  let mode: StyleMode = { kind: "off" };
  let lastAutoResolved: string | null = null;
  const warnedApis = new Set<string>();

  function attachWarnings(ctx: any): void {
    resolver.setWarningSink((_id, message) => ctx?.ui?.notify?.(message, "warning"));
  }

  function updateFooter(ctx: any): void {
    if (mode.kind === "off") {
      ctx?.ui?.setStatus?.("style", undefined);
    } else if (mode.kind === "manual") {
      ctx?.ui?.setStatus?.("style", `style: ${mode.name}`);
    } else {
      ctx?.ui?.setStatus?.("style", lastAutoResolved ? `style: ${lastAutoResolved} (auto)` : "style: auto");
    }
  }

  function setMode(nextMode: StyleMode, ctx: any, persist = true): void {
    attachWarnings(ctx);
    mode = nextMode;
    lastAutoResolved = null;
    if (persist) {
      try {
        pi.appendEntry(ACTIVE_ENTRY, modeEntry(mode));
      } catch {
        /* ephemeral session: in-memory only */
      }
    }
    updateFooter(ctx);
    debug("setMode", mode);
  }

  async function runCreate(ctx: any): Promise<void> {
    attachWarnings(ctx);
    const rawName = await ctx.ui.input("New style name:", "e.g. concise, socratic, code-only");
    if (!rawName) return;

    let name = slugify(rawName);
    if (RESERVED_STYLE_ARGS.has(name)) {
      const renamed = `${name}-style`;
      ctx.ui.notify(`'${name}' is reserved for /style commands; creating '${renamed}' instead.`, "warning");
      name = renamed;
    }

    // Always write to the project-scoped dir — "create" expresses intent.
    const targetDir = resolver.writableDir();
    const file = path.join(targetDir, `${name}.md`);
    if (fs.existsSync(file) || resolver.styleExists(name)) {
      const ok = await ctx.ui.confirm("Overwrite?", `Style '${name}' already exists. Create or overwrite '${name}.md'?`);
      if (!ok) return;
    }

    const seed =
      "Write the instructions that should shape responses here.\n\n" +
      "- Tone and voice\n- Length and structure\n- Formatting preferences\n";
    const content = await ctx.ui.editor(`Style: ${name}`, seed);
    if (content == null) return;

    resolver.ensureWritableDir();
    fs.writeFileSync(file, `${content.trim()}\n`, "utf8");
    resolver.clearCaches();
    setMode({ kind: "manual", name }, ctx);
    ctx.ui.notify(`Created and activated style '${name}'.`, "info");
  }

  function activateByName(arg: string, ctx: any): boolean {
    attachWarnings(ctx);
    const a = arg.trim();
    if (!a) return false;

    const lower = a.toLowerCase();
    // Handle both raw args ("off") and completion labels ("off (turn off)")
    if (lower === "auto" || lower.startsWith("auto ")) {
      setMode({ kind: "auto" }, ctx);
      ctx.ui.notify("Auto style mode enabled.", "info");
      return true;
    }

    if (lower === "off" || lower.startsWith("off ") || lower === "none" || lower === "clear") {
      setMode({ kind: "off" }, ctx);
      ctx.ui.notify("Styles turned off.", "info");
      return true;
    }

    const names = directStyleNames(resolver.listStyles());
    const slug = slugify(a);
    const match =
      names.find((n) => n === a) ??
      names.find((n) => n === slug) ??
      names.find((n) => n.toLowerCase() === a.toLowerCase());

    if (!match) {
      ctx.ui.notify(`No style named '${a}'.`, "warning");
      return true;
    }

    setMode({ kind: "manual", name: match }, ctx);
    ctx.ui.notify(`Style '${match}' activated.`, "info");
    return true;
  }

  pi.on("session_start", async (_event, ctx) => {
    attachWarnings(ctx);
    if (typeof (ctx as any).cwd === "string" && (ctx as any).cwd) {
      currentCwd = (ctx as any).cwd;
      resolver.clearCaches();
    }
    lastAutoResolved = null;
    try {
      const sm: any = ctx.sessionManager;
      const entries = sm.getBranch?.() ?? sm.getEntries?.() ?? [];
      mode = restoreModeFromEntries(entries);
    } catch {
      mode = { kind: "off" };
    }
    updateFooter(ctx);
    debug("session_start mode=", mode, "cwd=", currentCwd);
  });

  pi.on("before_provider_request", (event, ctx) => {
    attachWarnings(ctx);
    if (mode.kind === "off") return;

    const modelId = typeof (ctx as any).model?.id === "string" ? (ctx as any).model.id : undefined;
    let styleName: string | null = null;

    if (mode.kind === "manual") {
      styleName = mode.name;
    } else {
      const previousAutoResolved = lastAutoResolved;
      styleName = resolver.resolveAutoStyleName(modelId);
      lastAutoResolved = styleName;
      updateFooter(ctx);
      if (styleName && styleName !== previousAutoResolved) {
        ctx.ui?.notify?.(`Auto style resolved to '${styleName}'.`, "info");
      }
    }

    if (!styleName) return;

    const resolved = resolver.resolveStyleContent(styleName, modelId);
    if (!resolved) return;

    const api = (ctx as any).model?.api as string | undefined;
    try {
      const inject = api ? INJECTORS[api] : undefined;
      if (inject) {
        inject(event.payload, resolved.wrappedText);
        debug("injected", { api, style: styleName, file: resolved.file });
        return event.payload;
      }

      const key = api ?? "unknown";
      const ok = genericFallback(event.payload, resolved.wrappedText);
      if (!warnedApis.has(key)) {
        warnedApis.add(key);
        ctx.ui?.notify?.(
          `styles: '${key}' not explicitly supported — using generic injection; caching path unverified.`,
          "warning",
        );
      }
      debug(ok ? "generic injected" : "no injection (unrecognized payload)", { api });
      return ok ? event.payload : undefined;
    } catch (e) {
      ctx.ui?.notify?.(
        `styles: skipped injection (${api ?? "?"}): ${(e as Error).message}`,
        "warning",
      );
      debug("inject error", e);
      return;
    }
  });

  pi.registerCommand("style", {
    description: "Select, create, auto-route, or turn off an output style (ephemeral <userStyle> injection)",
    getArgumentCompletions: (prefix: string) => {
      resolver.setWarningSink(null);
      const items = [
        ...directStyleNames(resolver.listStyles()).map((n) => ({ value: n, label: n })),
        { value: "auto", label: "auto (choose style by model)" },
        { value: "off", label: "off (turn off)" },
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length ? filtered : null;
    },
    handler: async (args: string, ctx: any) => {
      attachWarnings(ctx);
      if (args && args.trim()) {
        activateByName(args, ctx);
        return;
      }

      const styles = resolver.listStyles();
      const showScope = new Set(styles.map((s) => s.scope)).size > 1;
      const optionToName = new Map<string, string>();
      const styleOptions = styles.map((style) => {
        const label = styleChoiceLabel(style, mode, showScope);
        optionToName.set(label, style.name);
        return label;
      });
      const autoChoice = actionChoiceLabel(mode.kind === "auto", ACT_AUTO);
      const offChoice = actionChoiceLabel(mode.kind === "off", ACT_OFF);
      const optionsForPicker = [...styleOptions, autoChoice, offChoice, ACT_CREATE];

      const choice = await ctx.ui.select("Output style", optionsForPicker);
      if (!choice) return;

      if (choice === ACT_CREATE) {
        await runCreate(ctx);
        return;
      }

      if (choice === autoChoice) {
        setMode({ kind: "auto" }, ctx);
        ctx.ui.notify("Auto style mode enabled.", "info");
        return;
      }

      if (choice === offChoice) {
        setMode({ kind: "off" }, ctx);
        ctx.ui.notify("Styles turned off.", "info");
        return;
      }

      const name = optionToName.get(choice);
      if (!name) return;
      setMode({ kind: "manual", name }, ctx);
      ctx.ui.notify(`Style '${name}' activated.`, "info");
    },
  });
}

export default function styles(pi: ExtensionAPI) {
  registerStyles(pi);
}
