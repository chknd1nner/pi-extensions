> **ARCHIVED / SUPERSEDED (2026-06-05).** This design grew an on-disk dispatcher/variant file format and a manual-override state machine — both unnecessary scope creep. Replaced by the leaner auto-switch design: routing lives only in `_config.json`, "variants" are just separate style files, and manual selection stays sticky (no override machinery). See `../../specs/2026-06-05-styles-auto-switch-design.md` and `../../plans/2026-06-05-styles-auto-switch-impl.md`. Kept for the reasoning trail.

---

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

- **Plain string** (e.g. `"claude-haiku-4-5"`) → exact equality on `modelId`. **Case-sensitive.**
- **Slash-delimited regex** (e.g. `"/^claude-/"`, `"/gpt-5/i"`) → parsed as `new RegExp(pattern, flags)` and matched with `.test(modelId)`. Detection rule: a `match` string is treated as regex iff it satisfies `/^\/(.+)\/([imsu]*)$/` (leading `/`, trailing `/` optionally followed by a subset of JS regex flags). All other strings are exact matches.

**Allowed regex flags: `i`, `m`, `s`, `u` only.** The `g` and `y` flags are explicitly disallowed because `RegExp.test()` with them mutates `lastIndex`, making the matcher stateful across calls. A rule with disallowed flags is treated as invalid and skipped with a one-time warning.

**Case sensitivity:** matching is case-sensitive by default. Authors who want case-insensitive matching use the `/i` flag (e.g. `/^claude-/i`).

**Inspiration vs alignment:** the design is *inspired by* `replace-prompt`'s `string | RegExp` discrimination in TS-land, but the JSON serialization is novel — `replace-prompt` carries actual `RegExp` objects in a TS rules file. The slash-delimited form is the JSON equivalent.

**Acknowledged limitation:** a model ID that is *literally* `"/foo/"` (with leading and trailing slashes) cannot be expressed as an exact-match string — it will be parsed as a regex. This is accepted as a non-issue: real-world model IDs from all currently supported providers use the alphabet `[a-z0-9._-]` and would not collide with this rule. If a future provider introduces slash-bearing IDs, an explicit object form (e.g. `{ "literal": "..." }`) can be added as an additive change without breaking existing configs.

**Style-name validation (auto-config only):** the `style` field of an `auto[]` rule must be a valid style basename — it must match `/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/`. No slashes, no leading dot, no `..`. Rules with invalid names are skipped with a one-time warning. This is the resolver's only defense against a malformed `_config.json` causing `path.join` to escape `stylesDir`.

**Invalid regex pattern (e.g. unbalanced brackets):** one-time warning naming the offending rule, rule is skipped, evaluation continues with the next rule.

**Implementation:** a single `compileMatcher(spec: string): (modelId: string) => boolean` helper, used in both layers. Returns `null` (or a sentinel) for invalid specs so the caller can warn-and-skip uniformly.

### 5. Resolution algorithm

Responsibilities split between `index.ts` (stateful coordinator, owns `ctx` and UI) and `resolver.ts` (ctx-free and UI-free; does its own filesystem reads but returns diagnostics rather than calling `ctx.ui` directly).

**Model-change detection (precise definition):**

```
modelChanged(prev: string | undefined, curr: string | undefined): boolean
  := prev !== undefined && curr !== undefined && prev !== curr
```

Only transitions between two **defined and different** `modelId` values count as a model change. Transitions involving `undefined` (e.g. the very first request of a session, transient missing model info) do **not** reset `manualOverride`. This protects manual override stickiness against providers that may briefly report `undefined`.

**`manualOverride` reset rule (refined):** even on a real model change, `manualOverride` is only reset when `manualName !== null`. The combination `manualName === null && manualOverride === true` represents an explicit `/style off` — a deliberate system-level disable — and is treated as persistent: model changes do not silently re-engage auto-config. The user re-enables styling by manually picking a style.

**`index.ts` per-request flow (stateful):**

