# Bright Data Tools Extension Design

Date: 2026-05-30
Status: Draft for user review

## Summary

Build a standalone Pi extension/package named `pi-brightdata-tools` that exposes Bright Data web search and web fetch capabilities without modifying `pi-web-access`.

The extension provides three LLM-callable tools:

- `brightdata_search` — run one or more SERP queries through Bright Data and return normalized ranked results.
- `brightdata_fetch` — fetch one or more public web URLs through Bright Data Unlocker and return readable Markdown/content.
- `brightdata_get_content` — retrieve stored full content from a previous search or fetch result by `responseId`.

The first version intentionally keeps the tool boundary narrow: general web search, general web fetch, and PDF extraction. GitHub repo cloning/code exploration and YouTube transcript/video analysis are better handled as skills or separate domain workflows, not inside a pure web fetch primitive.

## Goals

1. Provide a Bright Data-backed web search tool for Pi agents.
2. Provide a Bright Data-backed web fetch tool that returns cleaned page content.
3. Include adaptive PDF handling:
   - small PDFs can be returned inline;
   - large PDFs are extracted to Markdown on disk and returned as metadata plus a preview/path.
4. Store full results behind stable `responseId` values so later tool calls can retrieve content without repeating Bright Data requests.
5. Use compact TUI rendering patterns similar to `pi-web-access`.
6. Keep Bright Data API keys out of repo files and use environment variables for secrets.
7. Keep non-secret Bright Data zone names and defaults in an editable user-level JSON config file.

## Non-goals for v1

1. Do not modify or fork `pi-web-access`.
2. Do not register conflicting `web_search` or `web_fetch` aliases in v1.
3. Do not implement GitHub repo cloning or code-context extraction in `brightdata_fetch`.
4. Do not implement YouTube/video transcript extraction in `brightdata_fetch`.
5. Do not build a full curator/browser UI in v1.
6. Do not add Bright Data Browser API, Crawl API, screenshots, or dataset tooling in v1.

## Package and location

Initial local implementation lives under:

```text
extensions/brightdata/
  index.ts
  brightdata-client.ts
  config.ts
  search.ts
  fetch.ts
  pdf.ts
  storage.ts
  urls.ts
  request-safety.ts
  output-safety.ts
  render.ts
  package.json
  tsconfig.json
```

The package manifest declares the Pi extension entry via the `pi.extensions` field. Runtime dependencies live in `dependencies`, not `devDependencies`, so the extension works when installed as a Pi package later.

Module boundaries:

- `urls.ts` contains pure URL helpers and SERP URL construction. It should not own security policy beyond basic parsing/canonicalization helpers.
- `request-safety.ts` is the centralized request-target safety boundary. It validates public HTTP(S) targets, rejects local/private/link-local addresses, validates redirect targets before local direct fetches follow them, exposes an `UnsafeUrlError` (or equivalent typed non-recoverable safety error), and provides safe local `HEAD`/`GET` helpers that use manual redirect handling.
- `output-safety.ts` is the centralized tool-output safety boundary. It applies Pi truncation utilities, formats truncation notices, preserves saved-path guidance, and is the intended home for future untrusted-content/prompt-injection labeling.

## Configuration

### Secret configuration

The extension reads the API key from environment variables only.

Supported variables, in priority order:

1. `BRIGHT_DATA_KEY`
2. `BRIGHTDATA_API_KEY`

`BRIGHT_DATA_KEY` is supported as the primary variable because the user's existing `.secrets` file already exports it. `BRIGHTDATA_API_KEY` is accepted as a compatibility alias for users who prefer the common provider-style name.

The API key is never stored in config files, session entries, tool details, or logs.

### Non-secret JSON configuration

Non-secret Bright Data settings live in a user-level JSON file, matching the `pi-web-access` convention (`~/.pi/web-search.json`):

```text
~/.pi/brightdata.json
```

JSON is used instead of TOML so the extension needs no TOML-parser dependency (Node has no built-in TOML support) and so config conventions match the rest of the Pi ecosystem. A user-level path also stays editable after the extension is installed as an npm/git Pi package, where editing package-local files is inconvenient.

Initial config shape:

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

Optionally, `BRIGHTDATA_SERP_ZONE` and `BRIGHTDATA_UNLOCKER_ZONE` environment variables override the configured zone names, so the extension drops into existing Bright Data setups with zero config edits.

