# Bright Data Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `pi-brightdata-tools` Pi extension with Bright Data SERP search, Unlocker fetch, adaptive PDF extraction, storage/retrieval, and compact TUI rendering.

**Architecture:** The extension is split into focused modules: config loading, Bright Data HTTP client, pure URL/search helpers, request safety, output safety, storage/disk persistence, HTML fetch, PDF extraction, renderers, and Pi tool registration. Tools delegate to pure modules so most behavior is unit-testable without launching Pi. URL/request hardening lives in `request-safety.ts`; output truncation/untrusted-content handling lives in `output-safety.ts`.

**Tech Stack:** TypeScript ESM, Pi extension API from `@earendil-works/pi-coding-agent`, schemas via `typebox` and `StringEnum` from `@earendil-works/pi-ai`, TUI `Text` from `@earendil-works/pi-tui`, concurrency via `p-limit`, PDF parsing via `unpdf`, tests via Vitest.

---

## Files and responsibilities

Create these files under `extensions/brightdata/`:

- `package.json` — package metadata, Pi manifest, scripts, dependencies.
- `tsconfig.json` — strict TypeScript config matching existing extension packages.
- `types.ts` — shared config/result/storage types.
- `config.ts` — `~/.pi/brightdata.json` loading, defaults, env override handling.
- `urls.ts` — pure URL helpers and SERP URL construction; no security policy beyond basic parsing/canonicalization helpers.
- `request-safety.ts` — centralized request target validation, local/private/link-local blocking, manual redirect validation for local fetches, and `UnsafeUrlError`.
- `output-safety.ts` — centralized truncation and saved-path guidance for large/untrusted tool outputs.
- `brightdata-client.ts` — Bright Data `/request` wrapper, timeout/abort/error handling.
- `search.ts` — SERP request construction, response parsing, result normalization, Markdown formatting.
- `storage.ts` — response IDs, in-memory map, `pi.appendEntry` payloads, session restore, disk persistence for large content.
- `fetch.ts` — normal page fetch through Unlocker, multi-URL orchestration, PDF response detection/routing, truncation/disk save decisions.
- `pdf.ts` — direct/Bright Data PDF byte fetching, `unpdf` parsing, adaptive inline-vs-file output.
- `render.ts` — compact tool call/result renderers.
- `index.ts` — Pi tool schemas, registration, `session_start` restore, tool execution wiring.
- `README.md` — config, usage, smoke test instructions.
- `tests/*.test.ts` — Vitest unit tests.

Do not touch `pi-web-access` files.

---

### Task 1: Scaffold package, shared types, and config loader

**Files:**
- Create: `extensions/brightdata/package.json`
- Create: `extensions/brightdata/tsconfig.json`
- Create: `extensions/brightdata/types.ts`
- Create: `extensions/brightdata/config.ts`
- Create: `extensions/brightdata/tests/config.test.ts`

- [ ] **Step 1: Create package metadata**

Create `extensions/brightdata/package.json`:

```json
{
  "name": "pi-brightdata-tools",
  "version": "0.1.0",
  "description": "Bright Data SERP search, Unlocker fetch, and adaptive PDF extraction tools for Pi.",
  "keywords": [
    "pi-package",
    "pi-extension",
    "brightdata",
    "web-search",
    "web-fetch"
  ],
  "license": "MIT",
  "type": "module",
  "files": [
    "*.ts",
    "README.md"
  ],
  "pi": {
    "extensions": [
      "./index.ts"
    ]
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "p-limit": "^6.2.0",
    "unpdf": "^1.6.2"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-ai": "latest",
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-tui": "latest",
    "typebox": "latest",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

Create `extensions/brightdata/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

Run:

```bash
cd extensions/brightdata && npm install
```

Expected: `package-lock.json` is created and install exits with code 0.

- [ ] **Step 2: Write failing config tests**

Create `extensions/brightdata/tests/config.test.ts`:

```ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const ORIGINAL_ENV = { ...process.env };

function makeHome() {
  const dir = join(tmpdir(), `brightdata-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(dir, ".pi"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function loadFresh() {
  vi.resetModules();
  return await import("../config.js");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadBrightDataConfig", () => {
  it("uses defaults when ~/.pi/brightdata.json is missing", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const { loadBrightDataConfig } = await loadFresh();

    const config = loadBrightDataConfig();

    expect(config.brightdata.serpZone).toBe("pi_serp_api");
    expect(config.brightdata.unlockerZone).toBe("mcp_unlocker");
    expect(config.brightdata.defaultCountry).toBe("au");
    expect(config.search.maxResults).toBe(20);
    expect(config.fetch.maxInlineChars).toBe(30000);
    expect(config.fetch.outputDir).toBe(".pi/brightdata/pages");
    expect(config.pdf.outputDir).toBe(".pi/brightdata/pdfs");
  });

  it("loads camelCase JSON values", async () => {
    const home = makeHome();
    process.env.HOME = home;
    writeFileSync(join(home, ".pi", "brightdata.json"), JSON.stringify({
      brightdata: { serpZone: "serp_custom", unlockerZone: "unlock_custom", defaultCountry: "us", defaultLanguage: "fr", concurrency: 2 },
      search: { defaultEngine: "bing", defaultLimit: 7, maxQueries: 4, maxResults: 9 },
      fetch: { maxUrls: 3, maxInlineChars: 12000, preferMarkdown: false, outputDir: "tmp/pages" },
      pdf: { inlineMaxPages: 2, inlineMaxChars: 5000, outputDir: "tmp/pdfs" }
    }));
    const { loadBrightDataConfig } = await loadFresh();

    const config = loadBrightDataConfig();

    expect(config.brightdata.serpZone).toBe("serp_custom");
    expect(config.brightdata.unlockerZone).toBe("unlock_custom");
    expect(config.brightdata.defaultLanguage).toBe("fr");
    expect(config.brightdata.concurrency).toBe(2);
    expect(config.search.defaultEngine).toBe("bing");
    expect(config.search.defaultLimit).toBe(7);
    expect(config.fetch.preferMarkdown).toBe(false);
    expect(config.fetch.outputDir).toBe("tmp/pages");
    expect(config.pdf.inlineMaxPages).toBe(2);
    expect(config.pdf.outputDir).toBe("tmp/pdfs");
  });

  it("lets zone environment variables override JSON", async () => {
    const home = makeHome();
    process.env.HOME = home;
    process.env.BRIGHTDATA_SERP_ZONE = "env_serp";
    process.env.BRIGHTDATA_UNLOCKER_ZONE = "env_unlocker";
    writeFileSync(join(home, ".pi", "brightdata.json"), JSON.stringify({
      brightdata: { serpZone: "json_serp", unlockerZone: "json_unlocker" }
    }));
    const { loadBrightDataConfig } = await loadFresh();

    const config = loadBrightDataConfig();

    expect(config.brightdata.serpZone).toBe("env_serp");
    expect(config.brightdata.unlockerZone).toBe("env_unlocker");
  });

  it("prefers BRIGHT_DATA_KEY over BRIGHTDATA_API_KEY", async () => {
    process.env.BRIGHT_DATA_KEY = "primary";
    process.env.BRIGHTDATA_API_KEY = "fallback";
    const { getBrightDataApiKey } = await loadFresh();

    expect(getBrightDataApiKey()).toBe("primary");
  });

  it("uses BRIGHTDATA_API_KEY when BRIGHT_DATA_KEY is absent", async () => {
    delete process.env.BRIGHT_DATA_KEY;
    process.env.BRIGHTDATA_API_KEY = "fallback";
    const { getBrightDataApiKey } = await loadFresh();

    expect(getBrightDataApiKey()).toBe("fallback");
  });

  it("throws a parse error with the config path for malformed JSON", async () => {
    const home = makeHome();
    process.env.HOME = home;
    writeFileSync(join(home, ".pi", "brightdata.json"), "{bad json");
    const { loadBrightDataConfig } = await loadFresh();

    expect(() => loadBrightDataConfig()).toThrow(/Failed to parse .*brightdata\.json/);
  });
});
```

- [ ] **Step 3: Run config tests to verify failure**

Run:

```bash
cd extensions/brightdata && npm test -- tests/config.test.ts
```

Expected: FAIL because `config.ts` does not exist.

- [ ] **Step 4: Implement shared types and config loader**

Create `extensions/brightdata/types.ts`:

```ts
export type SearchEngine = "google" | "bing" | "duckduckgo" | "yandex";

export interface BrightDataConfig {
  brightdata: {
    serpZone: string;
    unlockerZone: string;
    defaultCountry: string;
    defaultLanguage: string;
    requestTimeoutMs: number;
    concurrency: number;
  };
  search: {
    defaultEngine: SearchEngine;
    defaultLimit: number;
    maxQueries: number;
    maxResults: number;
  };
  fetch: {
    maxUrls: number;
    maxInlineChars: number;
    preferMarkdown: boolean;
    outputDir: string;
  };
  pdf: {
    enabled: boolean;
    inlineMaxPages: number;
    inlineMaxChars: number;
    previewChars: number;
    maxPages: number;
    maxBytes: number;
    outputDir: string;
  };
}

export interface BrightDataSearchResult {
  rank: number;
  title: string;
  url: string;
  snippet?: string;
  source?: string;
}

export interface FetchPageResult {
  url: string;
  title: string;
  content: string;
  error: string | null;
  kind: "page" | "pdf";
  savedPath?: string;
  truncated?: boolean;
  chars?: number;
  pages?: number;
}
```

Create `extensions/brightdata/config.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrightDataConfig, SearchEngine } from "./types.js";

export const CONFIG_PATH = join(homedir(), ".pi", "brightdata.json");

