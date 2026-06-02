/**
 * styles — claude.ai-style output styles for Pi.
 *
 * A `/style` command lists the styles in ./styles/*.md, lets you create a new
 * one, or turn styling off. The active style is injected EPHEMERALLY into every
 * provider request as a trailing <userStyle> block — never persisted to the
 * session, never accumulating, only ever the last thing the model sees.
 *
 * Injection happens in `before_provider_request` (after serialization, after
 * cache_control is locked) and is dispatched per `model.api`, so switching
 * models mid-session is handled automatically. See ./injectors.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { INJECTORS, genericFallback } from "./injectors";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = path.join(HERE, "styles");
const ACTIVE_ENTRY = "styles:active";
const DEBUG = !!process.env.PI_STYLES_DEBUG;

const ACT_CREATE = "➕  Create new style…";
const ACT_OFF = "⊘  None (turn off styles)";

function debug(...args: unknown[]) {
  if (DEBUG) console.error("[styles]", ...args);
}

function ensureDir() {
  try {
    fs.mkdirSync(STYLE_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
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

function styleFile(name: string): string {
  return path.join(STYLE_DIR, `${name}.md`);
}

function listStyles(): string[] {
  ensureDir();
  try {
    return fs
      .readdirSync(STYLE_DIR)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .map((f) => f.replace(/\.md$/i, ""))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export default function styles(pi: ExtensionAPI) {
  let activeName: string | null = null;
  let cache: { name: string; mtimeMs: number; text: string } | null = null;
  const warnedApis = new Set<string>();

  /** Read + wrap a style file, cached by mtime so manual edits are picked up. */
  function readStyleText(name: string): string | null {
    const file = styleFile(name);
    try {
      const st = fs.statSync(file);
      if (cache && cache.name === name && cache.mtimeMs === st.mtimeMs) return cache.text;
      const raw = fs.readFileSync(file, "utf8").trim();
      const text = raw ? `<userStyle>\n${raw}\n</userStyle>` : "";
      cache = { name, mtimeMs: st.mtimeMs, text };
      return text;
    } catch {
      return null;
    }
  }

  function updateFooter(ctx: any) {
    ctx?.ui?.setStatus?.("style", activeName ? `style: ${activeName}` : undefined);
  }

  function setActive(name: string | null, ctx: any, persist = true) {
    activeName = name;
    cache = null;
    if (persist) {
      try {
        pi.appendEntry(ACTIVE_ENTRY, { name });
      } catch {
        /* ephemeral session: in-memory only */
      }
    }
    updateFooter(ctx);
    debug("setActive", name);
  }

  // ---- restore active style on session start / reload / resume ----
  pi.on("session_start", async (_event, ctx) => {
    activeName = null;
    cache = null;
    try {
      const sm: any = ctx.sessionManager;
      const entries = sm.getBranch?.() ?? sm.getEntries?.() ?? [];
      for (const entry of entries) {
        if (entry?.type === "custom" && entry?.customType === ACTIVE_ENTRY) {
          const n = entry?.data?.name;
          activeName = typeof n === "string" ? n : null;
        }
      }
    } catch {
      /* ignore */
    }
    if (activeName && !fs.existsSync(styleFile(activeName))) activeName = null;
    updateFooter(ctx);
    debug("session_start active=", activeName);
  });

  // ---- ephemeral payload-layer injection ----
  pi.on("before_provider_request", (event, ctx) => {
    if (!activeName) return;
    const text = readStyleText(activeName);
    if (!text) return; // missing or empty -> no-op

    const api = (ctx as any).model?.api as string | undefined;
    try {
      const inject = api ? INJECTORS[api] : undefined;
      if (inject) {
        inject(event.payload, text);
        debug("injected", { api, style: activeName });
        return event.payload;
      }

      // Unknown api: generic best-effort + one-time warning.
      const key = api ?? "unknown";
      const ok = genericFallback(event.payload, text);
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
      return; // leave payload unchanged
    }
  });

  // ---- create-new-style flow ----
  async function runCreate(ctx: any) {
    const rawName = await ctx.ui.input("New style name:", "e.g. concise, socratic, code-only");
    if (!rawName) return;
    const name = slugify(rawName);
    const file = styleFile(name);
    if (fs.existsSync(file)) {
      const ok = await ctx.ui.confirm("Overwrite?", `Style '${name}' already exists. Overwrite it?`);
      if (!ok) return;
    }
    const seed =
      "Write the instructions that should shape responses here.\n\n" +
      "- Tone and voice\n- Length and structure\n- Formatting preferences\n";
    const content = await ctx.ui.editor(`Style: ${name}`, seed);
    if (content == null) return;
    ensureDir();
    fs.writeFileSync(file, `${content.trim()}\n`, "utf8");
    setActive(name, ctx);
    ctx.ui.notify(`Created and activated style '${name}'.`, "info");
  }

  /** Direct activation via `/style <name|off>`. Returns true if it consumed the arg. */
  function activateByName(arg: string, ctx: any): boolean {
    const a = arg.trim();
    if (!a) return false;
    if (/^(off|none|clear)$/i.test(a)) {
      setActive(null, ctx);
      ctx.ui.notify("Styles turned off.", "info");
      return true;
    }
    const names = listStyles();
    const slug = slugify(a);
    const match =
      names.find((n) => n === a) ??
      names.find((n) => n === slug) ??
      names.find((n) => n.toLowerCase() === a.toLowerCase());
    if (!match) {
      ctx.ui.notify(`No style named '${a}'.`, "warning");
      return true;
    }
    setActive(match, ctx);
    ctx.ui.notify(`Style '${match}' activated.`, "info");
    return true;
  }

  pi.registerCommand("style", {
    description: "Select, create, or turn off an output style (ephemeral <userStyle> injection)",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        ...listStyles().map((n) => ({ value: n, label: n })),
        { value: "off", label: "off (turn off)" },
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length ? filtered : null;
    },
    handler: async (args: string, ctx: any) => {
      if (args && args.trim()) {
        activateByName(args, ctx);
        return;
      }
      const names = listStyles();
      const options = [
        ...names.map((n) => (n === activeName ? `✓ ${n}` : `  ${n}`)),
        ACT_OFF,
        ACT_CREATE,
      ];
      const choice = await ctx.ui.select("Output style", options);
      if (!choice) return;
      if (choice === ACT_CREATE) {
        await runCreate(ctx);
        return;
      }
      if (choice === ACT_OFF) {
        setActive(null, ctx);
        ctx.ui.notify("Styles turned off.", "info");
        return;
      }
      const name = choice.replace(/^(✓ |  )/, "");
      setActive(name, ctx);
      ctx.ui.notify(`Style '${name}' activated.`, "info");
    },
  });
}
