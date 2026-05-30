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
  render.ts
  package.json
  tsconfig.json
```

The package manifest declares the Pi extension entry via the `pi.extensions` field. Runtime dependencies live in `dependencies`, not `devDependencies`, so the extension works when installed as a Pi package later.

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
    "serpZone": "serp_api1",
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
    "preferMarkdown": true
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

Relative paths inside the config, such as `pdf.outputDir`, resolve against the current Pi project working directory, not against the extension source folder. This avoids writing generated files into the extension package.

The entire config file is optional: a missing file uses all defaults, and invalid or missing individual values fall back to safe defaults. A malformed JSON file produces a clear tool error that names the config path and parse failure.

## Bright Data client

All Bright Data API calls go through one small client module.

Responsibilities:

- Build requests to `https://api.brightdata.com/request`.
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
3. Reject non-HTTP(S), localhost, and common private-network URLs.
4. Process URLs with bounded concurrency from config, using `p-limit` (matching `pi-web-access`).
5. For normal web pages:
   - call Bright Data Unlocker with `zone: brightdata.unlockerZone`;
   - request HTML→Markdown conversion via `data_format: "markdown"` when `fetch.preferMarkdown` is true;
   - return inline content up to `maxCharsPerPage`;
   - store full content behind `responseId` (and, when content exceeds the inline cap, also save it to disk so it survives reload — see Storage model).
6. For PDFs:
   - route through adaptive PDF handling described below.

`brightdata_fetch` is intentionally not a domain-specific workflow tool. It does not clone GitHub repos, run `yt-dlp`, call Whisper, or analyze video. Those belong in skills or separate tools.

## Adaptive PDF handling

PDF handling stays in scope because a PDF URL is still a web document fetch, and Bright Data's `data_format: "markdown"` only converts **HTML pages** to Markdown — it does not extract text from PDF binaries. For a PDF URL, Unlocker returns the raw PDF bytes, so the extension must parse the PDF itself (mirroring `pi-web-access`, which fetches PDF bytes and runs `unpdf`). Unlocker is used here only as a fallback transport to retrieve the bytes past anti-bot protection, never as a Markdown extractor.

Detection:

- URL path ending in `.pdf`; or
- target response `Content-Type` containing `application/pdf`.

Fetch strategy:

1. If the URL path ends in `.pdf`, attempt a direct PDF byte fetch first, because this avoids spending Bright Data quota for ordinary public PDFs. Disable redirect following on this direct fetch (or re-validate every redirect hop against the private-network blocklist) to avoid SSRF via a redirect to an internal address after the initial URL passed validation.
2. For URLs that do not end in `.pdf`, perform a lightweight direct `HEAD` request when possible; if it reports `application/pdf`, route to PDF extraction. Treat a non-`application/pdf` or failed/unsupported HEAD as inconclusive ("probably not a PDF"): proceed with the normal page path, which still detects PDF bytes as a fallback. Routing must not hard-depend on HEAD, since many servers reject HEAD or report a content-type that differs from GET.
3. If direct PDF fetch fails, times out, returns a blocking status, or does not return a PDF, retry through Bright Data Unlocker with `format: "raw"` to retrieve the raw PDF bytes (not `data_format: "markdown"`, which is HTML-only).
4. Enforce `pdf.maxBytes` before parsing.
5. Extract text with a PDF parser such as `unpdf`.
6. Extract metadata when available: title, author, page count.
7. Convert extracted pages into Markdown with source metadata and page markers.
8. Extract up to `pdf.maxPages`; mark truncation clearly if the document has more pages.

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
- For fetched pages, return the selected page content.
- For large PDFs saved to disk, return metadata, saved path, and a preview. It may return full content only if it can do so within the same truncation limits used by other tools.
- If content is too large, instruct the agent to use the built-in `read` tool on the saved Markdown path.

The tool output is truncated using Pi's truncation utilities to avoid context overflow.

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

Reload survival is symmetric across content types: large fetched HTML pages and large PDFs are both saved to disk and referenced by path, so `brightdata_get_content` can always recover them after reload. Only content that fits inline (and is therefore small) lives purely in the session entry. The API key is never written into any session entry.

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
- Local/private URLs are rejected before any Bright Data request, including redirect targets on the direct PDF fetch path.
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
3. URL validation:
   - valid public HTTP(S);
   - invalid URL;
   - localhost/private IP rejection.
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
   - max-pages truncation note;
   - metadata returned correctly.
7. Tool schemas:
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