const DEFAULT_CONFIG: BrightDataConfig = {
  brightdata: {
    serpZone: "pi_serp_api",
    unlockerZone: "mcp_unlocker",
    defaultCountry: "au",
    defaultLanguage: "en",
    requestTimeoutMs: 60000,
    concurrency: 3,
  },
  search: {
    defaultEngine: "google",
    defaultLimit: 10,
    maxQueries: 10,
    maxResults: 20,
  },
  fetch: {
    maxUrls: 10,
    maxInlineChars: 30000,
    preferMarkdown: true,
    outputDir: ".pi/brightdata/pages",
  },
  pdf: {
    enabled: true,
    inlineMaxPages: 5,
    inlineMaxChars: 20000,
    previewChars: 2000,
    maxPages: 200,
    maxBytes: 52428800,
    outputDir: ".pi/brightdata/pdfs",
  },
};

let cachedConfig: BrightDataConfig | null = null;

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function searchEngine(value: unknown, fallback: SearchEngine): SearchEngine {
  return value === "google" || value === "bing" || value === "duckduckgo" || value === "yandex"
    ? value
    : fallback;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

export function getBrightDataApiKey(): string | null {
  const primary = process.env.BRIGHT_DATA_KEY?.trim();
  if (primary) return primary;
  const fallback = process.env.BRIGHTDATA_API_KEY?.trim();
  return fallback || null;
}

export function loadBrightDataConfig(): BrightDataConfig {
  if (cachedConfig) return cachedConfig;

  let raw: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
    }
  }

  const brightdata = (raw.brightdata && typeof raw.brightdata === "object" ? raw.brightdata : {}) as Record<string, unknown>;
  const search = (raw.search && typeof raw.search === "object" ? raw.search : {}) as Record<string, unknown>;
  const fetch = (raw.fetch && typeof raw.fetch === "object" ? raw.fetch : {}) as Record<string, unknown>;
  const pdf = (raw.pdf && typeof raw.pdf === "object" ? raw.pdf : {}) as Record<string, unknown>;

  cachedConfig = {
    brightdata: {
      serpZone: nonEmptyString(process.env.BRIGHTDATA_SERP_ZONE, nonEmptyString(brightdata.serpZone, DEFAULT_CONFIG.brightdata.serpZone)),
      unlockerZone: nonEmptyString(process.env.BRIGHTDATA_UNLOCKER_ZONE, nonEmptyString(brightdata.unlockerZone, DEFAULT_CONFIG.brightdata.unlockerZone)),
      defaultCountry: nonEmptyString(brightdata.defaultCountry, DEFAULT_CONFIG.brightdata.defaultCountry),
      defaultLanguage: nonEmptyString(brightdata.defaultLanguage, DEFAULT_CONFIG.brightdata.defaultLanguage),
      requestTimeoutMs: positiveInteger(brightdata.requestTimeoutMs, DEFAULT_CONFIG.brightdata.requestTimeoutMs),
      concurrency: positiveInteger(brightdata.concurrency, DEFAULT_CONFIG.brightdata.concurrency),
    },
    search: {
      defaultEngine: searchEngine(search.defaultEngine, DEFAULT_CONFIG.search.defaultEngine),
      defaultLimit: positiveInteger(search.defaultLimit, DEFAULT_CONFIG.search.defaultLimit),
      maxQueries: positiveInteger(search.maxQueries, DEFAULT_CONFIG.search.maxQueries),
      maxResults: positiveInteger(search.maxResults, DEFAULT_CONFIG.search.maxResults),
    },
    fetch: {
      maxUrls: positiveInteger(fetch.maxUrls, DEFAULT_CONFIG.fetch.maxUrls),
      maxInlineChars: positiveInteger(fetch.maxInlineChars, DEFAULT_CONFIG.fetch.maxInlineChars),
      preferMarkdown: booleanValue(fetch.preferMarkdown, DEFAULT_CONFIG.fetch.preferMarkdown),
      outputDir: nonEmptyString(fetch.outputDir, DEFAULT_CONFIG.fetch.outputDir),
    },
    pdf: {
      enabled: booleanValue(pdf.enabled, DEFAULT_CONFIG.pdf.enabled),
      inlineMaxPages: positiveInteger(pdf.inlineMaxPages, DEFAULT_CONFIG.pdf.inlineMaxPages),
      inlineMaxChars: positiveInteger(pdf.inlineMaxChars, DEFAULT_CONFIG.pdf.inlineMaxChars),
      previewChars: positiveInteger(pdf.previewChars, DEFAULT_CONFIG.pdf.previewChars),
      maxPages: positiveInteger(pdf.maxPages, DEFAULT_CONFIG.pdf.maxPages),
      maxBytes: positiveInteger(pdf.maxBytes, DEFAULT_CONFIG.pdf.maxBytes),
      outputDir: nonEmptyString(pdf.outputDir, DEFAULT_CONFIG.pdf.outputDir),
    },
  };

  return cachedConfig;
}
```

- [ ] **Step 5: Run config tests and typecheck**

Run:

```bash
cd extensions/brightdata && npm test -- tests/config.test.ts && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 6: Commit scaffold and config**

```bash
git add extensions/brightdata/package.json extensions/brightdata/package-lock.json extensions/brightdata/tsconfig.json extensions/brightdata/types.ts extensions/brightdata/config.ts extensions/brightdata/tests/config.test.ts
git commit -m "feat: scaffold Bright Data config"
```

---

### Task 2: Bright Data client, URL utilities, and request safety

**Files:**
- Create: `extensions/brightdata/brightdata-client.ts`
- Create: `extensions/brightdata/urls.ts`
- Create: `extensions/brightdata/request-safety.ts`
- Create: `extensions/brightdata/tests/client.test.ts`
- Create: `extensions/brightdata/tests/urls.test.ts`
- Create: `extensions/brightdata/tests/request-safety.test.ts`

- [ ] **Step 1: Write failing URL utility and request-safety tests**

Create `extensions/brightdata/tests/urls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSearchUrl } from "../urls.js";

describe("buildSearchUrl", () => {
  it("builds a Google SERP URL with brd_json=1", () => {
    const url = buildSearchUrl("google", "pizza near me", "en");
    expect(url).toContain("https://www.google.com/search");
    expect(url).toContain("q=pizza+near+me");
    expect(url).toContain("hl=en");
    expect(url).toContain("brd_json=1");
  });

  it("builds Bing and DuckDuckGo URLs with brd_json=1", () => {
    expect(buildSearchUrl("bing", "abc", "en")).toBe("https://www.bing.com/search?q=abc&brd_json=1");
    expect(buildSearchUrl("duckduckgo", "abc", "en")).toBe("https://duckduckgo.com/html/?q=abc&brd_json=1");
  });
});
```

Create `extensions/brightdata/tests/request-safety.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UnsafeUrlError,
  fetchPublicWithManualRedirects,
  resolvePublicRedirectUrl,
  validateBrightDataTarget,
  validatePublicHttpUrl,
} from "../request-safety.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("validatePublicHttpUrl", () => {
  it("accepts public http and https URLs", () => {
    expect(validatePublicHttpUrl("https://example.com/a?b=1").href).toBe("https://example.com/a?b=1");
    expect(validateBrightDataTarget("http://example.com/")).toBe("http://example.com/");
  });

  it("rejects non-http, localhost, private, link-local, unspecified, and IPv6 loopback targets", () => {
    const blocked = [
      "file:///etc/passwd",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://0.0.0.0/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.10.20/",
      "http://[::1]/",
      "http://[::]/",
      "http://[::ffff:127.0.0.1]/",
    ];
    for (const url of blocked) {
      expect(() => validatePublicHttpUrl(url), url).toThrow(UnsafeUrlError);
    }
  });
});

describe("redirect safety", () => {
  it("resolves safe relative redirects", () => {
    expect(resolvePublicRedirectUrl("https://example.com/a/b", "../c")).toBe("https://example.com/c");
  });

  it("rejects redirects to private targets", () => {
    expect(() => resolvePublicRedirectUrl("https://example.com/a", "http://127.0.0.1/private")).toThrow(UnsafeUrlError);
  });

  it("uses manual redirects for local direct fetches", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchPublicWithManualRedirects("https://example.com/a", { method: "HEAD" });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/a", expect.objectContaining({ method: "HEAD", redirect: "manual" }));
  });
});
```

- [ ] **Step 2: Write failing client tests**

Create `extensions/brightdata/tests/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadClient() {
  vi.resetModules();
  return await import("../brightdata-client.js");
}

describe("brightDataRequest", () => {
  it("throws a useful error when the API key is missing", async () => {
    delete process.env.BRIGHT_DATA_KEY;
    delete process.env.BRIGHTDATA_API_KEY;
    const { brightDataRequest } = await loadClient();

    await expect(brightDataRequest({ zone: "z", url: "https://example.com", format: "raw" })).rejects.toThrow(/BRIGHT_DATA_KEY/);
  });

  it("sends documented Bright Data request fields", async () => {
    process.env.BRIGHT_DATA_KEY = "secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { brightDataRequest } = await loadClient();

    const result = await brightDataRequest({ zone: "unlock", url: "https://example.com", format: "raw", data_format: "markdown", country: "au" });

    expect(result.text).toBe(JSON.stringify({ ok: true }));
    expect(result.json).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("https://api.brightdata.com/request", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer secret", "Content-Type": "application/json" }),
      body: JSON.stringify({ zone: "unlock", url: "https://example.com", format: "raw", data_format: "markdown", country: "au" })
    }));
  });

  it("maps HTTP errors with response text", async () => {
    process.env.BRIGHT_DATA_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota exceeded", { status: 429, statusText: "Too Many Requests" })));
    const { brightDataRequest } = await loadClient();

    await expect(brightDataRequest({ zone: "z", url: "https://example.com", format: "raw" })).rejects.toThrow(/rate limit or quota.*quota exceeded/i);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
cd extensions/brightdata && npm test -- tests/urls.test.ts tests/request-safety.test.ts tests/client.test.ts
```

