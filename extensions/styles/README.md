# styles

claude.ai-style **output styles** for Pi. An active style is injected
*ephemerally* into every model request as a trailing `<userStyle>…</userStyle>`
block — it never persists to the session, never accumulates, and is added at
the provider payload layer immediately before the request is sent.

## Usage

- `/style` — open a picker: choose a style, choose **Auto**, choose **None**, or
  **Create new style…**.
- `/style <name>` — activate a style directly by name.
- `/style auto` — choose a style from `styles/_config.json` by exact current
  model ID on each request.
- `/style off` — turn styling off (`off` / `none` / `clear` all work).

Footer states:

- no footer item: styles are off;
- `style: <name>`: manual style mode;
- `style: auto`: auto mode is active, but the last request did not resolve a
  style yet or did not match a style;
- `style: <name> (auto)`: auto mode resolved `<name>` for the last request.

The footer reports the selected/resolved style name. If a style file exists but
is empty after trimming, the footer may still show that style while injection
no-ops.

## Simple styles

A simple style is a top-level Markdown file:

```text
styles/
  concise.md
```

The filename minus `.md` is the style name. Editing a style file is picked up on
the next request after the file mtime changes.

## Model-ID variant styles

A variant style is a folder with `default.md` plus optional exact model-ID files:

```text
styles/
  thought-catalyst/
    default.md
    claude-haiku-4-5.md
    claude-sonnet-4-5.md
    claude-sonnet-4-6.md
```

When the active style is `thought-catalyst`, the extension reads:

1. `styles/thought-catalyst/<ctx.model.id>.md` when the model ID is safe as a
   filename and that file exists;
2. otherwise `styles/thought-catalyst/default.md`.

`default.md` is required. A folder without `default.md` is not shown in the
picker and injects nothing if referenced by session state or config.

Variant lookup is exact filename lookup. There are no regexes, globs, template
variables, or router rules. Model IDs containing `/`, `\\`, `:`, whitespace, or a
leading `.` cannot be used as variant filenames and fall back to `default.md`.
They can still be matched in `_config.json` auto rules.

If both `foo.md` and `foo/default.md` exist, `foo.md` wins and the picker lists
`foo` once.

## Auto mode

Auto mode is explicit and sticky:

```text
/style auto
```

Auto mode reads optional JSON config from:

```text
styles/_config.json
```

Bundled example:

```json
{
  "auto": [
    {
      "model": [
        "claude-haiku-4-5",
        "claude-sonnet-4-5",
        "claude-sonnet-4-6",
        "claude-opus-4-5",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8"
      ],
      "style": "thought-catalyst"
    }
  ]
}
```

The bundled `thought-catalyst` style demonstrates variants: `default.md` uses
`<think>` terminology, while each listed Anthropic model ID has an exact
same-named `.md` variant using `<thinking>` terminology.

Rules are evaluated in order. `model` is either a string or an array of strings.
Matching is exact against `ctx.model.id`. The first matching rule whose `style`
exists wins. A `style` value is a style name, not a path.

## Reserved command words

The direct command arguments `auto`, `off`, `none`, and `clear` are reserved.
For example, `/style auto` always enables auto mode, even if `styles/auto.md`
exists. The picker labels reserved style names distinctly.

`Create new style…` creates a simple top-level `.md` file. If the requested name
slugifies to a reserved command word, the extension creates `<word>-style.md`
instead.

## How injection works

Injection happens in `before_provider_request` — after Pi serializes the payload
and assigns provider-specific cache metadata. The resolved style text is spliced
in after cache breakpoints where the provider format exposes them, so style
changes do not invalidate cached conversation prefixes.

Dispatch is keyed on `model.api`, so switching models mid-session is handled at
request time:

| `model.api` | strategy |
| --- | --- |
| `anthropic-messages` | append text block to last user message, after its cache_control block |
| `openai-responses` (gpt-5.x / codex) | append trailing user input item |
| `openai-completions` | append text part after the last user text part |

Unhandled apis get a best-effort generic splice plus a one-time warning. See
[`./injectors.ts`](./injectors.ts) to add a provider.

## Debugging

Set `PI_STYLES_DEBUG=1` to log the chosen api, style name, resolved file path,
and injection outcome to stderr. Verify caching by watching `cacheRead` /
`cacheWrite` in usage across two turns on both an Anthropic and a Codex model.
