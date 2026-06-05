# Model-Aware Auto Styles — Design

**Status:** Draft for review
**Date:** 2026-06-05
**Extension:** `extensions/styles/`
**Related:** [`extensions/replace-prompt`](../../../extensions/replace-prompt/) (pattern reference for `modelId` matching)

## Goal

Extend the `styles` extension so that:

1. A single style can contain **multiple variants** tailored to different models (e.g. one variant for Claude, another for GPT-5), with automatic selection based on the current model.
2. A user-defined **auto-config** can map model IDs to styles, so switching models can automatically switch the active style — taking the burden of "remember to pick the right style" off the user.

Both layers must compose cleanly, preserve the existing prompt-caching guarantees, and remain fully backwards compatible with today's flat `<name>.md` style files.

## Non-Goals

- Template variable substitution inside style files (`{{thinkingTag}}` etc.). Considered and deferred — the dispatcher + variant-file approach makes this unnecessary for the cases we care about today. Can be added later as an additive feature if a real need emerges.
- Glob pattern syntax for matching. We support exact strings and regex; glob adds a third mental model without meaningful coverage gain.
- Changes to the injection layer (`injectors.ts`). Variant resolution happens entirely above injection; the injector still receives a plain content string and has no knowledge that variants exist.

## Current Architecture (Baseline)

```
extensions/styles/
  index.ts              # commands, session persistence, before_provider_request hook
  injectors.ts          # per-API payload mutation (anthropic-messages, openai-*, etc.)
  styles/
    concise.md
    thought-catalyst.md
    test-style.md
```

- The active style name is held in a closure variable `activeName` and persisted via a session entry of `customType === "styles:active"`.
- On `before_provider_request`, if `activeName` is set, the matching `.md` file is read, wrapped in `<userStyle>…</userStyle>`, and spliced into the payload by an api-specific injector selected from the `INJECTORS` registry.
- The api dispatch in `injectors.ts:105` is the **only** place `model.api` is consulted. This stays exactly as it is.

## Proposed Design

### 1. Two-tier style layout

Styles live at the top level of `extensions/styles/styles/` in one of two forms:

| Form | Shape | Use case |
| --- | --- | --- |
| **Simple style** | `<name>.md` (a single file) | One prompt, no model-aware variation. Identical to today's behaviour. |
| **Complex style** | `<name>/` (a directory containing `dispatcher.json` + one or more content `.md` files) | Multiple variants selected by model ID. |

The `/style` picker enumerates entries in the styles directory:

- `*.md` at the top level → simple style, display name = basename without `.md`
- Any subdirectory containing a `dispatcher.json` → complex style, display name = directory name
- Subdirectories without a `dispatcher.json` are ignored (malformed; one-time warning on first encounter)

This rule means there is never any ambiguity about which filesystem entries are user-facing styles.

### 2. Dispatcher format

A complex style's `dispatcher.json`:

```json
{
  "preamble": "_common.md",
  "default":  "default.md",
  "variants": [
    { "match": "/^claude-/",     "file": "anthropic.md"  },
    { "match": "/^gpt-5/",       "file": "openai.md"     },
    { "match": "gemini-2.5-pro", "file": "gemini-pro.md" }
  ]
}
```

Fields:

- `default` *(required)* — relative path to the fallback content file used when no variant matches.
- `variants` *(optional)* — ordered array of `{ match, file }` rules. **First match wins.** `match` uses the same string-or-regex convention as the auto-config (see §4). Absent or empty → behaves like a "single-variant style in a directory."
- `preamble` *(optional)* — relative path to a file whose contents are prepended to the selected variant's content (joined with a blank line). Use this for shared prose that applies to every variant, with per-model deltas in the variant files.

All paths are resolved relative to the dispatcher's own directory. Path traversal (`..`) is rejected — variant files must live inside the style's directory.

### 3. Auto-config format

A single `_config.json` lives at the root of the styles directory (`extensions/styles/styles/_config.json`):

```json
{
  "auto": [
    { "match": "claude-haiku-4-5", "style": "concise" },
    { "match": "/^claude-/",       "style": "thought-catalyst" },
    { "match": "/^gpt-5/i",        "style": "concise" },
    { "match": "/gemini.*pro/",    "style": "thought-catalyst" }
  ]
}
```

Fields:

- `auto` — ordered array of `{ match, style }` rules, **first match wins**. `style` is a style name resolvable as either a simple `.md` or a complex directory.

The leading underscore in `_config.json` keeps it out of the way of style filenames (and out of the `/style` picker — see §1 enumeration rule, which only considers `*.md` and directories containing a `dispatcher.json`).