Expected: FAIL because `urls.ts`, `request-safety.ts`, and `brightdata-client.ts` do not exist.

- [ ] **Step 4: Implement URL utilities and request-safety boundary**

Create `extensions/brightdata/urls.ts`:

```ts
import type { SearchEngine } from "./types.js";

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function buildSearchUrl(engine: SearchEngine, query: string, language: string): string {
  switch (engine) {
    case "bing":
      return withParams("https://www.bing.com/search", { q: query, brd_json: "1" });
    case "duckduckgo":
      return withParams("https://duckduckgo.com/html/", { q: query, brd_json: "1" });
    case "yandex":
      return withParams("https://yandex.com/search/", { text: query, brd_json: "1" });
    case "google":
    default:
      return withParams("https://www.google.com/search", { q: query, hl: language, brd_json: "1" });
  }
}
```

Create `extensions/brightdata/request-safety.ts`:

```ts
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain"]);

function parseIPv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return null;
  return nums;
}

function isPrivateIPv4(hostname: string): boolean {
  const ip = parseIPv4(hostname);
  if (!ip) return false;
  const [a, b] = ip;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isBlockedIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.")
    || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(normalized) || normalized.endsWith(".localhost")) return true;
  if (isIP(normalized) === 4) return isPrivateIPv4(normalized);
  if (isIP(normalized) === 6) return isBlockedIPv6(normalized);
  return false;
}

export function validatePublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError(`Only public http/https URLs are supported: ${raw}`);
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new UnsafeUrlError(`Refusing private or local URL: ${raw}`);
  }
  return parsed;
}

export function validateBrightDataTarget(raw: string): string {
  return validatePublicHttpUrl(raw).toString();
}

export function resolvePublicRedirectUrl(currentUrl: string, location: string): string {
  return validatePublicHttpUrl(new URL(location, currentUrl).toString()).toString();
}

export async function fetchPublicWithManualRedirects(
  rawUrl: string,
  init: RequestInit = {},
  options: { maxRedirects?: number } = {},
): Promise<Response> {
  let current = validatePublicHttpUrl(rawUrl).toString();
  const maxRedirects = options.maxRedirects ?? 5;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (hop === maxRedirects) throw new Error(`Too many redirects for ${rawUrl}`);
    current = resolvePublicRedirectUrl(current, location);
  }
  throw new Error(`Too many redirects for ${rawUrl}`);
}
```

- [ ] **Step 5: Implement Bright Data client**

Create `extensions/brightdata/brightdata-client.ts`:

```ts
import { getBrightDataApiKey, loadBrightDataConfig } from "./config.js";
import { validateBrightDataTarget } from "./request-safety.js";

export interface BrightDataPayload {
  zone: string;
  url: string;
  format: "raw" | "json";
  country?: string;
  data_format?: "markdown";
  method?: "GET" | "POST";
  body?: string;
}

export interface BrightDataResult {
  status: number;
  headers: Headers;
  text: string;
  json: unknown | null;
  bytes: ArrayBuffer;
}

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

function explainError(status: number, statusText: string, body: string): string {
  const trimmed = body.slice(0, 1000);
  if (status === 401) return `Bright Data authentication failed. Check BRIGHT_DATA_KEY or BRIGHTDATA_API_KEY. ${trimmed}`;
  if (status === 403) return `Bright Data rejected the request. Check zone permissions and product access. ${trimmed}`;
  if (status === 429) return `Bright Data rate limit or quota was hit. Try fewer queries or URLs. ${trimmed}`;
  return `Bright Data request failed: HTTP ${status} ${statusText}. ${trimmed}`;
}

export async function brightDataRequest(payload: BrightDataPayload, signal?: AbortSignal): Promise<BrightDataResult> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) {
    throw new Error("Bright Data API key not found. Set BRIGHT_DATA_KEY or BRIGHTDATA_API_KEY.");
  }

  const timeoutMs = loadBrightDataConfig().brightdata.requestTimeoutMs;
  const safePayload = { ...payload, url: validateBrightDataTarget(payload.url) };
  let response: Response;
  try {
    response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(safePayload),
      signal: combineSignals(timeoutMs, signal),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "AbortError" || name === "TimeoutError" || message.toLowerCase().includes("abort")) {
      throw new Error(`Bright Data request aborted or timed out: ${message}`);
    }
    throw new Error(`Bright Data network request failed: ${message}`);
  }

  const bytes = await response.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  let json: unknown | null = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    throw new Error(explainError(response.status, response.statusText, text));
  }

  return { status: response.status, headers: response.headers, text, json, bytes };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd extensions/brightdata && npm test -- tests/urls.test.ts tests/request-safety.test.ts tests/client.test.ts && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 7: Commit client and URL utilities**

```bash
git add extensions/brightdata/brightdata-client.ts extensions/brightdata/urls.ts extensions/brightdata/request-safety.ts extensions/brightdata/tests/client.test.ts extensions/brightdata/tests/urls.test.ts extensions/brightdata/tests/request-safety.test.ts
git commit -m "feat: add Bright Data client"
```

---

### Task 3: Search module

**Files:**
- Create: `extensions/brightdata/search.ts`
- Create: `extensions/brightdata/tests/search.test.ts`

- [ ] **Step 1: Write failing search tests**

Create `extensions/brightdata/tests/search.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import type { BrightDataResult } from "../brightdata-client.js";

vi.mock("../brightdata-client.js", () => ({
  brightDataRequest: vi.fn()
}));

const { brightDataRequest } = await import("../brightdata-client.js") as unknown as { brightDataRequest: ReturnType<typeof vi.fn> };
const { normalizeSearchResults, searchBrightData, formatSearchMarkdown } = await import("../search.js");

afterEach(() => {
  vi.clearAllMocks();
});

function result(json: unknown): BrightDataResult {
  const text = JSON.stringify(json);
  return { status: 200, headers: new Headers(), text, json, bytes: new TextEncoder().encode(text).buffer };
}

describe("normalizeSearchResults", () => {
  it("normalizes organic results", () => {
    expect(normalizeSearchResults({ organic: [
      { title: "A", link: "https://a.test", description: "Alpha", displayed_link: "a.test" },
      { title: "B", url: "https://b.test", snippet: "Beta" }
    ]}, 10)).toEqual([
      { rank: 1, title: "A", url: "https://a.test", snippet: "Alpha", source: "a.test" },
      { rank: 2, title: "B", url: "https://b.test", snippet: "Beta" }
    ]);
  });

  it("handles body-wrapped organic_results", () => {
    expect(normalizeSearchResults({ body: { organic_results: [
      { rank: 3, title: "C", link: "https://c.test", text: "Gamma" }
    ]}}, 10)).toEqual([
      { rank: 3, title: "C", url: "https://c.test", snippet: "Gamma" }
    ]);
  });
});

describe("searchBrightData", () => {
  it("calls Bright Data with brd_json target URL and format raw", async () => {
    brightDataRequest.mockResolvedValue(result({ organic: [{ title: "A", link: "https://a.test" }] }));

    const response = await searchBrightData(["pizza"], {
      zone: "serp_zone",
      engine: "google",
      country: "au",
      language: "en",
      limit: 5,
      maxQueries: 10,
      signal: undefined
    });

    expect(response).toHaveLength(1);
    expect(response[0].results[0].url).toBe("https://a.test");
    expect(brightDataRequest).toHaveBeenCalledWith(expect.objectContaining({
      zone: "serp_zone",
      format: "raw",
      country: "au"
    }), undefined);
    expect(brightDataRequest.mock.calls[0][0].url).toContain("brd_json=1");
  });
});

describe("formatSearchMarkdown", () => {
  it("formats query sections", () => {
    const text = formatSearchMarkdown([{ query: "pizza", results: [{ rank: 1, title: "A", url: "https://a.test", snippet: "Alpha" }], raw: {} }]);
    expect(text).toContain("## Results for: pizza");
    expect(text).toContain("1. A");
    expect(text).toContain("https://a.test");
  });
});
```

- [ ] **Step 2: Run search tests to verify failure**

Run:

```bash
cd extensions/brightdata && npm test -- tests/search.test.ts
```

Expected: FAIL because `search.ts` does not exist.

- [ ] **Step 3: Implement search module**

Create `extensions/brightdata/search.ts`:

```ts
import pLimit from "p-limit";
import { brightDataRequest } from "./brightdata-client.js";
import { buildSearchUrl } from "./urls.js";
import type { BrightDataSearchResult, SearchEngine } from "./types.js";

export interface QuerySearchData {
  query: string;
  results: BrightDataSearchResult[];
  raw: unknown;
  error?: string;
}