```
State held across requests:
  manualName        : string | null    // persisted via session entry; null = "off"
  manualOverride    : boolean          // user has explicitly chosen for current model
  lastModelId       : string | undefined
  lastResult        : ResolvedStyle | null   // last resolver inner result, for autoFired diff
  warnedKeys        : Set<string>      // dedupes one-time warnings

On before_provider_request:
  1. currentModelId := ctx.model?.id
  2. If modelChanged(lastModelId, currentModelId) AND manualName !== null:
         manualOverride := false        // reset per-model stickiness on model switch
     // /style off (manualName === null && manualOverride === true) survives the switch.
  3. output := resolveStyle({ manualName, manualOverride,
                              modelId: currentModelId, stylesDir })
     result := output.result            // ResolvedStyle | null
  4. For w in output.warnings:
         if w.key not in warnedKeys:
             warnedKeys.add(w.key); ctx.ui.notify(w.message, "warning")
  5. autoFired := result?.isAuto === true
                  && (lastResult?.name !== result.name
                      || lastResult?.isAuto !== true)
     // Note: autoFired depends on result transition, NOT on modelChanged.
     // Switching between two models mapped to the same style does not re-notify.
  6. If autoFired:
         ctx.ui.notify(`Auto-applied style '${result.name}' for model '${currentModelId}'.`, "info")
  7. updateFooter(ctx, result)           // "style: <name>" or "style: <name> (auto)" or cleared
  8. If result: pass result.content to INJECTORS[ctx.model.api] (existing dispatch)
  9. lastModelId := currentModelId; lastResult := result
```

**Manual-selection state mutation (the *only* paths that set `manualOverride = true`):**

Every user-initiated activation in `index.ts` must funnel through a single `setActiveManual(name | null)` helper that:
- updates `manualName`
- sets `manualOverride := true`
- persists via `pi.appendEntry(ACTIVE_ENTRY, { name })` (existing mechanism, unchanged shape)

The paths required to use this helper:
- `/style <name>` direct activation
- `/style off` (passes `null`)
- `/style` picker selection of an existing style
- Picker `⊕  Create new style…` after content is saved

Auto-applied styles flow through the resolver result only; they do **not** call `setActiveManual` and do **not** write a session entry. This is what keeps auto-applied state ephemeral and recomputed on resume.

**`resolver.ts` (ctx-free, UI-free):**

```
resolveStyle({ manualName, manualOverride, modelId, stylesDir }):
  warnings := []

  1. Determine chosenName + isAuto:
     If manualOverride:
         // Manual selection wins, including the explicit "off" case (manualName = null).
         chosenName := manualName; isAuto := false
     Else if modelId is defined:
         // Walk auto rules; first *resolvable* match wins.
         For each rule in loadAutoConfig(stylesDir):
             If rule.match.test(modelId):
                 If rule.style fails basename validation:
                     warnings.push({ key: "auto:badname:" + rule.style,
                                     message: "... ignored: invalid style name ..." })
                     continue
                 If styleExists(stylesDir, rule.style):
                     chosenName := rule.style; isAuto := true; break
                 Else:
                     warnings.push({ key: "auto:missing:" + rule.style,
                                     message: "auto-rule matched but style … missing; skipped" })
                     continue
         If no resolvable rule matched:
             chosenName := manualName; isAuto := false
     Else:
         // modelId undefined: no auto evaluation, fall back to manual baseline.
         chosenName := manualName; isAuto := false

  2. If chosenName is null → return { warnings } as a Result with no style.

  3. Detect style kind. If both forms exist (collision case):
       styles/<chosenName>.md (file)        AND
       styles/<chosenName>/dispatcher.json  (directory)
     → Simple file wins. Emit a one-time warning for this name.

     Otherwise:
       file exists       → simple,  rawContent := readContent("<chosenName>.md")
       directory exists  → complex, go to step 4
       neither           → warnings.push(missing-style); return { warnings, result: null }

  4. For complex styles:
       Load dispatcher (mtime-cached). Validate shape; missing/unreadable default
       → warn + return { warnings, result: null }.
       Walk dispatcher.variants[] in order. First match against modelId selects variantFile.
       If variantFile does not exist → warn + fall through to default.
       If no variant matches, or matched variant missing → variantFile := dispatcher.default.
       If dispatcher.default file is missing/unreadable → warn + return { warnings, result: null }.
       rawContent := readContent(variantFile)
       If dispatcher.preamble specified:
           preambleContent := readContent(preamble) (warn if missing, treat as empty)
           preambleContent := preambleContent.trim()
           If preambleContent is non-empty:
               rawContent := preambleContent + "\n\n" + rawContent

  5. Trim/empty handling (preserves current readStyleText behaviour):
       trimmed := rawContent.trim()
       If trimmed is empty → return { warnings, result: null }   // no injection
       wrapped := "<userStyle>\n" + trimmed + "\n</userStyle>"

  6. Return { warnings, result: { name: chosenName, isAuto, content: wrapped } }.
```