Relative paths inside the config, such as `fetch.outputDir` and `pdf.outputDir`, resolve against the current Pi project working directory, not against the extension source folder. This avoids writing generated files into the extension package.

The entire config file is optional: a missing file uses all defaults, and invalid or missing individual values fall back to safe defaults. A malformed JSON file produces a clear tool error that names the config path and parse failure.

## Request safety boundary

All user-provided URLs and all target URLs sent to Bright Data pass through `request-safety.ts` before any network request is made.

The extension distinguishes two safety contexts:

1. **Bright Data target validation** — before sending a URL to Bright Data, validate that it is an absolute public `http`/`https` URL.
2. **Local direct fetch validation** — for any local `HEAD` or `GET` performed by the extension, validate the initial URL and every redirect target before following it.

Local direct fetches must use manual redirect handling, not automatic redirect following. If any redirect target is blocked as local/private/unsafe, the operation fails with `UnsafeUrlError` and must not fall back to Bright Data for that same URL.

Blocked targets include at least:

- `localhost` and common local host aliases;
- loopback IPv4/IPv6;
- private IPv4 ranges;
- link-local IPv4/IPv6;
- unspecified addresses such as `0.0.0.0` and `::`;
- IPv4-mapped IPv6 loopback/private forms.

The v1 implementation may use syntactic IP/hostname checks. DNS-resolution-based private-IP detection is future hardening unless implemented in v1, but `request-safety.ts` must be structured so DNS checks, allow/deny policies, URL length limits, and similar request hardening can be added without changing search/fetch/PDF business logic.

## Bright Data client

All Bright Data API calls go through one small client module.

Responsibilities:

- Build requests to `https://api.brightdata.com/request`.
- Accept only target URLs that have already passed `request-safety.ts` Bright Data target validation.
- Attach `Authorization: Bearer <key>`.
- Pass Pi's `AbortSignal` to `fetch`.
- Apply request timeouts.
- Build the request body with the documented Bright Data fields: `zone`, `url`, `format` (`"raw"` or `"json"` — controls the response envelope), and optional `data_format: "markdown"` (HTML→Markdown conversion) and `country`.
- Parse JSON responses opportunistically.
- Preserve raw text/binary responses when the Bright Data endpoint returns raw content.
- Normalize Bright Data errors into actionable messages:
  - authentication failure;
  - zone/product permission failure;
  - quota/rate-limit failure;
  - target fetch/unlock failure;
  - timeout/abort.

The client does not know about Pi tool schemas. Search, fetch, and PDF modules call it through typed helper functions.

## Tool: `brightdata_search`

Purpose: discover web pages by query using Bright Data SERP.

Parameters:

- `query?: string` — single search query.
- `queries?: string[]` — multiple search queries.
- `engine?: "google" | "bing" | "duckduckgo" | "yandex"` — defaults from config. Define this with `StringEnum` from `@earendil-works/pi-ai` (not a raw `Type.Union`) for Gemini/Google-compatible tool schemas.
- `country?: string` — defaults from config.
- `language?: string` — defaults from config.
- `numResults?: number` — capped by config `search.maxResults`.

Behavior:

1. Normalize `query`/`queries` into a non-empty query list.
2. Reject query batches larger than `search.maxQueries`.
3. Build target search URLs for the selected engine, appending `brd_json=1` to the target URL to request parsed SERP JSON. (Note: parsed results come from the `brd_json` URL parameter, not from the request body `format` field. The request uses `zone: brightdata.serpZone` and `format: "raw"`; the parsed JSON is returned in the response body because of `brd_json`.)
4. Call Bright Data `/request` with the constructed target URL.
5. Normalize common SERP fields into:

```ts
interface BrightDataSearchResult {
  rank: number;
  title: string;
  url: string;
  snippet?: string;
  source?: string;
}
```

6. Return clean Markdown grouped by query.
7. Store raw and normalized results in session-backed storage under a generated `responseId`.

The tool does not synthesize an AI answer in v1. It returns ranked SERP results. If a future version adds summarization, it should be explicit and optional.

## Tool: `brightdata_fetch`

Purpose: fetch public URLs through Bright Data Unlocker and return readable content.

Parameters:

- `url?: string` — single public `http`/`https` URL.
- `urls?: string[]` — multiple public `http`/`https` URLs.
- `country?: string` — defaults from config.
- `maxCharsPerPage?: number` — capped by config `fetch.maxInlineChars`.

Behavior:

1. Normalize `url`/`urls` into a non-empty URL list.
2. Reject URL batches larger than `fetch.maxUrls`.
3. Validate every URL through `request-safety.ts` before any Bright Data request. Reject non-HTTP(S), localhost, private-network, link-local, loopback, unspecified, and other blocked targets.
4. Process URLs with bounded concurrency from config, using `p-limit` (matching `pi-web-access`).
5. For normal web pages, process each URL into a per-page result:
   - call Bright Data Unlocker with `zone: brightdata.unlockerZone`;
   - request HTML→Markdown conversion via `data_format: "markdown"` when `fetch.preferMarkdown` is true;
   - apply the per-page inline cap (`maxCharsPerPage`, itself capped by `fetch.maxInlineChars`): if the page is within the cap, keep its full content inline; if it exceeds the cap, save the full content to disk (see Storage model) and keep only a head preview plus a truncation note that records the saved path;
   - store every page (full inline content, or saved path + metadata for spilled pages) behind a single shared `responseId` for the call.
6. Return shape depends on URL count, matching `pi-web-access`'s `fetch_content` and avoiding context flooding for batches:
   - **Single URL** — return that page's content directly inline (already truncated with a saved-path note if it exceeded the cap), followed by the `responseId`.
   - **Multiple URLs** — return a compact summary list only (one line per page: title/URL, character count, and saved path when spilled), followed by the single `responseId`. Do **not** inline page bodies for batches. The agent retrieves any full page on demand via `brightdata_get_content` using a `url`/`urlIndex` selector.
7. For PDFs:
   - route through adaptive PDF handling described below (the per-page inline-vs-disk decision uses the PDF-specific limits, not `maxCharsPerPage`).

`brightdata_fetch` is intentionally not a domain-specific workflow tool. It does not clone GitHub repos, run `yt-dlp`, call Whisper, or analyze video. Those belong in skills or separate tools.

Example single-URL output (full content inline):

```text
# Example Page Title

[full Markdown body, or a head preview ending in a `[Content truncated. Saved full content to: ...]` note if it exceeded the cap]

---
Response ID: bd_...
```

Example multi-URL output (summary only — no page bodies inline):

```text
## Fetched URLs

- Example Page Title: 8,200 chars
- Another Page: 64,000 chars, saved: .pi/brightdata/pages/another-page.md
- https://blocked.example/x: Error - <message>

Response ID: bd_...
```

The agent then pulls any specific page in full with `brightdata_get_content({ responseId: "bd_...", urlIndex: 1 })` (or a `url` selector).

## Adaptive PDF handling

PDF handling stays in scope because a PDF URL is still a web document fetch, and Bright Data's `data_format: "markdown"` only converts **HTML pages** to Markdown — it does not extract text from PDF binaries. For a PDF URL, Unlocker returns the raw PDF bytes, so the extension must parse the PDF itself (mirroring `pi-web-access`, which fetches PDF bytes and runs `unpdf`). Unlocker is used here only as a fallback transport to retrieve the bytes past anti-bot protection, never as a Markdown extractor.

Detection:

- URL path ending in `.pdf`; or
- target response `Content-Type` containing `application/pdf`.

Fetch strategy:

1. If the URL path ends in `.pdf`, attempt a direct PDF byte fetch first, because this avoids spending Bright Data quota for ordinary public PDFs. The direct fetch must use `request-safety.ts` local fetch helpers with manual redirects; every redirect target is validated before following. A private/local/unsafe redirect raises `UnsafeUrlError` and is not eligible for Bright Data fallback.
2. For URLs that do not end in `.pdf`, perform a lightweight direct `HEAD` request through the same local safety helper when possible; if it reports `application/pdf`, route to PDF extraction. Treat a non-`application/pdf` or failed/unsupported HEAD as inconclusive ("probably not a PDF"): proceed with the normal page path, which still detects PDF bytes as a fallback. Routing must not hard-depend on HEAD, since many servers reject HEAD or report a content-type that differs from GET.
3. If direct PDF fetch fails for recoverable transport reasons, times out, returns a blocking status, or does not return a PDF, retry through Bright Data Unlocker with `format: "raw"` to retrieve the raw PDF bytes (not `data_format: "markdown"`, which is HTML-only). Do not retry through Bright Data after `UnsafeUrlError`.
4. For extensionless or misreported PDFs, normal Bright Data fetch processing must inspect the Bright Data response `Content-Type` and/or PDF magic bytes. If the response is a PDF, route to PDF extraction instead of treating bytes as Markdown/text.
5. Enforce `pdf.maxBytes` before parsing.
6. Validate that PDF fallback responses actually contain PDF bytes before parsing.
7. Extract text with a PDF parser such as `unpdf`.
8. Extract metadata when available: title, author, page count.
9. Convert extracted pages into Markdown with source metadata and page markers.
10. Extract up to `pdf.maxPages`; mark truncation clearly if the document has more pages.