export interface SearchBrightDataOptions {
  zone: string;
  engine: SearchEngine;
  country: string;
  language: string;
  limit: number;
  maxQueries: number;
  signal?: AbortSignal;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function resultCandidates(payload: unknown): unknown[] {
  const root = payload as Record<string, unknown>;
  const body = root.body as Record<string, unknown> | undefined;
  const candidates = root.organic ?? root.organic_results ?? root.results ?? root.items ?? body?.organic ?? body?.organic_results;
  return Array.isArray(candidates) ? candidates : [];
}

export function normalizeSearchResults(payload: unknown, limit: number): BrightDataSearchResult[] {
  return resultCandidates(payload)
    .map((item, index): BrightDataSearchResult | null => {
      const record = item as Record<string, unknown>;
      const url = pickString(record.link, record.url, record.href);
      const title = pickString(record.title, record.name);
      if (!url || !title) return null;
      const rank = typeof record.rank === "number" && Number.isFinite(record.rank) ? record.rank : index + 1;
      const snippet = pickString(record.description, record.snippet, record.text);
      const source = pickString(record.source, record.displayed_link, record.domain);
      return { rank, title, url, ...(snippet ? { snippet } : {}), ...(source ? { source } : {}) };
    })
    .filter((result): result is BrightDataSearchResult => result !== null)
    .slice(0, Math.max(1, limit));
}

export async function searchBrightData(queries: string[], options: SearchBrightDataOptions): Promise<QuerySearchData[]> {
  const normalized = queries.map((query) => query.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error("No query provided. Use query or queries.");
  if (normalized.length > options.maxQueries) throw new Error(`Too many queries: ${normalized.length}. Maximum is ${options.maxQueries}.`);

  const limit = pLimit(3);
  return Promise.all(normalized.map((query) => limit(async () => {
    try {
      const response = await brightDataRequest({
        zone: options.zone,
        url: buildSearchUrl(options.engine, query, options.language),
        format: "raw",
        country: options.country,
      }, options.signal);
      const raw = response.json ?? response.text;
      return { query, results: normalizeSearchResults(raw, options.limit), raw };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { query, results: [], raw: null, error: message };
    }
  })));
}

export function formatSearchMarkdown(entries: QuerySearchData[]): string {
  return entries.map((entry) => {
    const lines = [`## Results for: ${entry.query}`, ""];
    if (entry.error) {
      lines.push(`Error: ${entry.error}`);
      return lines.join("\n");
    }
    if (entry.results.length === 0) {
      lines.push("No normalized results found.");
      return lines.join("\n");
    }
    for (const result of entry.results) {
      lines.push(`${result.rank}. ${result.title}`);
      lines.push(`   URL: ${result.url}`);
      if (result.snippet) lines.push(`   Snippet: ${result.snippet}`);
      if (result.source) lines.push(`   Source: ${result.source}`);
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }).join("\n\n---\n\n");
}
```

- [ ] **Step 4: Run search tests and typecheck**

Run:

```bash
cd extensions/brightdata && npm test -- tests/search.test.ts && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 5: Commit search module**

```bash
git add extensions/brightdata/search.ts extensions/brightdata/tests/search.test.ts
git commit -m "feat: add Bright Data SERP search"
```

---

### Task 4: Storage and disk persistence

**Files:**
- Create: `extensions/brightdata/storage.ts`
- Create: `extensions/brightdata/tests/storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `extensions/brightdata/tests/storage.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredResults,
  generateResponseId,
  getStoredResult,
  restoreFromSession,
  saveLargeMarkdown,
  storeResult,
  type StoredBrightDataResult
} from "../storage.js";

const tempDirs: string[] = [];

afterEach(() => {
  clearStoredResults();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "brightdata-storage-"));
  tempDirs.push(dir);
  return dir;
}

describe("storage", () => {
  it("generates brightdata-prefixed IDs", () => {
    expect(generateResponseId()).toMatch(/^bd_[a-z0-9]+$/);
  });

  it("stores and retrieves results", () => {
    const data: StoredBrightDataResult = { id: "bd_1", provider: "brightdata", type: "fetch", timestamp: Date.now(), urls: [] };
    storeResult(data);
    expect(getStoredResult("bd_1")).toEqual(data);
  });

  it("restores fresh brightdata-results entries from session branch", () => {
    const data: StoredBrightDataResult = { id: "bd_2", provider: "brightdata", type: "search", timestamp: Date.now(), queries: [] };
    restoreFromSession({ sessionManager: { getBranch: () => [{ type: "custom", customType: "brightdata-results", data }] } });
    expect(getStoredResult("bd_2")).toEqual(data);
  });

  it("discards entries older than the TTL", () => {
    const old: StoredBrightDataResult = { id: "bd_old", provider: "brightdata", type: "fetch", timestamp: Date.now() - 7200_000, urls: [] };
    restoreFromSession({ sessionManager: { getBranch: () => [{ type: "custom", customType: "brightdata-results", data: old }] } });
    expect(getStoredResult("bd_old")).toBeUndefined();
  });

  it("saves large markdown to a safe file name", () => {
    const dir = makeDir();
    const saved = saveLargeMarkdown({ outputDir: dir, title: "A/B: C?", url: "https://example.com/doc", content: "hello" });
    expect(saved).toMatch(/a-b-c-[a-f0-9]{8}\.md$/);
    expect(readFileSync(saved, "utf8")).toBe("hello");
  });
});
```

- [ ] **Step 2: Run storage tests to verify failure**

Run:

```bash
cd extensions/brightdata && npm test -- tests/storage.test.ts
```

Expected: FAIL because `storage.ts` does not exist.

- [ ] **Step 3: Implement storage module**

Create `extensions/brightdata/storage.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrightDataSearchResult, FetchPageResult } from "./types.js";

export const BRIGHTDATA_RESULTS_CUSTOM_TYPE = "brightdata-results";
export const RESULT_TTL_MS = 60 * 60 * 1000;

export interface StoredSearchQuery {
  query: string;
  results: BrightDataSearchResult[];
  raw?: unknown;
  error?: string;
}

export interface StoredBrightDataResult {
  id: string;
  provider: "brightdata";
  type: "search" | "fetch";
  timestamp: number;
  queries?: StoredSearchQuery[];
  urls?: FetchPageResult[];
}

const stored = new Map<string, StoredBrightDataResult>();

export function generateResponseId(): string {
  return `bd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function clearStoredResults(): void {
  stored.clear();
}

export function storeResult(data: StoredBrightDataResult): void {
  stored.set(data.id, data);
}

export function getStoredResult(id: string): StoredBrightDataResult | undefined {
  return stored.get(id);
}

function isStoredBrightDataResult(value: unknown): value is StoredBrightDataResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && record.provider === "brightdata"
    && (record.type === "search" || record.type === "fetch")
    && typeof record.timestamp === "number";
}

export function restoreFromSession(ctx: unknown, now = Date.now()): void {
  clearStoredResults();
  const branch = (ctx as { sessionManager?: { getBranch?: () => unknown[] } })?.sessionManager?.getBranch?.() ?? [];
  for (const entry of branch) {
    const record = entry as Record<string, unknown>;
    if (record.type !== "custom" || record.customType !== BRIGHTDATA_RESULTS_CUSTOM_TYPE) continue;
    if (!isStoredBrightDataResult(record.data)) continue;
    if (now - record.data.timestamp > RESULT_TTL_MS) continue;
    storeResult(record.data);
  }
}

function sanitizeFilename(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "content";
}

export function saveLargeMarkdown(input: { outputDir: string; title: string; url: string; content: string; cwd?: string }): string {
  const baseDir = input.cwd ? resolve(input.cwd, input.outputDir) : resolve(input.outputDir);
  mkdirSync(baseDir, { recursive: true });
  const hash = createHash("sha256").update(input.url).digest("hex").slice(0, 8);
  const filename = `${sanitizeFilename(input.title || new URL(input.url).hostname)}-${hash}.md`;
  const outputPath = join(baseDir, filename);
  writeFileSync(outputPath, input.content, "utf8");
  return outputPath;
}
```

- [ ] **Step 4: Run storage tests and typecheck**

Run:

```bash
cd extensions/brightdata && npm test -- tests/storage.test.ts && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 5: Commit storage module**

```bash
git add extensions/brightdata/storage.ts extensions/brightdata/tests/storage.test.ts
git commit -m "feat: add Bright Data result storage"
```

---

### Task 5: HTML/page fetch, output safety, and content retrieval logic

**Files:**
- Create: `extensions/brightdata/fetch.ts`
- Create: `extensions/brightdata/output-safety.ts`
- Create: `extensions/brightdata/tests/fetch.test.ts`
- Create: `extensions/brightdata/tests/output-safety.test.ts`

- [ ] **Step 1: Write failing fetch tests**

Create `extensions/brightdata/tests/fetch.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrightDataResult } from "../brightdata-client.js";
import { clearStoredResults, getStoredResult } from "../storage.js";

vi.mock("../brightdata-client.js", () => ({ brightDataRequest: vi.fn() }));
const { brightDataRequest } = await import("../brightdata-client.js") as unknown as { brightDataRequest: ReturnType<typeof vi.fn> };
const { fetchBrightDataPages, getStoredContentText } = await import("../fetch.js");

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  clearStoredResults();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "brightdata-fetch-"));
  tempDirs.push(dir);
  return dir;
}

function response(text: string): BrightDataResult {
  return { status: 200, headers: new Headers({ "content-type": "text/markdown" }), text, json: null, bytes: new TextEncoder().encode(text).buffer };
}

describe("fetchBrightDataPages", () => {
  it("fetches pages with data_format markdown", async () => {
    brightDataRequest.mockResolvedValue(response("# Title\n\nBody"));
    const output = await fetchBrightDataPages(["https://example.com/a"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 30000,
      outputDir: makeDir(),
      cwd: process.cwd(),
      concurrency: 3,
      signal: undefined
    });

    expect(output.data.urls?.[0].content).toContain("Body");
    expect(brightDataRequest).toHaveBeenCalledWith(expect.objectContaining({
      zone: "unlock",
      url: "https://example.com/a",
      format: "raw",
      data_format: "markdown",
      country: "au"
    }), undefined);
    expect(getStoredResult(output.data.id)).toEqual(output.data);
  });

  it("saves large page content to disk", async () => {
    const dir = makeDir();
    brightDataRequest.mockResolvedValue(response("x".repeat(100)));
    const output = await fetchBrightDataPages(["https://example.com/large"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 20,
      outputDir: dir,
      cwd: process.cwd(),
      concurrency: 3,
      signal: undefined
    });

    const page = output.data.urls?.[0];
    expect(page?.savedPath).toBeDefined();
    expect(page?.content).toContain("Saved full content to");
    expect(readFileSync(page!.savedPath!, "utf8")).toHaveLength(100);
  });
});