The resolver returns a `(result, warnings)` pair. The injector receives `result.content` and is unchanged. Warnings are deduped and emitted by `index.ts`.

**On caching and `_config.json` edits mid-session:** the resolver evaluates auto-config on every request (it is mtime-cached so the cost is one `fs.statSync` on warm cache). When `_config.json` is edited, the new rules take effect on the **next request where `manualOverride` is `false`** — because the resolver only walks auto rules in that branch. A user who has manually overridden keeps their override; auto re-evaluates on the next model change (which resets `manualOverride`) or on a manual `/style off` followed by a model change.

### 6. Auto-firing semantics ("Option B")

**Trigger model:** auto-config is **evaluated on every request**, but only in the branch where `manualOverride` is `false`. The flag is what gates auto vs manual; the request loop is what re-checks.

- `manualOverride := true` is set by any user-initiated `/style` action (see §5 manual-selection mutation), including `/style off`.
- `manualOverride := false` is set by the model-change detector (§5) **only when `manualName !== null`** — i.e. a previously-named manual pick reverts to "auto if available, else manual baseline" on model switch.
- `/style off` (`manualName === null && manualOverride === true`) is treated as a **persistent system-level disable**: it survives model changes; the resolver returns no injection; the user re-engages styling by manually picking any style.
- Whenever `manualOverride` is `false` and `modelId` is defined, the resolver walks auto rules and picks the first resolvable match.

**Notification (one-shot per *transition*, not per model change):**

The TUI receives:
> `Auto-applied style 'thought-catalyst' for model 'claude-sonnet-4-5'.`

exactly when the *resolved style name or `isAuto` flag changes from the previous request's result*. Switching between two models that map to the same auto style does **not** re-notify. Switching between two models that map to different auto styles **does** notify.

**Footer (`style: <name> (auto)`):** rendered whenever the current `result.isAuto === true`. Drops the `(auto)` suffix the moment a manual override fires.

**Rationale:** auto removes the burden of picking the right style; the `(auto)` badge plus one-shot notification make the source of truth explicit; a manual override is read as "user knows what they're doing" and respected until the model context changes.

### 7. UX surfaces

| Surface | Behaviour |
| --- | --- |
| Footer (`ctx.ui.setStatus("style", …)`) | `style: <name>` for manual selection, `style: <name> (auto)` whenever the current `result.isAuto === true`. Cleared when no style is active. |
| Notification on auto-fire | Fired when the resolved style name or `isAuto` flag *transitions* between requests (see §6). Switching between two models mapped to the same auto style does not re-notify. |
| Diagnostic warnings | Resolver returns `warnings: { key, message }[]` in its output. `index.ts` dedupes by `key` against a session-scoped `warnedKeys` set and surfaces unseen warnings via `ctx.ui.notify(message, "warning")`. Used for: invalid regex flags, invalid style names, missing auto-target, missing variant/preamble/default file, simple↔complex name collision. |
| `/style` picker | Lists simple `.md` styles and complex directories uniformly. Active style is prefixed `✓` regardless of whether it became active manually or via auto-config. Picking from the picker counts as a manual override (sets `manualOverride = true`). |

### 8. Session persistence

Unchanged in shape: a single `styles:active` session entry holds `{ name }` for the manually-selected style (where `name` may be `null` to represent an explicit "off").

