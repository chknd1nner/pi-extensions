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
7. Keep non-secret Bright Data zone names and defaults in an editable TOML config file in the extension folder.

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
  config.toml
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

The API key is never stored in TOML, session entries, tool details, or logs.

### Non-secret TOML configuration

Non-secret Bright Data settings live in the extension folder:

```text
extensions/brightdata/config.toml
```

Initial config shape:

```toml
[brightdata]
serp_zone = "serp_api1"
unlocker_zone = "mcp_unlocker"
default_country = "au"
default_language = "en"
request_timeout_ms = 60000
concurrency = 3

[search]
default_engine = "google"
default_limit = 10
max_queries = 10
max_results = 20

[fetch]
max_urls = 10
max_inline_chars = 30000
prefer_markdown = true

[pdf]
enabled = true
inline_max_pages = 5
inline_max_chars = 20000
preview_chars = 2000
max_pages = 200
max_bytes = 52428800
output_dir = ".pi/brightdata/pdfs"
```

Relative paths inside the config, such as `pdf.output_dir`, resolve against the current Pi project working directory, not against the extension source folder. This avoids writing generated files into the extension package.

Invalid or missing config values fall back to safe defaults. A malformed TOML file produces a clear tool error that names the config path and parse failure.

## Bright Data client

All Bright Data API calls go through one small client module.

Responsibilities:

- Build requests to `https://api.brightdata.com/request`.
- Attach `Authorization: Bearer <key>`.
- Pass Pi's `AbortSignal` to `fetch`.
- Apply request timeouts.
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
- `engine?: "google" | "bing" | "duckduckgo" | "yandex"` — defaults from TOML.
- `country?: string` — defaults from TOML.
- `language?: string` — defaults from TOML.
- `numResults?: number` — capped by TOML `search.max_results`.

Behavior:

1. Normalize `query`/`queries` into a non-empty query list.
2. Reject query batches larger than `search.max_queries`.
3. Build target search URLs for the selected engine.
4. Call Bright Data SERP using `brightdata.serp_zone` and `format: "json"`.
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
- `country?: string` — defaults from TOML.
- `maxCharsPerPage?: number` — capped by TOML `fetch.max_inline_chars`.

Behavior:

1. Normalize `url`/`urls` into a non-empty URL list.
2. Reject URL batches larger than `fetch.max_urls`.
3. Reject non-HTTP(S), localhost, and common private-network URLs.
4. Process URLs with bounded concurrency from TOML.
5. For normal web pages:
   - call Bright Data Unlocker with `brightdata.unlocker_zone`;
   - request Markdown transformation when `fetch.prefer_markdown` is true;
   - return inline content up to `maxCharsPerPage`;
   - store full content behind `responseId`.
6. For PDFs:
   - route through adaptive PDF handling described below.

`brightdata_fetch` is intentionally not a domain-specific workflow tool. It does not clone GitHub repos, run `yt-dlp`, call Whisper, or analyze video. Those belong in skills or separate tools.

## Adaptive PDF handling

PDF handling stays in scope because a PDF URL is still a web document fetch.

Detection:

- URL path ending in `.pdf`; or
- target response `Content-Type` containing `application/pdf`.

Fetch strategy:

1. If the URL path ends in `.pdf`, attempt a direct PDF byte fetch first, because this avoids spending Bright Data quota for ordinary public PDFs.
2. For URLs that do not end in `.pdf`, perform a lightweight direct `HEAD` request when possible; if it reports `application/pdf`, route to PDF extraction.
3. If direct PDF fetch fails, times out, returns a blocking status, or does not return a PDF, retry through Bright Data Unlocker using raw PDF bytes rather than Markdown transformation.
4. Enforce `pdf.max_bytes` before parsing.
5. Extract text with a PDF parser such as `unpdf`.
6. Extract metadata when available: title, author, page count.
7. Convert extracted pages into Markdown with source metadata and page markers.
8. Extract up to `pdf.max_pages`; mark truncation clearly if the document has more pages.

Inline-vs-file rule:

Return the full extracted Markdown inline only when both are true:

- extracted page count is `<= pdf.inline_max_pages`; and
- extracted Markdown length is `<= pdf.inline_max_chars`.

Otherwise:

- save full extracted Markdown to `pdf.output_dir`;
- return title, URL, page count, extracted character count, truncation status, saved path, and a preview of `pdf.preview_chars`;
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

The extension keeps an in-memory map of `responseId -> result data` during a session and also persists compact metadata through Pi session entries. After reload/resume, `brightdata_get_content` can restore entries that either fit in the session metadata or point to saved Markdown files on disk. Large unsaved inline-only content is not guaranteed to survive reload; the tool response must say when content is stored only in memory.

Stored entries include:

- provider: `brightdata`;
- tool name;
- timestamp;
- normalized search results or fetch metadata;
- saved file paths for large PDFs;
- enough metadata to render useful summaries.

Large page/PDF content is not duplicated into session entries if it has been saved to disk. Session entries store the path and metadata instead.

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
- Missing zone config returns an actionable error naming `brightdata.serp_zone` or `brightdata.unlocker_zone` in `config.toml`.
- Bad TOML reports the config path and parser message.
- Invalid URLs are rejected before any Bright Data request.
- Local/private URLs are rejected before any Bright Data request.
- Tool aborts propagate to Bright Data requests and PDF parsing where possible.
- Quota/rate-limit failures are surfaced clearly and do not trigger large retry loops.
- Outputs are truncated and disclose truncation clearly.
- API keys are never printed.

## Testing strategy

Unit tests use `node:test` and mocked `fetch`/fixtures.

Coverage:

1. Config loading:
   - valid TOML;
   - defaults;
   - malformed TOML;
   - `BRIGHT_DATA_KEY` and `BRIGHTDATA_API_KEY` precedence.
2. SERP normalization:
   - organic results;
   - alternate Bright Data response shapes;
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
6. User-level config file support if the extension is published as an npm package and editing package-local TOML becomes inconvenient.