describe("getStoredContentText", () => {
  it("returns selected fetched content by urlIndex", async () => {
    brightDataRequest.mockResolvedValue(response("# Page"));
    const output = await fetchBrightDataPages(["https://example.com/a"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 30000,
      outputDir: makeDir(),
      cwd: process.cwd(),
      concurrency: 3,
      signal: undefined
    });

    expect(getStoredContentText({ responseId: output.data.id, urlIndex: 0 })).toContain("# Page");
  });

  it("does not return unbounded saved content", async () => {
    const dir = makeDir();
    brightDataRequest.mockResolvedValue(response("x".repeat(100)));
    const output = await fetchBrightDataPages(["https://example.com/large"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 20,
      outputDir: dir,
      cwd: process.cwd(),
      concurrency: 3,
      signal: undefined
    });

    const text = getStoredContentText({ responseId: output.data.id, urlIndex: 0, maxOutputChars: 30 });

    expect(text.length).toBeLessThan(100);
    expect(text).toContain("Output truncated");
    expect(text).toContain("Full content saved to");
  });
});
```

Create `extensions/brightdata/tests/output-safety.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatStoredContentForTool } from "../output-safety.js";

describe("formatStoredContentForTool", () => {
  it("returns small content unchanged", () => {
    expect(formatStoredContentForTool({ content: "hello", maxOutputChars: 10 })).toBe("hello");
  });

  it("truncates large content and preserves saved path guidance", () => {
    const text = formatStoredContentForTool({ content: "x".repeat(100), savedPath: "/tmp/full.md", maxOutputChars: 20 });
    expect(text).toContain("x".repeat(20));
    expect(text).toContain("Output truncated");
    expect(text).toContain("/tmp/full.md");
  });
});
```

- [ ] **Step 2: Run fetch tests to verify failure**

Run:

```bash
cd extensions/brightdata && npm test -- tests/fetch.test.ts tests/output-safety.test.ts
```

Expected: FAIL because `fetch.ts` and `output-safety.ts` do not exist.

- [ ] **Step 3: Implement fetch module**

Create `extensions/brightdata/output-safety.ts`:

```ts
import { truncateHead } from "@earendil-works/pi-coding-agent";

export function formatStoredContentForTool(input: { content: string; savedPath?: string; maxOutputChars?: number }): string {
  const maxOutputChars = input.maxOutputChars ?? 50_000;
  const truncation = truncateHead(input.content, { maxBytes: maxOutputChars, maxLines: 2000 });
  if (!truncation.truncated) return truncation.content;
  const pathNote = input.savedPath ? ` Full content saved to: ${input.savedPath}.` : "";
  return `${truncation.content}\n\n[Output truncated: showing ${truncation.outputBytes} of ${truncation.totalBytes} bytes.${pathNote}]`;
}

export function formatLargePdfStoredContent(input: { title: string; url: string; savedPath: string; content: string; pages?: number; chars?: number; previewChars?: number }): string {
  const previewChars = input.previewChars ?? 2000;
  return [
    "PDF content is stored on disk.",
    "",
    `Title: ${input.title}`,
    `URL: ${input.url}`,
    input.pages !== undefined ? `Pages: ${input.pages}` : undefined,
    `Characters: ${input.chars ?? input.content.length}`,
    `Saved markdown: ${input.savedPath}`,
    "",
    "Preview:",
    input.content.slice(0, previewChars),
    "",
    "Use the built-in read tool on the saved Markdown path for the full content."
  ].filter(Boolean).join("\n");
}
```

Create `extensions/brightdata/fetch.ts`:

```ts
import { readFileSync } from "node:fs";
import pLimit from "p-limit";
import { brightDataRequest } from "./brightdata-client.js";
import { formatLargePdfStoredContent, formatStoredContentForTool } from "./output-safety.js";
import { validatePublicHttpUrl } from "./request-safety.js";
import { generateResponseId, getStoredResult, saveLargeMarkdown, storeResult, type StoredBrightDataResult } from "./storage.js";
import type { FetchPageResult } from "./types.js";

export interface FetchOptions {
  zone: string;
  country: string;
  preferMarkdown: boolean;
  maxUrls: number;
  maxInlineChars: number;
  outputDir: string;
  cwd: string;
  concurrency: number;
  signal?: AbortSignal;
}

export interface FetchOutput {
  markdown: string;
  data: StoredBrightDataResult;
}

