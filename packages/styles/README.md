# styles

**Output styles** for Pi. An active style is injected *ephemerally* into every
model request as trailing user-role content — it never persists to the session,
never accumulates, and is added at the provider payload layer immediately before
the request is sent.

The extension injects the trimmed contents of your style file exactly as written.
If you want XML-like tags, Markdown headings, bullets, or plain prose, put that
structure in the style file yourself.

## Usage

- `/style` — open a picker: choose a style, choose **Auto**, choose **None**, or
  **Create new style…**.
- `/style <name>` — activate a style directly by name.
- `/style auto` — choose a style from `_config.json` by exact current
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

## Where styles live

Styles are discovered in two scopes, project first, then home:

```text
<cwd>/.pi/styles/              — project (commit alongside the repo)
~/.pi/agent/styles/            — home (your personal styles, available everywhere)
```

Project entries shadow home entries of the same name. The extension ships **no**
styles — user content lives outside the extension package so installing or
upgrading the extension never touches anything you created. `Create new style…`
always writes to the project dir; the picker shows a `(project)` / `(home)` tag
on each entry when both scopes are populated.

## Simple styles

A simple style is a top-level Markdown file inside a styles root:

```text
~/.pi/agent/styles/
  concise.md
```

The filename minus `.md` is the style name. Editing a style file is picked up on
the next request after the file mtime changes.

## Model-ID variant styles

A variant style is a folder with `default.md` plus optional exact model-ID files:

```text
~/.pi/agent/styles/
  thought-catalyst/
    default.md
    claude-haiku-4-5.md
    claude-sonnet-4-5.md
    claude-sonnet-4-6.md
```

When the active style is `thought-catalyst`, the extension reads:

1. `<root>/thought-catalyst/<ctx.model.id>.md` when the model ID is safe as a
   filename and that file exists;
2. otherwise `<root>/thought-catalyst/default.md`.

Variant lookup stays inside the root that won the name — a project `default.md`
is never paired with a home variant file.

`default.md` is required. A folder without `default.md` is not shown in the
picker and injects nothing if referenced by session state or config.

Variant lookup is exact filename lookup. There are no regexes, globs, template
variables, or router rules. Model IDs containing `/`, `\\`, `:`, whitespace, or a
leading `.` cannot be used as variant filenames and fall back to `default.md`.
They can still be matched in `_config.json` auto rules.

If both `foo.md` and `foo/default.md` exist in the same root, `foo.md` wins and
the picker lists `foo` once (with a one-time warning).

## Auto mode

Auto mode is explicit and sticky:

```text
/style auto
```

Auto mode reads an optional `_config.json` from each styles root:

```text
<cwd>/.pi/styles/_config.json     — project rules
~/.pi/agent/styles/_config.json   — home rules
```

Example:

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

Rules are **concatenated** across roots in project-then-home order and
evaluated in that order. `model` is either a string or an array of strings.
Matching is exact against `ctx.model.id`. The first matching rule whose `style`
exists wins. The effect is intuitive layering: a project rule for a given model
overrides the home rule for that same model, but home rules for unrelated
models still apply — you don't have to restate your whole home config in every
repo. A `style` value is a style name, not a path; it may resolve to a style
file in either scope.

## Reserved command words

The direct command arguments `auto`, `off`, `none`, and `clear` are reserved.
For example, `/style auto` always enables auto mode, even if an `auto.md` style
exists. The picker labels reserved style names distinctly.

`Create new style…` creates a simple top-level `.md` file in the project dir.
If the requested name slugifies to a reserved command word, the extension
creates `<word>-style.md` instead.

## How injection works

Injection happens in `before_provider_request` — after Pi serializes the payload
and assigns provider-specific cache metadata. The resolved style text is spliced
in after cache breakpoints where the provider format exposes them, so style
changes do not invalidate cached conversation prefixes.

The style text is the style file's trimmed Markdown content. The extension does
not wrap it in tags or otherwise transform its structure.

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