- Auto-applied styles are **not** persisted as `styles:active` entries — they are derived state, recomputed from `_config.json` + current `modelId` on every session resume. Avoids stale persistence if the user edits `_config.json` between sessions.
- Manual selections are persisted exactly as today (`setActiveManual` writes the entry; that's the only writer).

**Session resume semantics (refined):**

Resume defers to the user's last explicit choice. The presence of any `styles:active` entry in the session history is treated as evidence of deliberate user intent and is restored as an active override.

- On `session_start`, scan the branch for the latest `styles:active` entry.
- If found:
  - `manualName := entry.name` (may be `"foo"` or `null`)
  - `manualOverride := true` — the user has made an explicit choice; honor it.
- If no entry exists:
  - `manualName := null`
  - `manualOverride := false` — no choice ever made; auto-config has full agency.

In both cases, `lastModelId := undefined` and `lastResult := null`, so the first request triggers normal resolution.

**Concrete consequences of the refined rule:**

| Persisted | First request after resume |
| --- | --- |
| `{ name: "foo" }` | `foo` is applied. No auto-config evaluation. Footer: `style: foo`. No `(auto)` badge. |
| `{ name: null }` | Styles disabled. No injection. Footer cleared. Survives subsequent model changes. |
| (none) | Auto-config evaluated normally; first auto activation notifies as today. |

**Within the resumed session:**

- If the user resumed with persisted `foo` and then switches `modelId`, `manualName !== null` so `manualOverride` resets to `false`. From that point, auto-config has agency again, with `foo` as fallback baseline if no rule matches. (`foo` may still apply via fallback, but with no `(auto)` badge.)
- If the user resumed with persisted `null` (off), model changes do **not** lift the disable.

**Rationale:** the persisted entry IS the user's expressed preference. Treating it as a baseline-only fallback (the previous draft's behaviour) silently demoted that choice. Treating it as an active override matches the "explicit user choice is sacrosanct" principle that already governs `/style off` persistence.

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

Single responsibility: given the current model and the manual selection state, return the final injectable content (or signal no-injection), plus any diagnostic warnings. The injector never sees a dispatcher or a regex.

```ts
export interface ResolveInput {
  manualName: string | null;     // persisted manual baseline (null = "off")
  manualOverride: boolean;       // true → manual wins, skip auto-config entirely
  modelId: string | undefined;
  stylesDir: string;
}

export interface ResolvedStyle {
  name: string;                  // for footer + notification
  isAuto: boolean;               // drives "(auto)" suffix and autoFired transition logic
  content: string;               // already wrapped in <userStyle>…</userStyle>
}

export interface Warning {
  key: string;                   // stable dedup key (e.g. "auto:missing:thought-catalyst")
  message: string;               // user-facing message for ctx.ui.notify
}

export interface ResolveOutput {
  result: ResolvedStyle | null;  // null → no injection this request
  warnings: Warning[];           // index.ts dedupes by key against session-scoped set
}

export function resolveStyle(input: ResolveInput): ResolveOutput;
```

The resolver is **ctx-free and UI-free** (it does not import or accept `ctx`, does not call `ui.notify`/`ui.setStatus`). It is *not* pure in the strict sense — it reads the filesystem and uses internal mtime caches — but it has no side effects on `ctx` or external state and can be unit-tested with synthetic inputs and a temp `stylesDir`.

Diagnostics flow exclusively through the returned `warnings` array; `index.ts` is responsible for deduping (via the `warnedKeys` set) and surfacing via `ctx.ui.notify`.

Internal helpers:

- `compileMatcher(spec: string): { test(modelId: string): boolean } | null` (null = invalid spec)
- `loadAutoConfig(dir: string): { rules: CompiledRule[]; warnings: Warning[] }` (mtime-cached)
- `loadDispatcher(styleDir: string): { dispatcher: Dispatcher; warnings: Warning[] }` (mtime-cached)
- `readContent(file: string): string | null` (mtime-cached; `null` on missing/unreadable)
- `validateStyleName(name: string): boolean` (rejects path-traversal, slashes, leading dot)
- `styleExists(stylesDir: string, name: string): "simple" | "complex" | "both" | "none"`

### `index.ts` (slimmed)

Responsibilities reduce to:

- Register `/style` command. Picker enumerates simple `.md` and complex directories uniformly.
- Maintain per-request state: `manualName`, `manualOverride`, `lastModelId`, `lastResult`, `warnedKeys`.
- Funnel **every** user-initiated activation through `setActiveManual(name | null)`, which:
  - updates `manualName`
  - sets `manualOverride := true`
  - persists via `pi.appendEntry(ACTIVE_ENTRY, { name })` (existing format, unchanged)
  Required call sites: `/style <name>`, `/style off`, picker selection, and the post-save handoff in the create-new-style flow.