function titleFromContent(content: string, url: string): string {
  const heading = content.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function pageOutput(url: string, content: string, options: FetchOptions): FetchPageResult {
  const title = titleFromContent(content, url);
  if (content.length <= options.maxInlineChars) {
    return { url, title, content, error: null, kind: "page", chars: content.length };
  }
  const savedPath = saveLargeMarkdown({ outputDir: options.outputDir, title, url, content, cwd: options.cwd });
  const preview = content.slice(0, options.maxInlineChars);
  return {
    url,
    title,
    content: `${preview}\n\n[Content truncated. Saved full content to: ${savedPath}]`,
    error: null,
    kind: "page",
    savedPath,
    truncated: true,
    chars: content.length,
  };
}

function formatFetchMarkdown(pages: FetchPageResult[], responseId: string): string {
  if (pages.length === 1) {
    const page = pages[0];
    if (page.error) return `Error: ${page.error}\n\nResponse ID: ${responseId}`;
    return `${page.content}\n\n---\nResponse ID: ${responseId}`;
  }
  const lines = ["## Fetched URLs", ""];
  for (const page of pages) {
    if (page.error) lines.push(`- ${page.url}: Error - ${page.error}`);
    else lines.push(`- ${page.title || page.url}: ${page.chars ?? page.content.length} chars${page.savedPath ? `, saved: ${page.savedPath}` : ""}`);
  }
  lines.push("", `Response ID: ${responseId}`);
  return lines.join("\n");
}

export async function fetchBrightDataPages(urls: string[], options: FetchOptions): Promise<FetchOutput> {
  const normalized = urls.map((url) => validatePublicHttpUrl(url).toString());
  if (normalized.length === 0) throw new Error("No URL provided. Use url or urls.");
  if (normalized.length > options.maxUrls) throw new Error(`Too many URLs: ${normalized.length}. Maximum is ${options.maxUrls}.`);

  const limit = pLimit(options.concurrency);
  const pages = await Promise.all(normalized.map((url) => limit(async (): Promise<FetchPageResult> => {
    try {
      const response = await brightDataRequest({
        zone: options.zone,
        url,
        format: "raw",
        country: options.country,
        ...(options.preferMarkdown ? { data_format: "markdown" as const } : {}),
      }, options.signal);
      return pageOutput(url, response.text, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { url, title: "", content: "", error: message, kind: "page" };
    }
  })));

  const id = generateResponseId();
  const data: StoredBrightDataResult = { id, provider: "brightdata", type: "fetch", timestamp: Date.now(), urls: pages };
  storeResult(data);
  return { markdown: formatFetchMarkdown(pages, id), data };
}

export function getStoredContentText(selector: { responseId: string; urlIndex?: number; url?: string; queryIndex?: number; query?: string; maxOutputChars?: number }): string {
  const data = getStoredResult(selector.responseId);
  if (!data) return `Error: No stored result for ${selector.responseId}`;
  if (data.type === "fetch") {
    const pages = data.urls ?? [];
    const page = selector.url !== undefined
      ? pages.find((item) => item.url === selector.url)
      : pages[selector.urlIndex ?? 0];
    if (!page) return "Error: URL selection not found.";
    if (page.savedPath) {
      const content = readFileSync(page.savedPath, "utf8");
      if (page.kind === "pdf") {
        return formatLargePdfStoredContent({ title: page.title, url: page.url, savedPath: page.savedPath, content, pages: page.pages, chars: page.chars });
      }
      return formatStoredContentForTool({ content, savedPath: page.savedPath, maxOutputChars: selector.maxOutputChars });
    }
    return formatStoredContentForTool({ content: page.content, maxOutputChars: selector.maxOutputChars });
  }
  const queries = data.queries ?? [];
  const query = selector.query !== undefined
    ? queries.find((item) => item.query === selector.query)
    : queries[selector.queryIndex ?? 0];
  if (!query) return "Error: Query selection not found.";
  return formatStoredContentForTool({ content: JSON.stringify(query.results, null, 2), maxOutputChars: selector.maxOutputChars });
}
```

- [ ] **Step 4: Run fetch tests and typecheck**

Run:

```bash
cd extensions/brightdata && npm test -- tests/fetch.test.ts tests/output-safety.test.ts && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 5: Commit fetch module**

```bash
git add extensions/brightdata/fetch.ts extensions/brightdata/output-safety.ts extensions/brightdata/tests/fetch.test.ts extensions/brightdata/tests/output-safety.test.ts
git commit -m "feat: add Bright Data page fetch"
```

---

### Task 6: Adaptive PDF extraction

**Files:**
- Create: `extensions/brightdata/pdf.ts`
- Create: `extensions/brightdata/tests/pdf.test.ts`
- Modify: `extensions/brightdata/fetch.ts`
- Modify: `extensions/brightdata/tests/fetch.test.ts`
- Modify: `extensions/brightdata/types.ts`

- [ ] **Step 1: Write failing PDF tests with parser and transport injection**

Create `extensions/brightdata/tests/pdf.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrightDataResult } from "../brightdata-client.js";

vi.mock("../brightdata-client.js", () => ({ brightDataRequest: vi.fn() }));
const { brightDataRequest } = await import("../brightdata-client.js") as unknown as { brightDataRequest: ReturnType<typeof vi.fn> };
const { UnsafeUrlError } = await import("../request-safety.js");
const { extractPdfFromBytes, fetchPdfBytesWithFallback, isLikelyPdfUrl, isPdfResponse, shouldInlinePdf, shouldTreatAsPdfUrl } = await import("../pdf.js");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "brightdata-pdf-"));
  tempDirs.push(dir);
  return dir;
}

function bdBytes(bytes: Uint8Array): BrightDataResult {
  return { status: 200, headers: new Headers({ "content-type": "application/pdf" }), text: "", json: null, bytes: bytes.buffer };
}

describe("isLikelyPdfUrl", () => {
  it("detects .pdf path names", () => {
    expect(isLikelyPdfUrl("https://example.com/file.pdf")).toBe(true);
    expect(isLikelyPdfUrl("https://example.com/page")).toBe(false);
  });
});

describe("shouldInlinePdf", () => {
  it("requires both page and char thresholds", () => {
    expect(shouldInlinePdf({ pages: 2, chars: 1000, inlineMaxPages: 5, inlineMaxChars: 20000 })).toBe(true);
    expect(shouldInlinePdf({ pages: 6, chars: 1000, inlineMaxPages: 5, inlineMaxChars: 20000 })).toBe(false);
    expect(shouldInlinePdf({ pages: 2, chars: 25000, inlineMaxPages: 5, inlineMaxChars: 20000 })).toBe(false);
  });
});

describe("shouldTreatAsPdfUrl", () => {
  it("uses .pdf paths without a HEAD request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(shouldTreatAsPdfUrl("https://example.com/file.pdf")).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses HEAD content-type for extensionless PDF URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { "content-type": "application/pdf" } })));
    await expect(shouldTreatAsPdfUrl("https://example.com/download?id=1")).resolves.toBe(true);
  });

  it("treats failed HEAD as inconclusive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 405 })));
    await expect(shouldTreatAsPdfUrl("https://example.com/download?id=1")).resolves.toBe(false);
  });
});

describe("fetchPdfBytesWithFallback", () => {
  it("uses direct fetch when a public PDF succeeds", async () => {
    const directBytes = new Uint8Array([37, 80, 68, 70]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(directBytes, { status: 200, headers: { "content-type": "application/pdf" } })));

    const bytes = await fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 });

    expect(new Uint8Array(bytes)).toEqual(directBytes);
    expect(brightDataRequest).not.toHaveBeenCalled();
  });

  it("falls back to Bright Data raw bytes when direct fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    brightDataRequest.mockResolvedValue(bdBytes(new Uint8Array([1, 2, 3])));

    const bytes = await fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 });

    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(brightDataRequest).toHaveBeenCalledWith({ zone: "unlock", url: "https://example.com/file.pdf", format: "raw", country: "au" }, undefined);
  });

  it("rejects direct redirects to private hosts without Bright Data fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.pdf" } })));
    brightDataRequest.mockResolvedValue(bdBytes(new Uint8Array([9])));

    await expect(fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 })).rejects.toThrow(UnsafeUrlError);
    expect(brightDataRequest).not.toHaveBeenCalled();
  });
});

describe("isPdfResponse", () => {
  it("detects PDFs by content-type or magic bytes", () => {
    expect(isPdfResponse("https://example.com/download", new Headers({ "content-type": "application/pdf" }), new Uint8Array([1]).buffer)).toBe(true);
    expect(isPdfResponse("https://example.com/download", new Headers({ "content-type": "application/octet-stream" }), new Uint8Array([37, 80, 68, 70]).buffer)).toBe(true);
  });
});

describe("extractPdfFromBytes", () => {
  it("returns small PDFs inline", async () => {
    const result = await extractPdfFromBytes({
      url: "https://example.com/small.pdf",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      outputDir: makeDir(),
      cwd: process.cwd(),
      inlineMaxPages: 5,
      inlineMaxChars: 20000,
      previewChars: 2000,
      maxPages: 200,
      parsePdf: async () => ({ title: "Small", author: "Ada", pages: 2, markdown: "# Small\n\nBody", truncated: false })
    });

    expect(result.kind).toBe("pdf");
    expect(result.savedPath).toBeUndefined();
    expect(result.content).toContain("# Small");
    expect(result.pages).toBe(2);
  });

  it("saves large PDFs to disk and returns a preview", async () => {
    const dir = makeDir();
    const result = await extractPdfFromBytes({
      url: "https://example.com/large.pdf",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      outputDir: dir,
      cwd: process.cwd(),
      inlineMaxPages: 5,
      inlineMaxChars: 50,
      previewChars: 10,
      maxPages: 200,
      parsePdf: async () => ({ title: "Large", pages: 10, markdown: "# Large\n\n" + "x".repeat(100), truncated: false })
    });

    expect(result.savedPath).toBeDefined();
    expect(result.content).toContain("PDF extracted successfully");
    expect(result.content).toContain("Preview:");
    expect(readFileSync(result.savedPath!, "utf8")).toContain("# Large");
  });
});
```

- [ ] **Step 2: Run PDF tests to verify failure**

Run:

```bash
cd extensions/brightdata && npm test -- tests/pdf.test.ts
```

Expected: FAIL because `pdf.ts` does not exist.

- [ ] **Step 3: Implement PDF module with direct fetch plus Bright Data fallback**

Create `extensions/brightdata/pdf.ts`:

```ts
import { getDocumentProxy } from "unpdf";
import { basename } from "node:path";
import { brightDataRequest } from "./brightdata-client.js";
import { UnsafeUrlError, fetchPublicWithManualRedirects, validatePublicHttpUrl } from "./request-safety.js";
import { saveLargeMarkdown } from "./storage.js";
import type { FetchPageResult } from "./types.js";

export interface ParsedPdf {
  title: string;
  author?: string;
  pages: number;
  markdown: string;
  truncated: boolean;
}

export type PdfParser = (bytes: ArrayBuffer, url: string, maxPages: number) => Promise<ParsedPdf>;

export function isLikelyPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function isPdfContentType(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().includes("application/pdf");
}

function hasPdfMagicBytes(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 4));
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
}

export function isPdfResponse(url: string, headers: Headers, bytes: ArrayBuffer): boolean {
  return isLikelyPdfUrl(url) || isPdfContentType(headers) || hasPdfMagicBytes(bytes);
}

export async function shouldTreatAsPdfUrl(url: string, signal?: AbortSignal): Promise<boolean> {
  if (isLikelyPdfUrl(url)) return true;
  try {
    validatePublicHttpUrl(url);
    const response = await fetchPublicWithManualRedirects(url, { method: "HEAD", signal });
    return response.ok && isPdfContentType(response.headers);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    return false;
  }
}

export function shouldInlinePdf(input: { pages: number; chars: number; inlineMaxPages: number; inlineMaxChars: number }): boolean {
  return input.pages <= input.inlineMaxPages && input.chars <= input.inlineMaxChars;
}

async function directPdfFetch(url: string, maxBytes: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const response = await fetchPublicWithManualRedirects(url, { signal });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error(`PDF too large (${bytes.byteLength} bytes)`);
  return isPdfResponse(url, response.headers, bytes) ? bytes : null;
}

export async function fetchPdfBytesWithFallback(input: {
  url: string;
  zone: string;
  country: string;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  try {
    const direct = await directPdfFetch(input.url, input.maxBytes, input.signal);
    if (direct) return direct;
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("PDF too large")) throw err;
    // Recoverable direct transport failures fall back to Bright Data raw bytes.
  }

  const response = await brightDataRequest({ zone: input.zone, url: input.url, format: "raw", country: input.country }, input.signal);
  if (response.bytes.byteLength > input.maxBytes) throw new Error(`PDF too large (${response.bytes.byteLength} bytes)`);
  if (!isPdfResponse(input.url, response.headers, response.bytes)) throw new Error("Bright Data fallback did not return a PDF response.");
  return response.bytes;
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = basename(parsed.pathname, ".pdf").replace(/[-_]+/g, " ").trim();
    return name || parsed.hostname;
  } catch {
    return "document";
  }
}

export async function parsePdfWithUnpdf(bytes: ArrayBuffer, url: string, maxPages: number): Promise<ParsedPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const metadata = await pdf.getMetadata();
  const info = metadata.info && typeof metadata.info === "object" ? metadata.info as Record<string, unknown> : {};
  const title = typeof info.Title === "string" && info.Title.trim() ? info.Title.trim() : titleFromUrl(url);
  const author = typeof info.Author === "string" && info.Author.trim() ? info.Author.trim() : undefined;
  const pagesToExtract = Math.min(pdf.numPages, maxPages);
  const parts: string[] = [`# ${title}`, "", `> Source: ${url}`, `> Pages: ${pdf.numPages}${pdf.numPages > maxPages ? ` (extracted first ${pagesToExtract})` : ""}`];
  if (author) parts.push(`> Author: ${author}`);
  parts.push("", "---", "");

  for (let pageNumber = 1; pageNumber <= pagesToExtract; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: unknown) => (item as { str?: string }).str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageNumber > 1) parts.push("", `<!-- Page ${pageNumber} -->`, "");
    if (pageText) parts.push(pageText);
  }

  const truncated = pdf.numPages > maxPages;
  if (truncated) parts.push("", "---", "", `*[Truncated: extracted first ${pagesToExtract} of ${pdf.numPages} pages]*`);
  return { title, author, pages: pdf.numPages, markdown: parts.join("\n"), truncated };
}

