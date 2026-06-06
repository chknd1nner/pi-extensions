# Styles Model-ID Variants — Design

**Status:** Draft for review
**Date:** 2026-06-06
**Extension:** `extensions/styles/`
**Supersedes:**

- `docs/superpowers/specs/archive/2026-06-05-styles-auto-switch-design.md`
- `docs/superpowers/plans/archive/2026-06-05-styles-auto-switch-impl.md`
- `docs/superpowers/specs/archive/2026-06-05-styles-model-aware-auto-design.md`

## Goal

Add model-aware style variants without reintroducing the old dispatcher/router complexity.

The extension should support:

1. **Simple styles** as single Markdown files, unchanged from today.
2. **Model-ID variant styles** as folders containing `default.md` plus optional exact `<modelID>.md` files.
3. **Sticky style modes**: `/style off`, `/style <name>`, and `/style auto`.
4. A small JSON config file that maps exact model IDs to style names for auto mode.

The core simplification: model-aware content selection is filename lookup, not rule evaluation.

## Non-goals

- No `dispatcher.json`.
- No regex, glob, or matcher language for style variants.
- No preamble/common-file composition.
- No variant routing parser.
- No manual-override state machine.
- No template variables inside style files.
- No changes to `injectors.ts` beyond receiving the final resolved style text as it does today.

## Style layout

Styles live under `extensions/styles/styles/`.

### Simple style

```text
styles/
  concise.md
```

`concise.md` is read directly when the active style is `concise`.

### Model-ID variant style

```text
styles/
  thought-catalyst/
    default.md
    claude-haiku-4-5.md
    claude-sonnet-4-5.md
    claude-sonnet-4-6.md
```

When the active style is `thought-catalyst`:

1. Read `styles/thought-catalyst/<ctx.model.id>.md` if it exists and the model ID is safe as a filename.
2. Otherwise read `styles/thought-catalyst/default.md`.
3. If `default.md` does not exist, inject nothing and emit a one-time warning.

`default.md` is required for a variant folder to be valid. A folder that contains only `<modelID>.md` files is ignored by the picker and warns/no-ops if referenced directly.

This lets one user-facing style name present multiple model-specific versions while keeping routing obvious from the filesystem.

### Style enumeration

The `/style` picker lists:

- top-level `*.md` files as simple styles;
- top-level directories that contain `default.md` as variant styles.

Top-level files beginning with `_`, such as `_config.json`, are ignored. Directories without `default.md` are ignored by the picker.

Enumeration is deduplicated by style name. If both `foo.md` and `foo/default.md` exist:

- list `foo` once;
- use `foo.md` as the winning style;
- emit a one-time collision warning keyed by `foo`.

The collision warning cannot rely on resolution alone, because simple-file resolution would otherwise return before checking whether the folder also exists.

### Reserved command words

The command words `auto`, `off`, `none`, and `clear` are reserved for `/style` arguments.

- `/style auto` always means auto mode.
- `/style off`, `/style none`, and `/style clear` always turn styles off.
- `Create new style…` should reject or rename these style names.
- If a user already has a style file or folder with a reserved name, the picker may still expose it, but it must label the entry distinctly from the command action and emit a one-time warning. Direct `/style <reserved-word>` cannot select that style.

## Variant filename rules

Variant files are exact model-ID files:

```text
<modelID>.md
```

The lookup uses `ctx.model.id` exactly, but only when the full model ID is safe as one filename segment.

The safe-basename predicate is:

```ts
function isSafeVariantBasename(modelId: string): boolean {
  return (
    /^[A-Za-z0-9_.-]+$/.test(modelId) &&
    modelId !== "." &&
    modelId !== ".." &&
    !modelId.startsWith(".")
  );
}
```

Important details:

- The regex is whole-string anchored.
- Partial matches are not allowed.
- `/`, `\`, `:`, whitespace, leading `.`, `.`, and `..` are unsafe.
- Unsafe model IDs skip variant lookup and fall back to `default.md`.

No warning is needed for this fallback; `default.md` is the intended universal fallback.

Model IDs that are not safe filenames, such as OpenRouter-style `vendor/model` IDs or Ollama-style `model:tag` IDs, can still be matched in `_config.json`. They just cannot have direct per-model variant filenames unless a future escaping scheme is added.

## Modes

The active selection is always one of three sticky modes.

| Mode | Command | Meaning | Persisted as |
| --- | --- | --- | --- |
| Off | `/style off` | Inject nothing. Sticky until changed. | `{ "name": null }` |
| Style | `/style <name>` | Use that style on every request. If the style is a variant folder, its content can still vary by model ID. | `{ "name": "<name>" }` |
| Auto | `/style auto` | Use `_config.json` to choose a style from the current model ID on each request. | `{ "auto": true }` |

Default mode is **off**. Auto is explicit opt-in.

All three modes are sticky. Switching models never silently changes the mode. In auto mode, the resolved style name can change per request, but the mode remains auto.

## Auto config

The config file is:

```text
styles/_config.json
```

JSON is used because Node can parse it without additional dependencies. The leading underscore marks the file as control/configuration rather than a style and keeps it visually near the top of directory listings.

### Shape

```json
{
  "auto": [
    {
      "model": ["claude-sonnet-4-5", "claude-haiku-4-5"],
      "style": "thought-catalyst"
    },
    {
      "model": ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"],
      "style": "concise"
    },
    {
      "model": "gemini-3-pro",
      "style": "research"
    }
  ]
}
```

### Semantics

- `_config.json` is optional.
- `auto` is an ordered array of rules.
- `model` may be:
  - a string: exact model ID match;
  - an array of strings: match any listed model ID.
- `style` is a style name, not a path. It must name either:
  - a simple style: `styles/<style>.md`; or
  - a variant style: `styles/<style>/default.md`.
- Rules are evaluated in order.
- The first rule whose `model` contains the current `ctx.model.id` and whose `style` exists wins.
- If a matching rule names a missing/invalid style, emit a one-time warning and continue to the next rule.
- No regex or glob syntax is supported.

Style names from config must be treated as basenames. They must not contain `/`, `\`, an extension suffix, or a leading `_`. Never join a config `style` value as an arbitrary path.

## Bundled example assets

The extension should ship a self-demonstrating variant-folder example rather than keeping `thought-catalyst` as a simple top-level `.md` file:

```text
styles/
  _config.json
  concise.md
  thought-catalyst/
    default.md
    claude-haiku-4-5.md
    claude-sonnet-4-5.md
    claude-sonnet-4-6.md
    claude-opus-4-5.md
    claude-opus-4-6.md
    claude-opus-4-7.md
    claude-opus-4-8.md
```

`thought-catalyst/default.md` should use `<think>` terminology. Each exact Anthropic model-ID variant file should use the same thought-catalyst instructions with `<antml:thinking>` terminology.

Because v1 intentionally has no alias, symlink, or router layer, the repeated Anthropic variant content is duplicated into each exact model-ID filename.

The bundled `styles/_config.json` should map all of these exact Anthropic model IDs to the `thought-catalyst` style:

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

Auto mode remains explicit opt-in, so shipping `_config.json` does not activate styles by default.

## Resolution flow

On `before_provider_request`:

1. Read `ctx.model.id` and `ctx.model.api` defensively.
2. Resolve the active style name:
   - off mode → no style;
   - style mode → persisted/manual style name;
   - auto mode → resolve style name through `_config.json` and current model ID.
3. Resolve style content:
   - validate that the style name is a top-level basename, not a path;
   - check both `styles/<name>.md` and `styles/<name>/default.md` so collisions can warn;
   - if both exist, warn once and read `styles/<name>.md`;
   - else if `styles/<name>.md` exists, read it;
   - else if `styles/<name>/default.md` exists:
     - if `ctx.model.id` passes `isSafeVariantBasename()` and `styles/<name>/<modelID>.md` exists, read that file;
     - otherwise read `styles/<name>/default.md`;
   - else no-op with a one-time warning.
4. Trim the content.
5. If empty, inject nothing.
6. Wrap as:

   ```xml
   <userStyle>
   ...
   </userStyle>
   ```

7. Pass the wrapped text to the existing provider injector selected from `INJECTORS[ctx.model.api]`.
8. In auto mode, update the footer and last-resolved notification state from the style name resolved in this request.

The injection layer remains provider-specific and unchanged. Variant resolution happens entirely before injection.

## Examples

### Manual style with model-specific variants

```text
styles/
  thought-catalyst/
    default.md
    claude-sonnet-4-5.md
    gpt-5.4.md
```

User runs:

```text
/style thought-catalyst
```

Then:

- on `claude-sonnet-4-5`, Pi injects `thought-catalyst/claude-sonnet-4-5.md`;
- on `gpt-5.4`, Pi injects `thought-catalyst/gpt-5.4.md`;
- on any other model ID, Pi injects `thought-catalyst/default.md`.

The selected style remains `thought-catalyst`; only the content variant changes.

### Auto mode choosing between styles

```text
styles/
  _config.json
  concise.md
  thought-catalyst/
    default.md
    claude-sonnet-4-5.md
    gpt-5.4.md
