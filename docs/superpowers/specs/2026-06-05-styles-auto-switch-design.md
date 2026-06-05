# Styles Auto-Switch — Design

**Status:** Draft for review
**Date:** 2026-06-05
**Extension:** `extensions/styles/`
**Supersedes:** [`archive/2026-06-05-styles-model-aware-auto-design.md`](./archive/2026-06-05-styles-model-aware-auto-design.md) (over-engineered — added a per-style dispatcher/variant file format and a manual-override state machine; both dropped here)

## The actual itch

Switching models mid-session means re-running `/style <name>` every time. That's
the whole problem. The fix is a single mapping from model ID to style name,
applied automatically. Nothing more.

## What this is NOT

The superseded design grew two layers of accidental complexity. Both are gone:

- **No dispatcher / variant files.** Style `.md` files stay 100% opaque prose —
  never parsed for embedded routing markup, never at risk of an unescaped
  delimiter breaking resolution. "A variant for Claude vs GPT" is expressed as
  *two ordinary style files plus two auto rules*, not a folder with a JSON
  router. There is no new on-disk format for styles.
- **No manual-override state machine.** No `manualOverride` flag, no
  `lastModelId`, no `modelChanged` predicate, no override-lifting on model
  change. Manual selection is **sticky** — exactly as it already is today. The
  only new state is one nullable string used to de-dupe notifications.

## Mental model: three modes

The active selection is always exactly one of:

| Mode | Meaning | Persisted as |
| --- | --- | --- |
| **style** `<name>` | A specific style, applied to every request regardless of model. Sticky until the user changes it. (Today's only behaviour.) | `{ name: "<name>" }` |
| **off** | No style injected. Sticky. | `{ name: null }` |
| **auto** | Follow `_config.json`: on each request, map the current model ID to a style. | `{ auto: true }` |

**Default mode is `off`.** Auto is a conscious opt-in: a user enables it with
`/style auto` (or the picker) *after* authoring a `_config.json`. This keeps the
default behaviour identical to today — a fresh session with no prior selection
injects nothing — and avoids surprising a user who merely drops a `_config.json`
into the styles directory with styles they never asked the extension to start
applying.

**All three modes are sticky**, including `auto`: once chosen, a mode persists
across model changes and session resumes until the user picks again. There is no
silent reversion in any direction. "Sticky" is the entire state model — `auto`
is just a third value the selection can hold, and like the other two it only
changes when the user changes it. (Within `auto`, the *resolved style* tracks the
model; the *mode* stays `auto`.)

## Auto-config: `styles/_config.json`

A single optional file at the root of the styles directory:

```json
{
  "auto": [
    { "match": "claude-haiku-4-5", "style": "concise" },
    { "match": "/^claude-/",       "style": "thought-catalyst-claude" },
    { "match": "/^gpt-/i",         "style": "thought-catalyst-gpt" }
  ]
}
```

- `auto` — ordered array of `{ match, style }` rules. **First resolvable match
  wins** (a rule naming a missing style is skipped with a one-time warning, and
  evaluation continues).
- The file is optional. Absent → auto resolves to nothing, identical to today.
- The leading underscore keeps it out of the `/style` picker (which lists
  `*.md`) and out of completion.

### Worked example (the "variants" use case, done simply)

```
styles/
  _config.json
  concise.md
  thought-catalyst-claude.md
  thought-catalyst-gpt.md
```

```json
{
  "auto": [
    { "match": "/^claude-/", "style": "thought-catalyst-claude" },
    { "match": "/^gpt-/",    "style": "thought-catalyst-gpt" }
  ]
}
```

Switch from a Claude model to a GPT model → the active style follows
automatically. No per-style router, no folders, no parsing of `.md` content.

## The matching primitive

`match` is a string with one of two interpretations:

- **Plain string** (`"claude-haiku-4-5"`) → exact equality on the model ID.
  **Case-sensitive.**
- **Slash-delimited regex** (`"/^claude-/"`, `"/gpt-5/i"`) → `new RegExp(pattern,
  flags)` tested against the model ID. A string is treated as regex iff it
  matches `/^\/(.+)\/([A-Za-z]*)$/`.

**Allowed regex flags: `i`, `m`, `s`, `u` only.** `g` and `y` are rejected —
`RegExp.test()` with them mutates `lastIndex`, making the matcher stateful. A
rule with disallowed flags, an invalid pattern, or an invalid `style` name is
skipped with a one-time warning; the rest of the config stays active.

**Style-name validation:** `style` must match
`/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/` (no slashes, no leading dot, no `..`). This
is the only guard needed against a malformed config escaping the styles
directory via `path.join`.

(Both behaviours are carried over verbatim from the superseded design's
`compileMatcher` and `validateStyleName` — they were the genuinely good parts.)

## Resolution (per request)

```
On before_provider_request:
  switch (mode):
    case off:            inject nothing.
    case style(name):    read styles/<name>.md, trim, wrap in <userStyle>, inject.
                         (unchanged from today, incl. empty-file = no-op)
    case auto:
      modelId := ctx.model?.id
      if modelId is undefined: inject nothing.
      else:
        for rule in loadAutoConfig(stylesDir).rules:       // mtime-cached
          if rule.matcher.test(modelId):
            if styleFileExists(rule.style): chosen := rule.style; break
            else: warn-once(auto:missing:<style>); continue
        if chosen: read styles/<chosen>.md, trim, wrap, inject.
        else: inject nothing.
```

Injection itself is **unchanged**: the wrapped `<userStyle>` block is handed to
`INJECTORS[ctx.model.api]` exactly as today. `injectors.ts` is untouched.

### Notification & footer

A single nullable `lastInjectedName` de-dupes the auto notification:

- After resolving, if `mode === auto` and the chosen style name differs from
  `lastInjectedName` and is non-null → `ctx.ui.notify("Auto-applied style
  '<name>' for model '<modelId>'.", "info")`. Then set `lastInjectedName`.
- Footer (`ctx.ui.setStatus("style", …)`):
  - `style: <name>` for a manual style.
  - `style: <name> (auto)` when auto resolved to `<name>`.
  - cleared for `off`, or for `auto` that resolved to nothing.

That `lastInjectedName` field is the *entire* state machine. No model-change
detection, no transition predicates.

## Session persistence

The `styles:active` entry shape extends additively:

| Entry data | Restored mode |
| --- | --- |
| `{ name: "<name>" }` | style `<name>` (as today) |
| `{ name: null }` | off (as today) |
| `{ auto: true }` | auto |
| *(no entry in history)* | off (default) |

On `session_start`, scan the branch for the latest `styles:active` entry and set
the mode accordingly; clear `lastInjectedName`. Old sessions persisted before
this change carry only `{ name }` shapes and restore exactly as they did before.

A single writer (`setMode`) persists every user-initiated change via
`pi.appendEntry(ACTIVE_ENTRY, data)` — the existing mechanism. Auto resolution
results are **never** persisted; they are recomputed each request from
`_config.json` + current model.

## Commands / UX

| Surface | Behaviour |
| --- | --- |
| `/style` (picker) | Lists simple `.md` styles, plus **Auto**, **None (off)**, **Create new style…**. The current mode's row is marked `✓` (the resolved style name when in auto). |
| `/style <name>` | Switch to manual style. Sticky. |
| `/style off` / `none` / `clear` | Switch to off. Sticky. |
| `/style auto` | Switch to auto (follow `_config.json`). |
| completions | style names + `auto` + `off`. |

## Caching

One mtime-keyed cache for the parsed+compiled `_config.json`, plus the existing
mtime cache for style file contents. A warm-cache request walks the in-memory
rules and does a couple of `statSync` calls — negligible.

## Backwards compatibility

- Every existing `.md` style works unchanged.
- Existing `{ name }` / `{ name: null }` session entries restore identically.
- A fresh session with no prior selection defaults to **off** — zero behavioural
  difference from today. A `_config.json` only takes effect once the user opts
  into `auto`.
- `injectors.ts` is unchanged.

## Module structure

```
extensions/styles/
  index.ts          # CHANGED: mode state (style|off|auto), setMode, picker, footer/notify, injection dispatch
  auto-config.ts    # NEW: compileMatcher, validateStyleName, loadAutoConfig, resolveAuto — ctx-free, unit-tested
  injectors.ts      # UNCHANGED
  styles/
    _config.json    # optional, user-authored
    *.md            # styles, as today
```

`auto-config.ts` is ctx-free and UI-free: it reads `_config.json` (mtime-cached)
and returns `{ style: string | null, warnings: Warning[] }`. `index.ts` owns
mode state, persistence, the footer/notification, and dispatch through the
existing `INJECTORS` table.

## Edge cases

| Case | Behaviour |
| --- | --- |
| No `_config.json` | auto resolves to nothing; no warnings; identical to today. |
| `_config.json` rule names a missing style | one-time warning (`auto:missing:<name>`), skipped; next rule evaluated. |
| `_config.json` rule has invalid regex / `g`/`y` flag | one-time warning (`auto:badmatch:<spec>`), skipped; rest of config active. |
| `_config.json` rule has invalid `style` name | one-time warning (`auto:badname:<name>`), skipped. |
| Malformed JSON / wrong top-level shape | one-time warning (`auto:parse` / `auto:shape`); auto resolves to nothing. |
| `modelId` undefined in auto mode | inject nothing this request; no warning. |
| Manual style file missing | no injection; one-time warning (existing behaviour preserved). |
| Auto resolves to same style two requests running | no re-notification (`lastInjectedName` unchanged). |
| Auto resolves to a different style (model changed, or config edited) | notify once. |
| `/style off` then model change | off persists (sticky). No auto re-engagement. |
| `/style <name>` then model change | name persists (sticky). No auto re-engagement. |
| `_config.json` edited mid-session | mtime cache reloads; takes effect next request **in auto mode**. |
| Resume with `{ auto: true }` | auto mode; first matching request notifies. |
| Resume with `{ name }` / `{ name: null }` | manual / off, as today. |

## Out of scope

- Per-style content variation inside a single file (the thing that started the
  dispatcher spiral) — expressed instead as separate style files + auto rules.
- Template variables in style files.
- Glob match syntax (string + regex is enough).
- `/style validate` lint command — runtime warnings cover it; revisit only if
  authoring pain emerges.