export async function extractPdfFromBytes(input: {
  url: string;
  bytes: ArrayBuffer;
  outputDir: string;
  cwd: string;
  inlineMaxPages: number;
  inlineMaxChars: number;
  previewChars: number;
  maxPages: number;
  parsePdf?: PdfParser;
}): Promise<FetchPageResult> {
  const parsed = await (input.parsePdf ?? parsePdfWithUnpdf)(input.bytes, input.url, input.maxPages);
  const chars = parsed.markdown.length;
  if (shouldInlinePdf({ pages: parsed.pages, chars, inlineMaxPages: input.inlineMaxPages, inlineMaxChars: input.inlineMaxChars })) {
    return { url: input.url, title: parsed.title, content: parsed.markdown, error: null, kind: "pdf", pages: parsed.pages, chars, truncated: parsed.truncated };
  }

  const savedPath = saveLargeMarkdown({ outputDir: input.outputDir, title: parsed.title, url: input.url, content: parsed.markdown, cwd: input.cwd });
  const preview = parsed.markdown.slice(0, input.previewChars);
  const content = [
    "PDF extracted successfully.",
    "",
    `Title: ${parsed.title}`,
    `Pages: ${parsed.pages}`,
    `Characters: ${chars}`,
    `Saved markdown: ${savedPath}`,
    parsed.truncated ? "Extraction truncated by maxPages setting." : "Extraction complete.",
    "",
    "Preview:",
    preview,
    "",
    "Use read on the saved Markdown file for the full content, or brightdata_get_content with the responseId for stored metadata/content retrieval."
  ].join("\n");

  return { url: input.url, title: parsed.title, content, error: null, kind: "pdf", savedPath, pages: parsed.pages, chars, truncated: true };
}
```

- [ ] **Step 4: Integrate PDF transport and extraction into fetch**

Modify `extensions/brightdata/fetch.ts`:

- Import `shouldTreatAsPdfUrl`, `fetchPdfBytesWithFallback`, `extractPdfFromBytes`, and `isPdfResponse`.
- Add these fields to `FetchOptions`:

```ts
pdfEnabled: boolean;
pdfOutputDir: string;
pdfInlineMaxPages: number;
pdfInlineMaxChars: number;
pdfPreviewChars: number;
pdfMaxPages: number;
pdfMaxBytes: number;
```

`outputDir` (already on `FetchOptions`) is the destination for spilled **HTML** page Markdown; `pdfOutputDir` is the separate destination for spilled **PDF** Markdown. Keeping them distinct is what lets HTML pages land in `.pi/brightdata/pages` while PDFs land in `.pi/brightdata/pdfs`.

- Add a small helper in `fetch.ts` so both pre-routed PDFs and PDF responses discovered after Bright Data fetch use the same extraction path:

```ts
async function extractPdfPage(url: string, bytes: ArrayBuffer, options: FetchOptions): Promise<FetchPageResult> {
  return extractPdfFromBytes({
    url,
    bytes,
    outputDir: options.pdfOutputDir,
    cwd: options.cwd,
    inlineMaxPages: options.pdfInlineMaxPages,
    inlineMaxChars: options.pdfInlineMaxChars,
    previewChars: options.pdfPreviewChars,
    maxPages: options.pdfMaxPages,
  });
}
```

- In the per-URL worker, before the normal page Bright Data request, add:

```ts
if (options.pdfEnabled && await shouldTreatAsPdfUrl(url, options.signal)) {
  const bytes = await fetchPdfBytesWithFallback({
    url,
    zone: options.zone,
    country: options.country,
    maxBytes: options.pdfMaxBytes,
    signal: options.signal,
  });
  return extractPdfPage(url, bytes, options);
}
```

- After the normal Bright Data request, before calling `pageOutput`, detect extensionless/misreported PDFs and route them to PDF extraction:

```ts
if (options.pdfEnabled && isPdfResponse(url, response.headers, response.bytes)) {
  if (response.bytes.byteLength > options.pdfMaxBytes) throw new Error(`PDF too large (${response.bytes.byteLength} bytes)`);
  return extractPdfPage(url, response.bytes, options);
}
```

This ensures a failed/inconclusive HEAD does not cause PDF bytes from Bright Data to be decoded as Markdown/text.

- Update tests that call `fetchBrightDataPages` to pass the new fields:

```ts
pdfEnabled: false,
pdfOutputDir: makeDir(),
pdfInlineMaxPages: 5,
pdfInlineMaxChars: 20000,
pdfPreviewChars: 2000,
pdfMaxPages: 200,
pdfMaxBytes: 52428800,
```

- [ ] **Step 5: Run PDF and fetch tests**

Run:

```bash
cd extensions/brightdata && npm test -- tests/pdf.test.ts tests/fetch.test.ts tests/output-safety.test.ts && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 6: Commit PDF extraction**

```bash
git add extensions/brightdata/pdf.ts extensions/brightdata/tests/pdf.test.ts extensions/brightdata/fetch.ts extensions/brightdata/tests/fetch.test.ts extensions/brightdata/output-safety.ts extensions/brightdata/tests/output-safety.test.ts extensions/brightdata/types.ts
git commit -m "feat: add adaptive PDF extraction"
```

---

### Task 7: Pi extension registration and TUI renderers

**Files:**
- Create: `extensions/brightdata/render.ts`
- Create: `extensions/brightdata/index.ts`
- Create: `extensions/brightdata/tests/index.test.ts`

- [ ] **Step 1: Write failing registration tests**

Create `extensions/brightdata/tests/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.js";

type RegisteredTool = { name: string; execute: (...args: unknown[]) => Promise<unknown> };

function fakePi() {
  const tools: RegisteredTool[] = [];
  const handlers: Record<string, Function[]> = {};
  const appendEntry = vi.fn();
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    on: (event: string, handler: Function) => { handlers[event] = [...(handlers[event] ?? []), handler]; },
    appendEntry
  } as unknown as ExtensionAPI;
  return { pi, tools, handlers, appendEntry };
}

describe("brightdata extension", () => {
  it("registers three Bright Data tools", () => {
    const { pi, tools } = fakePi();
    extension(pi);
    expect(tools.map((tool) => tool.name).sort()).toEqual(["brightdata_fetch", "brightdata_get_content", "brightdata_search"]);
  });

  it("registers a session_start restore handler", () => {
    const { pi, handlers } = fakePi();
    extension(pi);
    expect(handlers.session_start).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run registration tests to verify failure**

Run:

```bash
cd extensions/brightdata && npm test -- tests/index.test.ts
```

Expected: FAIL because `index.ts` does not exist.

- [ ] **Step 3: Implement render helpers**

Create `extensions/brightdata/render.ts`:

```ts
import { Text } from "@earendil-works/pi-tui";

function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

export function renderSearchCall(args: { query?: unknown; queries?: unknown }, theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }) {
  const queries = Array.isArray(args.queries) ? args.queries : args.query ? [args.query] : [];
  const title = theme.fg("toolTitle", theme.bold("brightdata_search "));
  if (queries.length === 1 && typeof queries[0] === "string") return new Text(title + theme.fg("accent", `"${queries[0].slice(0, 80)}"`), 0, 0);
  return new Text(title + theme.fg(queries.length > 0 ? "accent" : "error", queries.length > 0 ? `${queries.length} queries` : "no query"), 0, 0);
}

export function renderFetchCall(args: { url?: unknown; urls?: unknown }, theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }) {
  const urls = Array.isArray(args.urls) ? args.urls : args.url ? [args.url] : [];
  const title = theme.fg("toolTitle", theme.bold("brightdata_fetch "));
  if (urls.length === 1 && typeof urls[0] === "string") return new Text(title + theme.fg("accent", urls[0].slice(0, 90)), 0, 0);
  return new Text(title + theme.fg(urls.length > 0 ? "accent" : "error", urls.length > 0 ? `${urls.length} URLs` : "no URL"), 0, 0);
}

export function renderTextResult(result: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }, options: { expanded?: boolean; isPartial?: boolean }, theme: { fg: (color: string, text: string) => string }) {
  if (options.isPartial) return new Text(theme.fg("warning", "Working..."), 0, 0);
  if (result.details?.error) return new Text(theme.fg("error", String(result.details.error)), 0, 0);
  const text = firstText(result);
  const preview = text.length > 500 && !options.expanded ? text.slice(0, 500) + "..." : text;
  return new Text(theme.fg("dim", preview), 0, 0);
}
```

- [ ] **Step 4: Implement Pi extension registration**

Create `extensions/brightdata/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { getBrightDataApiKey, loadBrightDataConfig } from "./config.js";
import { fetchBrightDataPages, getStoredContentText } from "./fetch.js";
import { formatSearchMarkdown, searchBrightData } from "./search.js";
import { BRIGHTDATA_RESULTS_CUSTOM_TYPE, generateResponseId, restoreFromSession, storeResult, type StoredBrightDataResult } from "./storage.js";
import { renderFetchCall, renderSearchCall, renderTextResult } from "./render.js";

const SearchParams = Type.Object({
  query: Type.Optional(Type.String({ description: "Single search query. Use queries for multiple angles." })),
  queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple search queries." })),
  engine: Type.Optional(StringEnum(["google", "bing", "duckduckgo", "yandex"] as const, { description: "Search engine. Defaults to config." })),
  country: Type.Optional(Type.String({ description: "Two-letter country code. Defaults to config." })),
  language: Type.Optional(Type.String({ description: "Language code. Defaults to config." })),
  numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Results per query." })),
});

const FetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "Single public http/https URL to fetch." })),
  urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple public http/https URLs to fetch." })),
  country: Type.Optional(Type.String({ description: "Two-letter country code. Defaults to config." })),
  maxCharsPerPage: Type.Optional(Type.Integer({ minimum: 1000, maximum: 100000, description: "Inline character cap per page." })),
});

const GetContentParams = Type.Object({
  responseId: Type.String({ description: "Response ID from brightdata_search or brightdata_fetch." }),
  query: Type.Optional(Type.String({ description: "Search query to retrieve." })),
  queryIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Search query index to retrieve." })),
  url: Type.Optional(Type.String({ description: "Fetched URL to retrieve." })),
  urlIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Fetched URL index to retrieve." })),
});

function assertApiKeyConfigured(): void {
  if (!getBrightDataApiKey()) {
    throw new Error("Bright Data API key not found. Set BRIGHT_DATA_KEY or BRIGHTDATA_API_KEY.");
  }
}

function queryList(params: { query?: string; queries?: string[] }): string[] {
  return (Array.isArray(params.queries) ? params.queries : params.query ? [params.query] : [])
    .map((query) => query.trim())
    .filter(Boolean);
}

function urlList(params: { url?: string; urls?: string[] }): string[] {
  return (Array.isArray(params.urls) ? params.urls : params.url ? [params.url] : [])
    .map((url) => url.trim())
    .filter(Boolean);
}