Inline-vs-file rule:

Return the full extracted Markdown inline only when both are true:

- extracted page count is `<= pdf.inlineMaxPages`; and
- extracted Markdown length is `<= pdf.inlineMaxChars`.

Otherwise:

- save full extracted Markdown to `pdf.outputDir`;
- return title, URL, page count, extracted character count, truncation status, saved path, and a preview of `pdf.previewChars`;
- store metadata and the saved path under the fetch `responseId`.

Example large-PDF tool output:

```text
PDF extracted successfully.

Title: Attention Is All You Need
Pages: 15
Characters: 42,300
Saved markdown: .pi/brightdata/pdfs/attention-is-all-you-need.md
Response ID: bd_...

Preview:
[first configured preview chars]

Use read on the saved Markdown file for the full content, or brightdata_get_content with the responseId for stored metadata/content retrieval.
```

## Tool: `brightdata_get_content`

Purpose: retrieve stored content from previous Bright Data tool calls without repeating external requests.

Parameters:

- `responseId: string`
- `query?: string`
- `queryIndex?: number`
- `url?: string`
- `urlIndex?: number`

Behavior:

- For search results, return the selected query's normalized results and raw result summary.
- For fetched pages, select the page by `url`/`urlIndex` (defaulting to the first page) and return its content. When the page was spilled to disk, read the full content back from its saved path; otherwise return the stored inline content.
- For large PDFs saved to disk, return metadata, saved path, and a preview. It may return full content only if it can do so within the same truncation limits used by other tools.
- If content is too large, instruct the agent to use the built-in `read` tool on the saved Markdown path.

The tool output is truncated through `output-safety.ts` using Pi's truncation utilities to avoid context overflow. `brightdata_get_content` must not blindly return full saved files. It returns full content only within Pi-safe limits, discloses truncation clearly, includes saved paths when available, and for large saved PDFs prefers metadata plus preview plus saved path over full inline content.

## Storage model

The storage layer mirrors `pi-web-access`: an in-memory `Map<responseId, StoredData>` for the active session, plus persistence through Pi session custom entries so results survive reload/resume.

