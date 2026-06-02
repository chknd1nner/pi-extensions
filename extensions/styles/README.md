# styles

claude.ai-style **output styles** for Pi. An active style is injected
*ephemerally* into every model request as a trailing `<userStyle>…</userStyle>`
block — it never persists to the session, never accumulates, and only ever
appears as the last thing the model sees.

## Usage

- `/style` — open a picker: choose a style, **Create new style…**, or turn off.
- `/style <name>` — activate a style directly (tab-completes).
- `/style off` — turn styling off (`off` / `none` / `clear` all work).

The active style shows in the footer (`style: <name>`).

## Styles are just files

Every `.md` file in [`./styles/`](./styles) is a style; the filename (minus
`.md`) is its name. Add one by dropping a file in — it shows up immediately.
Editing a file is picked up live (cached by mtime).

## How injection works

Injection happens in `before_provider_request` — *after* Pi serializes the
payload and assigns `cache_control`. The style is spliced in **after the last
cache breakpoint**, so it sits outside every cached prefix: it is never
cache-written and can change every turn without invalidating upstream cache.
This is why prompt-cache savings are preserved (same approach as claude.ai).

Dispatch is keyed on `model.api`, so switching models mid-session is handled
automatically:

| `model.api` | strategy |
| --- | --- |
| `anthropic-messages` | append text block to last user message, after its cache_control block |
| `openai-responses` (gpt-5.x / codex) | append trailing user input item (automatic prefix caching) |
| `openai-completions` | append text part after the last user text part (handles anthropic-format cache_control) |

Unhandled apis get a best-effort generic splice plus a one-time warning. See
[`./injectors.ts`](./injectors.ts) to add a provider — including the
Bedrock/Vertex TODO for Claude on those transports.

## Debugging

Set `PI_STYLES_DEBUG=1` to log (to stderr) the chosen api/handler and injection
outcome per request. Verify caching by watching `cacheRead` / `cacheWrite` in
usage across two turns on both an Anthropic and a Codex model.
