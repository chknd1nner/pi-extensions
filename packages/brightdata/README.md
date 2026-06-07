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