```

```json
{
  "auto": [
    {
      "model": ["claude-sonnet-4-5", "claude-haiku-4-5"],
      "style": "thought-catalyst"
    },
    {
      "model": ["gpt-5.4", "gpt-5.4-mini"],
      "style": "concise"
    }
  ]
}
```

User runs:

```text
/style auto
```

Then:

- on `claude-sonnet-4-5`, auto resolves style `thought-catalyst`, then variant resolution picks `thought-catalyst/claude-sonnet-4-5.md`;
- on `claude-haiku-4-5`, auto resolves style `thought-catalyst`, then variant resolution falls back to `thought-catalyst/default.md` unless `claude-haiku-4-5.md` exists;
- on `gpt-5.4`, auto resolves style `concise`, then injects `concise.md`.

## UX

### `/style`

The picker shows:

- all simple styles;
- all variant-folder styles;
- `Auto`;
- `None (turn off styles)`;
- `Create new style…`.

The current mode is marked with `✓`.

For v1, `Create new style…` creates a simple top-level `.md` style, as today. Users can manually convert a style to a variant folder by creating `<name>/default.md` and optional `<modelID>.md` files.

### `/style <name>`

Activates a simple or variant-folder style manually, except for reserved command words.

Manual style mode is sticky across model changes. If the style is a variant folder, content still resolves by current model ID on each request.

### `/style auto`

Activates auto mode.

Auto mode is sticky across model changes and session resumes. The resolved style name is recomputed per request from `_config.json` and current model ID.

Immediately after selecting auto mode, before any request has resolved a style, the footer should still confirm that auto mode is active.

### `/style off`

Turns styling off.

Off mode is sticky across model changes and session resumes.

## Footer and notifications

Footer:

- off → no style status;
- manual style → `style: <name>`;
- auto mode with no resolved style yet → `style: auto`;
- auto mode with no matching style for the last request → `style: auto`;
- auto mode with resolved style → `style: <name> (auto)`.

Auto resolution is driven from `before_provider_request`, because the current model ID is needed there. The footer therefore reflects the last auto resolution performed by the extension process. On explicit `/style auto` and on session restore into auto mode, show `style: auto` immediately so auto mode is distinguishable from off even before a request occurs.

Notifications:

- `/style auto` emits an info notification that auto mode is active.
- Auto mode emits an info notification when the resolved style name changes to a non-null value.
- Repeated requests with the same resolved style do not re-notify.
- Variant-file changes within the same style do not need separate notifications.
- Diagnostics use one-time warning notifications keyed by stable warning IDs.

Warning and notification state is in-memory per extension process. It resets on Pi reload/process restart and is not persisted into the session.

## Persistence

The session entry remains `customType === "styles:active"`.

Supported data shapes:

| Entry data | Restored mode |
| --- | --- |
| `{ "name": "<name>" }` | Manual style mode |
| `{ "name": null }` | Off mode |
| `{ "auto": true }` | Auto mode |
| no entry | Off mode |

Auto resolution results are not persisted. They are derived from `_config.json` and the current model ID on each request.

On `session_start`, restore the mode first and do not clear a manual style merely because `styles/<name>.md` is absent. A valid manual style may be either `styles/<name>.md` or `styles/<name>/default.md`. Prefer deferring missing-style validation to resolution time so restored missing styles can produce the normal one-time warning/no-op behavior.

## Caching

Use small mtime-keyed caches:

1. `_config.json` parse result, keyed by the config file path and mtime.
2. Style content files, keyed by the resolved absolute Markdown file path and mtime.
3. Directory/style existence checks if useful, keyed by the checked absolute path and mtime or stat result.

Do **not** key style content only by style name. Variant folders can resolve the same style name to different files for different models, such as `thought-catalyst/claude-sonnet-4-5.md` and `thought-catalyst/default.md`.

Warm path should be cheap: a few `statSync` checks and in-memory lookups.

Manual edits to `.md` files or `_config.json` should take effect on the next request after mtime changes.

## Validation and warnings

One-time warnings should cover:

- malformed `_config.json`;
- `_config.json` present but missing an `auto` array;
- auto rule with invalid `model` shape;
- auto rule with non-string entries in a `model` array;
- auto rule with invalid `style` name;
- auto rule naming a missing style;
- selected manual style missing;
- variant style folder missing `default.md`;
- simple/folder collision such as both `foo.md` and `foo/default.md`;
- reserved command word used as a style filename or folder name.

Invalid rules are skipped. The rest of the config remains active.

Warnings are one-time per process, not persisted. Use stable warning IDs, for example `config:parse`, `config:rule:<index>`, `style:missing:<name>`, `style:collision:<name>`, and `style:reserved:<name>`.

## Backwards compatibility

- Existing `styles/*.md` files continue to work unchanged, except that reserved command words remain command words for direct `/style <word>` activation.
- Existing `{ "name": "<style>" }` and `{ "name": null }` session entries restore as before.
- A fresh session still starts with styles off.
- Users without `_config.json` or variant folders see no behavior change.
- `injectors.ts` remains unchanged.
- The README/user docs must be updated because the current docs say every top-level `.md` file is a style and do not mention folders, `_config.json`, auto mode, or the `(auto)` footer suffix.

## Known limitations

- Matching is exact-only. Aliased model IDs such as `claude-sonnet-4-5`, dated provider IDs, and proxy-specific IDs must be listed explicitly in `_config.json` or handled through `default.md`.
- Model IDs that are unsafe as filenames can route to a style through `_config.json`, but they cannot select a direct `<modelID>.md` variant file.
- Variant folders require `default.md`; otherwise even a matching `<modelID>.md` is ignored.
- The extension does not attempt to infer model families such as “all Claude models” or “all GPT models.” Users can duplicate entries, use model arrays in `_config.json`, or duplicate/symlink files if they want shared behavior.

## Edge cases

| Case | Behavior |
| --- | --- |
| `_config.json` absent | Auto mode resolves no style. Footer shows `style: auto`. No warning. |
| `_config.json` present but missing `auto` | Warn once. Auto mode resolves no style. |
| Auto rule model array is empty | Rule never matches. No warning needed unless shape is invalid. |
| Auto rule matches but style is missing | Warn once, continue to next rule. |
| Multiple auto rules match | First resolvable match wins. |
| Manual style is a simple `.md` file | Read that file directly. No variant lookup. |
| Manual style is a folder with `default.md` | Use exact `<modelID>.md` when present and safe, otherwise `default.md`. |
| Folder has variant file but no `default.md` | Not listed in picker; if selected/restored/referenced, warn and no-op. |
| Both `foo.md` and `foo/default.md` exist | `foo.md` wins; picker lists `foo` once; warn once. |
| Model ID is unsafe as a filename | Skip variant lookup and use `default.md`. |
| Config `model` contains unsafe filename characters | Exact config matching still works; only variant filename lookup is affected. |
| Style file is empty after trim | No injection. In auto mode, the footer may still show the resolved style name because footer state represents style selection, not guaranteed payload mutation. |
| `_config.json` edited mid-session | New config applies on the next request in auto mode. |
| Variant `.md` edited mid-session | New content applies on the next request. |
| Auto maps two models to same style folder | Style name stays the same; variant content may still change by model ID. No extra notification required. |
| `/style auto` before any request | Footer shows `style: auto`; no style is injected until a request resolves a matching style. |
| Style named `auto` exists | `/style auto` selects auto mode; picker/config handling must disambiguate or warn. |

## Testing strategy

Unit tests should cover:

- config parsing for string and array `model` values;
- exact matching only;
- first resolvable auto rule wins;
- invalid JSON and invalid config shapes produce warnings and do not crash;
- empty model arrays are accepted as never-matching rules without warning;
- simple style resolution;
- variant folder exact model-ID resolution;
- fallback to `default.md`;
- safe-basename predicate rejects partial matches, `/`, `\`, `:`, leading `.`, `.`, and `..`;
- unsafe model ID fallback to `default.md`;
- config can match model IDs that are unsafe as variant filenames;
- collision behavior where `foo.md` and `foo/default.md` both exist, including picker dedup;
- reserved command word behavior for `auto`, `off`, `none`, and `clear`;
- invalid non-basename style names warn and no-op;
- mode restoration from all persisted entry shapes;
- restored manual folder styles are not dropped just because `<name>.md` is absent;
- sticky behavior of off/style/auto modes;
- interactive `/style` picker selection, including the displayed-label mapping and current-mode checkmark;
- auto footer behavior before first request, after resolved style, and after no-match resolution;
- content cache is keyed by resolved file path, not just style name;
- payload mutation through existing injectors for at least Anthropic Messages and OpenAI Responses;
- bundled `thought-catalyst` variant files and `_config.json` sample stay consistent with the documented Anthropic model ID list.

## Implementation traps to avoid

1. Do not implement the safe filename check as an unanchored regex. It must validate the whole model ID.
2. Do not keep the current `session_start` check that only accepts `styles/<name>.md`; that would silently drop restored variant-folder styles.
3. Do not cache style content by style name only; cache by resolved file path and mtime.
4. Do not let simple-file resolution skip the collision warning for an existing same-named variant folder.
5. Do not let auto mode look identical to off in the footer before the first request.
6. Do not treat `_config.json` `style` values as arbitrary paths.

## Review decisions

The v1 design intentionally chooses the simpler option for three UX details:

1. Variant folders without `default.md` are hidden from the picker. If referenced directly by session state or `_config.json`, they warn and no-op.
2. The footer shows only the style name, not the variant filename. Example: `style: thought-catalyst`, not `style: thought-catalyst/gpt-5.4`.
3. `Create new style…` remains simple-file-only. Users can manually create variant folders; a guided variant-folder creator can be added later if needed.