The file is optional. If absent, no auto rules fire and the extension behaves as today plus dispatcher-based variants for any complex styles.

### 4. The matching primitive

Both the dispatcher's `variants[].match` and the auto-config's `auto[].match` use the same string convention:

- **Plain string** (e.g. `"claude-haiku-4-5"`) → exact equality on `modelId`.
- **Slash-delimited regex** (e.g. `"/^claude-/"`, `"/gpt-5/i"`) → parsed as `new RegExp(pattern, flags)` and matched with `.test(modelId)`. Detection rule: a `match` string is treated as regex iff it satisfies `/^\/(.+)\/([gimsuy]*)$/` (leading `/`, trailing `/` optionally followed by JS regex flags). Any other string is an exact match. This makes the boundary unambiguous even for the pathological case of a model whose literal ID happens to contain slashes.

This mirrors `replace-prompt`'s `string | RegExp` semantics in TS-land, serialized for JSON. Implementation: a single `compileMatcher(spec: string): (modelId: string) => boolean` helper, used in both layers.

Invalid regex → emit a one-time warning naming the offending rule, skip that rule, continue evaluating the rest.

### 5. Resolution algorithm

Responsibilities split cleanly between `index.ts` (stateful coordinator, owns side effects) and `resolver.ts` (pure function, no I/O of `ctx`).

**`index.ts` per-request flow (stateful):**

```
State held across requests:
  manualName            : string | null    // persisted via session entry
  manualOverride        : boolean          // user manually picked under current modelId
  lastModelId           : string | undefined
  lastResult            : ResolveOutput | null   // for diffing to detect auto-fire

On before_provider_request:
  1. modelChanged := (ctx.model.id !== lastModelId)
  2. If modelChanged: manualOverride := false      // reset on model change
  3. result := resolveStyle({ manualName, manualOverride,
                              modelId: ctx.model.id, stylesDir })
  4. autoFired := result?.isAuto === true
                  && (modelChanged
                      || lastResult?.name !== result.name
                      || lastResult?.isAuto !== true)
  5. If autoFired: ctx.ui.notify("Auto-applied style …", "info")
  6. updateFooter(ctx, result)             // "(auto)" suffix iff result.isAuto
  7. If result: inject(result.content) via INJECTORS[ctx.model.api]
  8. lastModelId := ctx.model.id; lastResult := result
```

**`resolver.ts` (pure):**

```
resolveStyle({ manualName, manualOverride, modelId, stylesDir }):
  1. If manualOverride and manualName:
       chosenName := manualName, isAuto := false
     Else if modelId is defined:
       walk loadAutoConfig(stylesDir) rules; first match against modelId →
         chosenName := rule.style, isAuto := true
       If no rule matches:
         chosenName := manualName (may be null), isAuto := false
     Else:
       chosenName := manualName, isAuto := false

  2. If chosenName is null → return null.

  3. Detect style kind:
       styles/<chosenName>.md exists        → simple, content := readFile
       styles/<chosenName>/dispatcher.json  → complex, go to step 4
       neither                              → return null (one-time warning)

  4. For complex styles:
       Load dispatcher (mtime-cached).
       Walk variants[] in order; first match against modelId → variantFile.
       No match → variantFile := dispatcher.default.
       content := readFile(variantFile).
       If dispatcher.preamble set → content := readFile(preamble) + "\n\n" + content.

  5. Return { name: chosenName, isAuto, content: "<userStyle>\n" + content + "\n</userStyle>" }.
```

The injector receives the final wrapped string and is unchanged. All UI effects (`notify`, `setStatus`) live in `index.ts`; the resolver is pure and easily unit-testable.

Note on `manualOverride` semantics: any `/style <name>` or `/style off` invocation by the user sets `manualOverride = true` (and updates `manualName`). The flag is cleared in step 2 of the index flow whenever `modelId` changes, so auto-config gets a fresh evaluation on the next request after a model switch.

### 6. Auto-firing semantics ("Option B")

