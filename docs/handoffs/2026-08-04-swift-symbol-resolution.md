# Handoff: add Swift symbol resolution to `pi-anchor-resolver`

**Tracked by:** [#1](https://github.com/chknd1nner/pi-extensions/issues/1) — close it with a `Fixes #1` PR/commit trailer.
**Date:** 2026-08-04
**Repo:** `pi-extensions` (this repo). Package: `packages/pi-anchor-resolver`. Branch `main`, clean tree at handoff (HEAD `2973548`).
**Status of prior work:** `anchor_resolve` tool built and in use; resolves TS/JS `code:` anchors + language-agnostic `behavior:` anchors. See `docs/handoffs/2026-08-02-pi-anchor-resolver-build.md`.
**Next goal:** teach the `code:` anchor resolver to resolve **Swift** symbols, so the Radius living-spec corpus can cover the iOS app (26.2k LOC Swift) with first-class symbol anchors — not just test/behavior anchors.
**Size:** ~55–60 LOC across one package. Est. 1–3 hrs with TDD. Isolated to this repo; Radius is not touched by this task.

> **This supersedes a decision in the 2026-08-02 handoff.** That doc said "no Swift concern for v1 … document a `@ast-grep/cli`-spawn fallback for a future Swift phase." **The CLI fallback is NOT needed.** A prebuilt napi grammar package (`@ast-grep/lang-swift`) plugs into the `registerDynamicLanguage` we already import, so Swift stays fully in-process.

## Why this now (context)

Radius decided (this session) to **scale the living spec to whole-project breadth, Swift-first**. Rationale: you can't build/test a retrieval+drift harness against an empty corpus, so build the corpus first. iOS is the largest component, and we want a *uniform* corpus (symbol anchors everywhere), not an iOS-shaped hole. This task is the small enabling change that unblocks uniform breadth. (Radius-side prose authoring is the follow-on "Phase B".)

## The finding, verified by spike (reproducible)

`@ast-grep/lang-swift` (npm, **v0.0.8**, wraps mature `tree-sitter-swift` 0.7.1) works with our `@ast-grep/napi@^0.45.0`. Spike run 2026-08-04 in a throwaway dir:

```js
import { registerDynamicLanguage, parse } from '@ast-grep/napi';
import swift from '@ast-grep/lang-swift';
registerDynamicLanguage({ swift });                 // exact call that worked
const root = parse('swift', swiftSource).root();     // parse by string name
root.findAll({ rule: { kind: 'class_declaration' } });
// → matched `final class TranscriptStore` and `struct Envelope`,
//   node.field('name').text() returned "TranscriptStore" / "Envelope" correctly.
```

Result: `class_declaration` node kind exists; `.field('name')` resolves the symbol name; `function_declaration` and `property_declaration` are also present. **The same rule shape we use for TS works on Swift.**

## Type facts (checked against installed `.d.ts`)

- `parse(lang: NapiLang, src)` where `NapiLang = Lang | (string & {})`. So `parse('swift', src)` is **type-legal** — `languageToLang` only needs to widen its return type from `Lang` to `NapiLang`.
- `registerDynamicLanguage(langs: DynamicLangRegistrations): void` — docstring says **"should be called exactly once in the program."** `@ast-grep/lang-swift`'s default export is a ready `LangRegistration` (it resolves its own prebuilt dylib + extensions), which is why `registerDynamicLanguage({ swift })` is all that's needed.

## Current code state (what you're changing)

`packages/pi-anchor-resolver/resolve-code.ts` (61 LOC):
- L3: `import { Lang, parse } from "@ast-grep/napi";`
- L6–12: `const LANG_MAP: Record<string, Lang> = { typescript: Lang.TypeScript, ts: Lang.TypeScript, tsx: Lang.Tsx, javascript: Lang.JavaScript, js: Lang.JavaScript };`
- L14–19: `languageToLang(language): Lang` — throws `unsupported language …` for misses (message auto-lists `LANG_MAP` keys, so it updates for free).
- L28: `const lang = languageToLang(anchor.language);`
- L43: `const root = parse(lang, source).root();`

No change needed in `anchors.ts` / `types.ts`: `CodeAnchor.language` is already a free `string`; `parseCodeAnchor` accepts any non-empty string. `resolve-behavior.ts` is already language-agnostic (substring line-match) — Swift **tests** already resolve today.

## Plan (TDD)

**1. RED — write failing tests first.** In `tests/resolve-code.test.ts` add cases, and add a fixture `tests/fixtures/sample.swift` (a `final class …`, a `struct …`, a `func …`):
- `languageToLang('swift')` does not throw; an unknown language still throws.
- `resolveCodeAnchor({ language:'swift', rule:{ kind:'class_declaration', has:{ field:'name', regex:'^Envelope$' } }, files:['tests/fixtures/sample.swift'] }, cwd)` → exactly one location with `symbol:'Envelope'` and the right line.
- `npm test` (`vitest run`) → confirm red.

**2. GREEN — implement in `resolve-code.ts` + `package.json`.**
- `package.json`: add `"@ast-grep/lang-swift": "0.0.8"` (**exact pin** — v0.0.x is young). Install.
- `resolve-code.ts`: `import swift from '@ast-grep/lang-swift';` — **if it ships no types, add a 2-line ambient `declare module '@ast-grep/lang-swift' { const reg: unknown; export default reg; }`** (a `.d.ts` in the package or inline).
- Single-registration guard (vitest isolates per test file → `registerDynamicLanguage` may be called >1×/process and can throw "already registered"):
  ```ts
  let swiftRegistered = false;
  function ensureSwift() {
    if (swiftRegistered) return;
    try { registerDynamicLanguage({ swift }); } catch { /* already registered */ }
    swiftRegistered = true;
  }
  ```
  Call `ensureSwift()` inside `resolveCodeAnchor` when `anchor.language.toLowerCase() === 'swift'` (or unconditionally at top of the function).
- Widen `LANG_MAP` value type + `languageToLang` return to `NapiLang`; add `swift: 'swift'` to the map. Import `NapiLang` type from `@ast-grep/napi`.
- `npm test` → green.

**3. Verify.** `npm run typecheck` (`tsc --noEmit`) clean; full `npm test` green.

**4. Drift-proof on a REAL iOS symbol (acceptance evidence — do not skip).** Temporarily add a throwaway `language: swift` anchor in Radius (`/Users/martinkuek/Documents/Projects/radius/docs/living/anchors.yml`) pointing at an actual class in `apps/radius/ios/**`, run the resolver against the Radius repo, confirm it resolves to the correct file/line and reports empty drift, then **revert**. This is the first proof the loop works on Swift end-to-end. (Pick a real class — e.g. grep `apps/radius/ios` for a `final class`/`struct` with a stable name.)

**5. README.** Add `swift` to the supported-languages note, and the one authoring caveat: **Swift `class_declaration` covers `class`/`struct`/`actor`** (our spiked `struct Envelope` matched it) — anchor authors disambiguate with child filters when they must separate them.

**Deliverable:** one reviewable commit in `pi-extensions`.

## Caveats / gotchas

1. **Exact-pin `@ast-grep/lang-swift@0.0.8`** — pre-1.0.
2. **Native prebuilt binary** — the lang package ships a platform-specific dylib via optionalDependencies. Fine locally (arm64 mac). If this package ever runs in CI/other platforms, ensure the right optional dep resolves; out of scope for this task but note it.
3. **Registration-once + vitest isolation** — hence the try/catch guard above; don't let a second registration throw.
4. **Possible missing TS types** on the lang package → the tiny `declare module` shim. Confirm during GREEN.
5. **Authoring, not tooling:** class/struct/actor conflation (README note only).

## What this unblocks (Phase B, Radius repo — not this task)

Whole-project living-spec **prose + anchors** across all Radius domains: remaining daemon sections, CLI, crypto/protocol (all TS, already anchorable), and **iOS** (now symbol-anchorable after this task). Corpus-first; the enforcement skill/harness comes later. No action here — just so you know why this small change matters.

## Key paths

- This package: `packages/pi-anchor-resolver/` (`resolve-code.ts`, `resolve-behavior.ts`, `anchors.ts`, `types.ts`, `tests/`). Scripts: `test` = `vitest run`, `typecheck` = `tsc --noEmit -p tsconfig.json`.
- Prior handoff (tool build): `docs/handoffs/2026-08-02-pi-anchor-resolver-build.md`.
- Radius living spec (consumer): `/Users/martinkuek/Documents/Projects/radius/docs/living/` (`daemon.md`, `anchors.yml`, `README.md`).
- Radius living-spec design/rollout: `/Users/martinkuek/Documents/Projects/radius/docs/superpowers/specs/2026-08-02-living-spec-layer-design.md` and `…/specs/2026-08-03-living-spec-pilot-rollout-design.md`.