export default function brightdataExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    restoreFromSession(ctx);
  });

  pi.registerTool({
    name: "brightdata_search",
    label: "Bright Data Search",
    description: "Search the web using Bright Data SERP and return normalized ranked results. Does not synthesize an AI answer in v1.",
    promptSnippet: "Search live web SERPs through Bright Data and return ranked result URLs/snippets.",
    promptGuidelines: [
      "Use brightdata_search when the user asks for current web search results and Bright Data is the intended provider.",
      "Use brightdata_fetch after brightdata_search to read selected result URLs."
    ],
    parameters: SearchParams,
    async execute(_toolCallId, params, signal) {
      assertApiKeyConfigured();
      const config = loadBrightDataConfig();
      const queries = queryList(params);
      const entries = await searchBrightData(queries, {
        zone: config.brightdata.serpZone,
        engine: params.engine ?? config.search.defaultEngine,
        country: params.country ?? config.brightdata.defaultCountry,
        language: params.language ?? config.brightdata.defaultLanguage,
        limit: Math.min(params.numResults ?? config.search.defaultLimit, config.search.maxResults),
        maxQueries: config.search.maxQueries,
        signal,
      });
      const id = generateResponseId();
      const data: StoredBrightDataResult = { id, provider: "brightdata", type: "search", timestamp: Date.now(), queries: entries };
      storeResult(data);
      pi.appendEntry(BRIGHTDATA_RESULTS_CUSTOM_TYPE, data);
      return { content: [{ type: "text" as const, text: `${formatSearchMarkdown(entries)}\n\n---\nResponse ID: ${id}` }], details: { responseId: id, queries: entries } };
    },
    renderCall: renderSearchCall,
    renderResult: renderTextResult,
  });

  pi.registerTool({
    name: "brightdata_fetch",
    label: "Bright Data Fetch",
    description: "Fetch public URL(s) through Bright Data Unlocker as Markdown. PDFs are parsed adaptively and large content is saved to disk.",
    promptSnippet: "Fetch public URLs through Bright Data Unlocker and return readable content or saved Markdown paths.",
    promptGuidelines: [
      "Use brightdata_fetch when the user provides public URLs or after brightdata_search finds relevant pages.",
      "Do not use brightdata_fetch for YouTube transcript workflows; use the YouTube skills."
    ],
    parameters: FetchParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      assertApiKeyConfigured();
      const config = loadBrightDataConfig();
      const urls = urlList(params);
      onUpdate?.({ content: [{ type: "text", text: `Fetching ${urls.length} URL(s)...` }], details: { phase: "fetch", progress: 0 } });
      const result = await fetchBrightDataPages(urls, {
        zone: config.brightdata.unlockerZone,
        country: params.country ?? config.brightdata.defaultCountry,
        preferMarkdown: config.fetch.preferMarkdown,
        maxUrls: config.fetch.maxUrls,
        maxInlineChars: Math.min(params.maxCharsPerPage ?? config.fetch.maxInlineChars, config.fetch.maxInlineChars),
        outputDir: config.fetch.outputDir,
        cwd: ctx.cwd,
        concurrency: config.brightdata.concurrency,
        pdfEnabled: config.pdf.enabled,
        pdfOutputDir: config.pdf.outputDir,
        pdfInlineMaxPages: config.pdf.inlineMaxPages,
        pdfInlineMaxChars: config.pdf.inlineMaxChars,
        pdfPreviewChars: config.pdf.previewChars,
        pdfMaxPages: config.pdf.maxPages,
        pdfMaxBytes: config.pdf.maxBytes,
        signal,
      });
      pi.appendEntry(BRIGHTDATA_RESULTS_CUSTOM_TYPE, result.data);
      return { content: [{ type: "text" as const, text: result.markdown }], details: { responseId: result.data.id, urls: result.data.urls } };
    },
    renderCall: renderFetchCall,
    renderResult: renderTextResult,
  });

  pi.registerTool({
    name: "brightdata_get_content",
    label: "Bright Data Get Content",
    description: "Retrieve stored full content from a previous brightdata_search or brightdata_fetch call.",
    promptSnippet: "Retrieve stored Bright Data search/fetch content by responseId and selector.",
    parameters: GetContentParams,
    async execute(_toolCallId, params) {
      const text = getStoredContentText(params);
      return { content: [{ type: "text" as const, text }], details: { responseId: params.responseId } };
    },
    renderResult: renderTextResult,
  });
}
```

- [ ] **Step 5: Run registration tests and all tests**

Run:

```bash
cd extensions/brightdata && npm test && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

- [ ] **Step 6: Commit Pi registration**

```bash
git add extensions/brightdata/index.ts extensions/brightdata/render.ts extensions/brightdata/tests/index.test.ts
git commit -m "feat: register Bright Data Pi tools"
```

---

### Task 8: Documentation, final verification, and smoke-test notes

**Files:**
- Create: `extensions/brightdata/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write extension README**

Create `extensions/brightdata/README.md`:

```md
# pi-brightdata-tools

Bright Data tools for Pi:

- `brightdata_search` — Bright Data SERP search with normalized ranked results.
- `brightdata_fetch` — Bright Data Unlocker fetch with Markdown output and adaptive PDF extraction.
- `brightdata_get_content` — retrieve stored content by `responseId`.

The extension validates targets through a request-safety boundary before local fetches or Bright Data requests, rejects local/private URLs, and truncates large stored content on retrieval with saved-path guidance.

## Secrets

Set one of:

```bash
export BRIGHT_DATA_KEY="..."
export BRIGHTDATA_API_KEY="..."
```

`BRIGHT_DATA_KEY` takes precedence.

## Config

Optional config file:

```text
~/.pi/brightdata.json
```

Example:

```json
{
  "brightdata": {
    "serpZone": "pi_serp_api",
    "unlockerZone": "mcp_unlocker",
    "defaultCountry": "au",
    "defaultLanguage": "en",
    "requestTimeoutMs": 60000,
    "concurrency": 3
  },
  "search": {
    "defaultEngine": "google",
    "defaultLimit": 10,
    "maxQueries": 10,
    "maxResults": 20
  },
  "fetch": {
    "maxUrls": 10,
    "maxInlineChars": 30000,
    "preferMarkdown": true,
    "outputDir": ".pi/brightdata/pages"
  },
  "pdf": {
    "enabled": true,
    "inlineMaxPages": 5,
    "inlineMaxChars": 20000,
    "previewChars": 2000,
    "maxPages": 200,
    "maxBytes": 52428800,
    "outputDir": ".pi/brightdata/pdfs"
  }
}
```

Zone env vars override config:

```bash
export BRIGHTDATA_SERP_ZONE="pi_serp_api"
export BRIGHTDATA_UNLOCKER_ZONE="mcp_unlocker"
```

## Local development

```bash
cd extensions/brightdata
npm install
npm test
npm run typecheck
```

## Manual smoke test

Run Pi with only this extension:

```bash
pi --no-extensions -e ./extensions/brightdata/index.ts
```

Try:

```text
Use brightdata_search for "Bright Data SERP API brd_json" with 3 results.
```

Then:

```text
Use brightdata_fetch on one of the result URLs.
```

For PDF behavior, fetch one small PDF and one larger PDF. Small PDFs should return inline Markdown. Large PDFs should save Markdown to `.pi/brightdata/pdfs` and return a path plus preview. For large HTML pages, confirm the spilled Markdown is saved under `.pi/brightdata/pages` (the separate fetch output directory) and returned as a path plus preview. If practical, also verify that an extensionless PDF URL routes to PDF extraction and that saved content retrieval returns truncated/preview output rather than unbounded full files.
```

- [ ] **Step 2: Update root README structure list**

Modify `README.md` to add one bullet under Structure:

```md
- `extensions/brightdata/` — Bright Data search/fetch/PDF Pi tools
```

- [ ] **Step 3: Run full verification**

Run:

```bash
cd extensions/brightdata && npm test && npm run typecheck
```

Expected: PASS and typecheck exits with code 0.

Run repository status check:

```bash
git status --short
```

Expected: only intended Bright Data files and root README are modified/untracked.

- [ ] **Step 4: Commit docs and final verification updates**

```bash
git add extensions/brightdata/README.md README.md
git commit -m "docs: document Bright Data tools"
```

- [ ] **Step 5: Final manual smoke command**

If `BRIGHT_DATA_KEY` is available in the shell, run:

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions
pi --no-extensions -e ./extensions/brightdata/index.ts
```

Expected: Pi starts and lists `brightdata_search`, `brightdata_fetch`, and `brightdata_get_content` as available custom tools. If Pi is not run interactively during implementation, record this as a manual verification step for the final handoff.

---

## Plan self-review

Spec coverage:

- Standalone package: Tasks 1 and 7.
- `BRIGHT_DATA_KEY` primary and `BRIGHTDATA_API_KEY` fallback: Task 1.
- `~/.pi/brightdata.json` JSON config and zone env overrides: Task 1.
- Bright Data client with documented request fields and target validation: Task 2.
- Request safety boundary for public URL validation, private/local blocking, and safe manual redirects: Task 2.
- `brd_json=1` SERP search with `format: "raw"`: Task 3.
- Unlocker `data_format: "markdown"` fetch: Task 5.
- Result storage using `brightdata-results`, TTL restore, collision-resistant saved filenames, and disk persistence: Task 4.
- Output safety/truncation for stored content retrieval: Task 5.
- Adaptive PDF parsing with direct-byte fetch, Bright Data raw-byte fallback, `unpdf`, non-recoverable unsafe redirect handling, extensionless PDF detection, and file save for large PDFs: Task 6.
- Pi tool registration with `StringEnum` and `@earendil-works` imports: Task 7.
- TUI renderers: Task 7.
- Documentation and manual smoke test: Task 8.

The task list contains concrete file paths, commands, and code snippets. Type names and config keys use camelCase consistently.