- On `session_start`: scan the branch for the latest `styles:active` entry; if found, set `manualName := entry.name` and `manualOverride := true`; if not, `manualName := null` and `manualOverride := false` (see §8). Always clear `lastModelId`, `lastResult`, `warnedKeys`.
- On `before_provider_request`: run the 9-step flow from §5 — detect model change with the precise predicate, reset `manualOverride` on change, call `resolveStyle`, dedup+surface warnings, compute `autoFired` from result-transition, notify if fired, update footer, dispatch injection through the existing `INJECTORS[ctx.model.api]` block in `injectors.ts:105`, update `lastModelId`/`lastResult`.
- Defensive access: `ctx.model?.id` and `ctx.model?.api` (matches current code style).

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
| `_config.json` references a non-existent style | Resolver walks past this rule with a one-time warning (`key: auto:missing:<name>`) and continues to the next rule. First *resolvable* match wins. |
| `_config.json` rule has an invalid `style` name (path traversal, slashes, leading dot) | One-time warning (`key: auto:badname:<name>`); rule skipped. |
| `_config.json` rule has an invalid regex (bad pattern, disallowed `g`/`y` flag) | One-time warning at config load; rule skipped; rest of config still active. |
| `dispatcher.json` references a non-existent variant file | One-time warning; fall through to `default`. |
| `dispatcher.json` references a non-existent preamble file | One-time warning; treated as empty preamble (no prepend). |
| `dispatcher.json` has no `default` field, or `default` points to a missing/unreadable file | Style is treated as inactive for this request; one-time warning; no injection. |
| Preamble file exists but is empty (after trim) | No prepend, no blank-line join. Variant content used as-is. |
| Variant content (or simple-style content) is empty after trim | No injection (matches current `readStyleText` behaviour). |
| Variant `match` regex is invalid or uses disallowed flags | One-time warning at dispatcher load; variant skipped; ordering of remaining variants preserved. |
| `modelId` is `undefined` | Auto-config not evaluated for this request. If `manualOverride` is `true`, manual selection (including `null`/off) wins. Otherwise `manualName` baseline applies. **Crucially, `manualOverride` is NOT reset on an `undefined` transition** (see model-change predicate in §5). |
| `modelId` transitions `defined → undefined → defined` (same value) | Not a model change; `manualOverride` not reset. |
| `modelId` transitions `defined → undefined → different defined` | Counted as a model change at the moment `defined → different defined`; `manualOverride` resets then. |
| Two consecutive requests with same `modelId` | Resolver runs (cheap, mtime cache); result is identical; `autoFired` false (no transition); no re-notification. |
| Two consecutive requests with different `modelId` but same resolved auto style | `modelChanged` true so `manualOverride` resets; resolver returns same name; `autoFired` false (no transition); no re-notification. Footer unchanged. |
| Manual `/style off` after auto fired | `manualName := null`, `manualOverride := true`, footer clears, no injection. **Persistent**: survives model changes; user re-engages by manually picking a style. |
| `_config.json` edited mid-session | mtime cache picks up the change. Takes effect on the next request where `manualOverride` is `false` (i.e. immediately if no manual override is in force; otherwise after the next model change resets the override). |
| Complex style directory missing `dispatcher.json` | Not listed in picker. If referenced by name (auto-config or session-restored manual), one-time warning; treated as missing. |
| Both `foo.md` and `foo/dispatcher.json` exist under `styles/` | Simple `.md` wins. One-time warning (`key: collision:foo`) naming the conflict. Picker shows the name once. |
| Session resume with persisted `{ name: "foo" }` | `manualOverride := true` on resume (§8); `foo` is the active style; no auto evaluation; footer `style: foo` with no `(auto)` badge. |
| Session resume with persisted `{ name: null }` (explicit off) | `manualOverride := true`, `manualName := null`; styles disabled; survives subsequent model changes. |
| Session resume with no `styles:active` entry in history | `manualOverride := false`; auto-config has full agency from the first request, as if it were a fresh session. |
| After resume with persisted `foo`, user switches `modelId` | `modelChanged` true and `manualName !== null` → `manualOverride` resets. Auto-config evaluates for the new model; `foo` becomes a fallback baseline if no rule matches. |
| After `/style off`, user switches `modelId` | `modelChanged` true but `manualName === null` → `manualOverride` does NOT reset. Off persists. |
| `lastResult` is null on first request of a session | Transition check trivially fires for any auto result → one notification on the first auto activation, as intended. |

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