- Persistence uses `pi.appendEntry` with a dedicated `customType` of `brightdata-results`.
- On `session_start`, a `restoreFromSession(ctx)` helper rebuilds the in-memory map from the current branch's custom entries, validating each entry's shape with a type guard and discarding entries older than a freshness TTL (`pi-web-access` uses one hour; reuse that default).
- Full content is persisted in the session entry (like `pi-web-access`'s `StoredSearchData`, which stores complete `queries`/`urls`), except for large content already saved to disk, where the entry stores the saved path and metadata instead of duplicating the bytes.

Stored entries include:

- provider: `brightdata`;
- tool name;
- timestamp;
- normalized search results or fetch content/metadata;
- saved file paths for large PDFs and large fetched pages;
- enough metadata to render useful summaries.

Reload survival is symmetric across content types: large fetched HTML pages and large PDFs are both saved to disk and referenced by path, so `brightdata_get_content` can always recover them after reload. The two content types use separate, independently configurable directories — large HTML pages spill to `fetch.outputDir` (default `.pi/brightdata/pages`) and large PDFs spill to `pdf.outputDir` (default `.pi/brightdata/pdfs`) — so a saved file's location matches its content type. Only content that fits inline (and is therefore small) lives purely in the session entry. The API key is never written into any session entry.

## TUI rendering

Each tool gets compact custom renderers.

`brightdata_search`:

- call view: `brightdata_search "query"` or `brightdata_search N queries`;
- result view: successful query count, result count, provider label;
- expanded view: first few normalized results.

`brightdata_fetch`:

- call view: single URL or URL count;
- partial view: progress bar/status;
- result view: success count and content/PDF summary;
- expanded view: short preview and saved path if applicable.

`brightdata_get_content`:

- call view: response ID and selector;
- result view: selected content type and truncation/path details.

The v1 renderers stay text-only. No browser curator or rich UI is included.

## Error handling and safety

- Missing API key returns an actionable error naming `BRIGHT_DATA_KEY` and `BRIGHTDATA_API_KEY`.
- Missing zone config returns an actionable error naming `brightdata.serpZone` or `brightdata.unlockerZone` in `~/.pi/brightdata.json`.
- Bad JSON reports the config path and parser message.
- Invalid URLs are rejected before any Bright Data request.
- Local/private/unsafe URLs are rejected before any Bright Data request, including redirect targets on local direct fetch paths.
- `UnsafeUrlError` is non-recoverable: PDF direct fetch must not fall back to Bright Data after an unsafe redirect or unsafe target.
- Tool aborts propagate to Bright Data requests and PDF parsing where possible.
- Quota/rate-limit failures are surfaced clearly and do not trigger large retry loops.
- Outputs are truncated and disclose truncation clearly.
- API keys are never printed.

## Testing strategy

Unit tests use Vitest (matching the existing extension packages in this repository) and mocked `fetch`/fixtures.

Coverage:

1. Config loading:
   - valid JSON;
   - missing file / defaults;
   - malformed JSON;
   - `BRIGHT_DATA_KEY` and `BRIGHTDATA_API_KEY` precedence;
   - `BRIGHTDATA_SERP_ZONE` / `BRIGHTDATA_UNLOCKER_ZONE` override of configured zones.
2. SERP request and normalization:
   - target URL is built with `brd_json=1` appended;
   - organic results;
   - alternate Bright Data `brd_json` response shapes;
   - empty result sets.
3. Request safety:
   - valid public HTTP(S);
   - invalid URL;
   - non-HTTP(S) rejection;
   - localhost, loopback, private, link-local, unspecified, and IPv4-mapped private/loopback rejection;
   - relative redirect resolution against the current URL;
   - redirects to local/private/unsafe targets are rejected;
   - local fetch helper uses `redirect: "manual"`;
   - `UnsafeUrlError` is non-recoverable and prevents PDF Bright Data fallback.
4. Bright Data client:
   - success JSON;
   - success raw text;
   - HTTP error mapping;
   - abort/timeout handling.
5. Fetch formatting and storage:
   - single page;
   - multi-page batch;
   - truncation notice;
   - large page saved to disk and recovered via `brightdata_get_content` after reload;
   - `restoreFromSession` rebuilds the map and honors the freshness TTL;
   - `brightdata_get_content` selection by index/URL.
6. PDF extraction:
   - small PDF inline path;
   - large PDF saved-to-disk path;
   - direct PDF fetch with safe manual redirects;
   - direct unsafe redirect fails without Bright Data fallback;
   - extensionless URL with failed/inconclusive HEAD but Bright Data `Content-Type: application/pdf` routes to PDF extraction;
   - Bright Data response with PDF magic bytes routes to PDF extraction even if content type is missing or generic;
   - max-pages truncation note;
   - metadata returned correctly.
7. Output safety:
   - `brightdata_get_content` truncates large stored content;
   - saved PDF retrieval returns metadata/preview/path instead of unbounded full text;
   - truncation notices include saved-path guidance.
8. Tool schemas:
   - accepted minimal inputs;
   - rejected empty query/URL lists;
   - configured batch limits.

A manual smoke test uses a real Bright Data key and zones against one search query, one HTML page, one small PDF, and one large PDF.

## Future work

Potential follow-up additions after v1 proves useful:

1. Optional `web_search` / `web_fetch` aliases for users who disable `pi-web-access`.
2. A GitHub code-context skill that clones repositories locally and builds permalinks.
3. Bright Data Browser API or screenshot tools.
4. Batch crawl tools.
5. Optional summarization on top of SERP results.
6. DNS-resolution-based private-IP detection, domain allow/deny policy, URL length policy, and additional request injection/SSRF hardening inside `request-safety.ts`.
7. Prompt-injection labeling and stronger untrusted-content wrappers inside `output-safety.ts`.