- Auto-config is consulted on **model change** (detected by `modelId` differing from the previous request's `modelId`) and on **session start** (effectively a model change from `undefined`).
- When an auto rule fires, it sets the active style and the `(auto)` flag, and the TUI receives a one-shot notification:
  > `Auto-applied style 'thought-catalyst' for model 'claude-sonnet-4-5'.`
- A **manual** `/style <name>` (or `/style off`) sets `manualOverride = true` and clears `isAuto`. The user's choice sticks for as long as the current `modelId` stays unchanged.
- On the next `modelId` change, `manualOverride` resets to `false` and auto-config evaluates fresh.

Rationale: auto removes the burden of picking the right style; the `(auto)` badge plus notification make the source of truth explicit; a manual override is read as "user knows what they're doing" and respected until the context (the model) changes.

### 7. UX surfaces

| Surface | Behaviour |
| --- | --- |
| Footer (`ctx.ui.setStatus("style", …)`) | `style: <name>` for manual, `style: <name> (auto)` when the active style was set by auto-config and hasn't been manually overridden. |
| Notification on auto-fire | One per model-change-triggered auto activation. Suppressed if the auto rule resolves to the same style that was already active. |
| Notification on missing target | If an auto rule names a non-existent style, log a one-time warning naming the rule, fall through to the next rule. |
| `/style` picker | Unchanged surface. Shows simple and complex styles uniformly. Active style is prefixed `✓` regardless of how it became active. |

### 8. Session persistence

Unchanged in shape: a single `styles:active` session entry holds `{ name }` for the manually-selected style.

- Auto-applied styles are **not** persisted as `styles:active` entries — they are derived state, recomputed from `_config.json` + current `modelId` on every session resume. This avoids stale persistence (e.g. a user changes `_config.json`, expects new behaviour on next session, but gets the old auto-applied style baked in).
- Manual overrides are persisted exactly as today.
- On `session_start`, we still scan the branch for `styles:active`; that becomes the manual baseline, and auto-config evaluates against the current `modelId` on the first request.

### 9. Caching

`resolver.ts` keeps three small caches, each mtime-keyed:

1. Auto-config: compiled `auto` rules, keyed on `_config.json` mtime.
2. Dispatcher: parsed dispatcher + compiled variant matchers, keyed on `dispatcher.json` mtime.
3. Content: file contents per `(path, mtime)`. Replaces today's single `cache` in `index.ts`.

Worst-case per request on a cache miss: three `fs.statSync` + up to three `fs.readFileSync` calls (preamble + variant + dispatcher). All on local disk, negligible.

## Module Structure

```
extensions/styles/
  index.ts              # CHANGED: thinner — commands, session, hooks, footer/notify
  resolver.ts           # NEW    — auto-config + dispatcher + variant resolution
  injectors.ts          # UNCHANGED
  styles/
    _config.json        # NEW    — auto-config (optional)
    concise.md          # simple style (as today)
    thought-catalyst/   # complex style (new pattern)
      dispatcher.json
      _common.md        # preamble (optional)
      default.md
      anthropic.md
      openai.md
```

### `resolver.ts` (new)

Single responsibility: given the current model and the manual selection state, return the final injectable content (or `null`). The injector never sees a dispatcher or a regex.

```ts
export interface ResolveInput {
  manualName: string | null;     // persisted manual baseline
  manualOverride: boolean;       // true → manual selection wins, skip auto-config
  modelId: string | undefined;
  stylesDir: string;
}

export interface ResolveOutput {
  name: string;                  // for footer + notification
  isAuto: boolean;                // drives "(auto)" suffix
  content: string;                // already wrapped in <userStyle>…</userStyle>
}

// Pure function. Returns null when no style should apply.
export function resolveStyle(input: ResolveInput): ResolveOutput | null;
```

Model-change detection, `manualOverride` lifecycle, and the `autoFired` diff that drives one-shot TUI notification all live in `index.ts`. The resolver does no `ctx` access and no UI calls — it can be unit-tested with synthetic inputs and a temp `stylesDir`.

Plus small internal helpers:

- `compileMatcher(spec: string): (modelId: string) => boolean`
- `loadAutoConfig(dir: string): Rule[]` (mtime-cached)
- `loadDispatcher(styleDir: string): Dispatcher` (mtime-cached)
- `readContent(file: string): string` (mtime-cached)

### `index.ts` (slimmed)

Responsibilities reduce to:

- Register `/style` command (slightly updated: picker iterates simple + complex)
- Maintain per-request state (`manualName`, `manualOverride`, `lastModelId`, `lastResult`)
- Persist manual selections via session entries (existing mechanism)
- On `before_provider_request`: detect `modelId` change (reset `manualOverride` if so), call `resolveStyle`, diff against the previous result to determine whether to emit the `autoFired` one-shot notification, update the footer, then pass `result.content` to the injector dispatch (the existing `INJECTORS[api]` block in `injectors.ts:105`)

### `injectors.ts`

No changes. The `INJECTORS` registry remains the sole place new api shapes are wired in. Variants and auto-config are invisible at this layer by design.

## Backwards Compatibility

- Every existing `.md` file under `styles/` continues to work unchanged — they are simple styles.
- The `styles:active` session entry format is unchanged.
- The `/style` command surface is unchanged; the picker just gains the ability to list directory-based complex styles alongside flat files.
- A user with no `_config.json` and no complex styles experiences zero behavioural difference from today.

## Edge Cases

| Case | Behaviour |
| --- | --- |
| `_config.json` references a non-existent style | One-time warning naming the rule; rule is skipped; evaluation continues. |
| `dispatcher.json` references a non-existent variant or preamble file | One-time warning per missing file; fall back to `default` (for variants) or skip prepend (for preamble). |
| `dispatcher.json` has no `default` | Treated as malformed; one-time warning; style behaves as inactive. |
| Variant regex is invalid | One-time warning; rule is skipped. |
| `modelId` is `undefined` (e.g. transient before-first-request state) | Auto-config not evaluated; current manual selection (if any) used. |
| Two consecutive requests with same `modelId` | Resolver still runs (cheap), result is identical; `autoFired` is `false` (no name change) so no re-notification. |
| Manual `/style off` after auto fired | `manualName := null`, `manualOverride := true`, footer clears, no injection. Next `modelId` change resets `manualOverride` and re-evaluates auto-config. |
| `_config.json` edited mid-session | Picked up on next cache-miss check (mtime changes); new rules take effect on next `modelChanged` event. |
| Complex style directory missing `dispatcher.json` | Not listed in picker; one-time warning if referenced (e.g. as a session-restored manual selection). |

## Concrete Example

Suppose the user maintains:

```
styles/
  _config.json
  concise.md
  thought-catalyst/
    dispatcher.json
    _common.md
    default.md
    anthropic.md
```

With:

```json
// _config.json
{
  "auto": [
    { "match": "/^claude-/", "style": "thought-catalyst" },
    { "match": "/^gpt-/",    "style": "concise" }
  ]
}
```

```json
// thought-catalyst/dispatcher.json
{
  "preamble": "_common.md",
  "default":  "default.md",
  "variants": [
    { "match": "/^claude-/", "file": "anthropic.md" }
  ]
}
```

Session timeline:

1. Session starts on `claude-sonnet-4-5`. No manual selection in history.
   - Auto rule `/^claude-/` matches → active = `thought-catalyst (auto)`.
   - Resolver picks `anthropic.md` variant, prepends `_common.md`.
   - Footer: `style: thought-catalyst (auto)`. TUI: *"Auto-applied style 'thought-catalyst' for model 'claude-sonnet-4-5'."*
2. User runs `/style concise`.
   - Manual override set. `activeName = concise`, `isAuto = false`. Footer: `style: concise`.
3. User switches model to `gpt-5`.
   - `modelChanged = true`. Manual override resets. Auto rule `/^gpt-/` matches → active = `concise (auto)`.
   - Resolver loads simple `concise.md` (it's a flat file, dispatcher not involved).
   - Footer: `style: concise (auto)`. TUI: *"Auto-applied style 'concise' for model 'gpt-5'."*

## Open Implementation Questions (Resolve During Planning)

- **Model-change detection:** confirm the cleanest way to read `modelId` per request — `ctx.model.id` inside the hook is the obvious answer; verify it is always populated by the time `before_provider_request` fires.
- **Notification API:** confirm `ctx.ui.notify(message, "info")` is the right surface for the auto-fire announcement (consistent with existing usage in `index.ts`).
- **`/style` picker rendering for complex styles:** decide whether to indicate variant count or current-model variant in the picker label (e.g. `thought-catalyst (3 variants)`). Probably YAGNI for v1 — keep the label clean.
- **Validation command:** consider a `/style validate` (or `--check` flag) that lints `_config.json` and all dispatchers and reports unresolved references. Useful for power users; defer to a follow-up if it adds scope.

## Out of Scope / Future Considerations

- Template variables (`{{thinkingTag}}` etc.) inside variant files — additive, deferrable.
- Glob pattern syntax — string + regex covers the spectrum.
- Per-session auto-config overrides (e.g. project-local `_config.json` merged on top of the extension's) — interesting but separate.
- Variant selection by something other than `modelId` (e.g. provider, tags) — no demonstrated need.

## Testing Strategy (To Detail in Plan)

- Unit-test `compileMatcher` for exact strings, regex with flags, and invalid input.
- Unit-test `resolveStyle` across the matrix: {no style, simple style, complex style} × {auto-config absent, auto-config matches, auto-config doesn't match} × {manual override absent/present} × {model changed/unchanged}.
- Integration: dry-run `before_provider_request` against each `api` in `INJECTORS` with a complex style active, verifying the content reaches the payload in the expected slot (cache-correct).
- Backwards-compat: existing `concise.md`/`thought-catalyst.md`/`test-style.md` behaviour must be byte-identical with no `_config.json` present.