- **`ctx.model` availability timing:** the design uses `ctx.model?.id` defensively, but verify whether `model` is always populated by the time `before_provider_request` fires across all supported providers. If there is a known transient `undefined` window, the model-change predicate in §5 already protects state, but document the actual provider behaviour observed.
- **`/style` picker rendering for complex styles:** decide whether to indicate variant count or current-model variant in the picker label (e.g. `thought-catalyst (3 variants)`). Likely YAGNI for v1 — keep the label clean.
- **`/style validate` command:** consider a subcommand that lints `_config.json` and every dispatcher and reports unresolved references / invalid regex / disallowed flags / name collisions. The warning channel already surfaces these at runtime, but a one-shot lint is friendlier for power users. Defer to a follow-up unless trivial.
- **Re-engaging auto-config after `/style off`:** the spec defines `/style <name>` as the way to lift the persistent disable. Consider whether a dedicated `/style auto` command would improve UX — it would remove the manual override entirely (clearing both `manualName` and `manualOverride`, ideally by writing a distinguishing sentinel entry or by issuing a session entry that the scanner interprets as "reset"). Defer to a follow-up; the current single-command surface stays minimal.

## Out of Scope / Future Considerations

- Template variables (`{{thinkingTag}}` etc.) inside variant files — additive, deferrable.
- Glob pattern syntax — string + regex covers the spectrum.
- Per-session auto-config overrides (e.g. project-local `_config.json` merged on top of the extension's) — interesting but separate.
- Variant selection by something other than `modelId` (e.g. provider, tags) — no demonstrated need.

## Testing Strategy (To Detail in Plan)

**`compileMatcher` unit tests:**

- Plain string → exact equality, case-sensitive (`"claude-sonnet-4-5"` matches itself, not `"Claude-Sonnet-4-5"`).
- Slash-delimited regex with allowed flags (`/^claude-/`, `/gpt-5/i`, `/foo/imsu`).
- Disallowed flags `g`, `y` → returns `null` (invalid).
- Malformed regex pattern → returns `null`.
- Pathological literal `/foo/` → documented to parse as regex (limitation case).

**`validateStyleName` / path-safety unit tests:**

- Accept: `concise`, `thought-catalyst`, `style.v2`, `_internal-debug`.
- Reject: `../foo`, `foo/bar`, `.hidden`, `/abs`, empty string.

**`resolveStyle` matrix unit tests (synthetic `stylesDir` per case):**

- {no style baseline, simple style, complex style} × {auto absent, auto matches, auto matches but target missing, auto matches a later resolvable rule} × {`manualOverride` false/true} × {`manualName` null/non-null} × {`modelId` defined/undefined}.
- Trim/empty: empty file, whitespace-only file, preamble that trims empty, variant that trims empty.
- Name collision: simple and complex with same name → simple wins, collision warning emitted.
- Dispatcher with missing `default` file → no injection, warning.
- Dispatcher with missing variant → fall through to default, warning.
- Warnings dedup via stable `key` fields across repeated calls.

**`index.ts` state-machine tests (with mocked `ctx`):**

- First request: `lastModelId === undefined`, `lastResult === null` → auto activation produces `autoFired === true`.
- Second request, same `modelId`, same auto result → `autoFired === false`.
- Second request, different `modelId`, same auto-resolved name → `autoFired === false` (transition-only).
- Second request, different `modelId`, different auto-resolved name → `autoFired === true`.
- Model-change predicate: `undefined → defined` does NOT reset `manualOverride`; `defined → different defined` DOES (when `manualName !== null`); `defined → undefined → same defined` does NOT (net).
- `manualName === null && manualOverride === true` (i.e. `/style off`) survives model changes: cycle through several `modelId`s and verify `manualOverride` stays `true`, no injection occurs, no auto notification fires.
- `/style off` after auto fired → `manualOverride = true`, `manualName = null`, no injection, **persistent across subsequent model changes**.
- Session resume tests: (a) persisted `{ name: "foo" }` → on first request, `foo` applies, no auto evaluation, no `(auto)` badge; (b) persisted `{ name: null }` → styles disabled, persists across simulated model changes; (c) no persisted entry → auto-config has full agency from first request.
- Warning dedup: same `key` emitted by resolver across N requests → `ctx.ui.notify` called once.

**Injector integration:**

- Dry-run `before_provider_request` against each `api` in `INJECTORS` (`anthropic-messages`, `openai-responses`, `openai-completions`, `openai-codex-*`) with a complex style active, verifying the content reaches the payload in the expected slot (cache-breakpoint correctness preserved).

**Backwards-compatibility:**

- Existing `concise.md` / `thought-catalyst.md` / `test-style.md` byte-identical injection result with no `_config.json` and no complex styles — verify by snapshotting the payload mutation for each existing style under each `api`.
- Existing `styles:active` session entries round-trip unchanged (including `{ name: null }` for off).
