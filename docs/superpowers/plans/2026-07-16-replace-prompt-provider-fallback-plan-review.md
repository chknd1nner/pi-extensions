# Plan review: replace-prompt provider fallback restoration

**Reviewed:** 2026-07-16
**Plan:** `docs/superpowers/plans/2026-07-16-replace-prompt-provider-fallback.md`
**Design:** `docs/superpowers/specs/2026-07-16-replace-prompt-provider-fallback-design.md`
**Base commit:** `770ce7c docs: plan replace-prompt fallback restoration`
**Reviewer method:** superpowers `reviewing-large-documents` lens applied in-session (plan fit in context; verified every code snippet against the live repo, Pi typings in `node_modules/@earendil-works/*`, and `docs/pi/docs/extensions.md`).

## Verdict

**Approved — revisions recommended (no blockers).**

The plan faithfully implements every requirement and invariant in the approved design. Cross-task interfaces are consistent, the code snippets compile against the current repo (`strict: true`, no `noUncheckedIndexedAccess`), and the tests genuinely prove the safety-critical claims (message safety, non-idempotent-once, copy-on-write, fail-open, secret-free logging) rather than only happy paths. The findings below are robustness/coverage refinements, not correctness defects.

---

## 1. Blockers

None found.

I specifically tried to break: exact-string discovery vs. substring/key matches, cycle handling, copy-on-write structural sharing, CRLF-source/LF-result asymmetry, discriminated-union narrowing in `getValueAtPath`/`replaceValueAtPath`, `Model<any>`→`ModelIdentityInput` assignability, the `event.cwd` compatibility cast, and every state-machine branch. All hold.

---

## 2. High-priority findings

None rise to High. The two items most worth the author's attention are the Medium robustness findings F1 and F2 below.

---

## 3. Medium / low-priority findings

### M1 (Medium, robustness) — Whole-`process.env` fingerprint can silently prevent learning and over-invalidate
- **Where:** Task 2, `fingerprintEnvironment` (plan lines 467–475); design "Context isolation for conditional rules" and "State lifetime".
- **Mechanism:** The fingerprint digests *all* of `process.env`. Learning only occurs when `sameTransformationContext(active.context, currentContext)` holds at the first provider request (Task 3 `handleProviderPayload`, discovery branch). `active.context` is captured in `before_agent_start`; the discovery context is recomputed in `before_provider_request`. If *any* env var mutates between those two hooks in the same turn (e.g. a tool or another extension setting an env var), the fingerprints differ, discovery is skipped, no path is ever learned, and the feature silently no-ops for that transformation. The same whole-env sensitivity means the later automatic post-tool turn fails open more often than the rule conditions actually require.
- **Severity rationale:** Fail-open is safe (correctness preserved), so this is effectiveness/robustness, not a correctness bug. Within a single normal turn env is normally stable, so it usually works — but the failure is invisible.
- **Correction options:** (a) Accept and document explicitly that env volatility disables the safety net (the design already leans this way); or (b) reduce the fingerprint domain to a bounded, documented allow-list of condition-relevant env keys, acknowledging closures can still read untracked state. If keeping whole-env, add one test that mutates an unrelated env var between `before_agent_start` and the first provider request and asserts the *documented* fail-open outcome, so the behavior is pinned rather than incidental.

### M2 (Medium, behavior change not called out) — `cwd` source changes in production
- **Where:** Task 4 index rewrite, `const cwd = ctx?.cwd ?? compatibilityEvent.cwd ?? process.cwd();` (plan line 1144) vs. current `index.ts` `const cwd = event.cwd ?? process.cwd();`.
- **Mechanism:** `BeforeAgentStartEvent` has no `cwd` field (verified in `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:468`), so in real Pi the current code falls back to `process.cwd()`, whereas the new code prefers `ctx.cwd`. This is almost certainly *more* correct, and existing `index.test.ts` still passes (its `ctx` is `{}`/`{model}` so it falls through to `event.cwd`). But it is a silent production behavior change (config discovery + the new `cwd` isolation key both now key off `ctx.cwd`).
- **Correction:** Note the change in the Task 4 rationale and the plan's "Existing behavior" claim so a reviewer of the diff isn't surprised. Optionally add a test asserting `ctx.cwd` is preferred over `event.cwd` when both are present, to pin the intended precedence.

### L1 (Low) — Inconsistent `ctx` defensiveness between hooks
- **Where:** `before_agent_start` uses `ctx?.cwd` / `ctx?.model` (plan 1144, 1195); `before_provider_request` uses `ctx.cwd` / `ctx.model` unguarded (plan 1205).
- **Mechanism:** `ExtensionContext` is non-optional in the type, so the unguarded form is type-correct. If `ctx` were ever nullish at runtime the provider hook throws; by design (`design` "Failure behavior") an unexpected throw is allowed to surface through Pi's normal error path with the payload unchanged, so this is not a safety hole — only a stylistic inconsistency that could read as accidental.
- **Correction:** Pick one convention (the type says `ctx` is always present, so dropping the `?.` in `before_agent_start` is the cleaner choice) or add a one-line comment explaining the asymmetry.

### L2 (Low) — `matches[0]` assignment relies on `length === 1`, not type narrowing
- **Where:** Task 3, `active.promptPath = matches[0];` after `if (matches.length === 1)` (plan ~line 726).
- **Mechanism:** Fine under the current `tsconfig` (`strict` without `noUncheckedIndexedAccess`, confirmed in `packages/replace-prompt/tsconfig.json`). If `noUncheckedIndexedAccess` is ever enabled repo-wide, `matches[0]` becomes `PromptPath | undefined`; it still assigns to the optional field but would then permit `undefined`. No action required now; flag only if strictness is tightened later.

---

## 4. Missing tests / acceptance-criteria coverage

Coverage is strong: I mapped all 20 design "Extension lifecycle tests" and all 12 acceptance criteria to concrete plan tests and found each represented. The safety claims are proven, not merely exercised:

- **Message safety (AC4 / design test 7):** Task 3 "repairs only the learned path" puts the *source* string `"foo"` in a user message and asserts it survives repair (`messages` ref preserved, content still `"foo"`); Task 4 mirrors this with `userMessages`. Genuinely proves BP-in-a-user-message is not rewritten.
- **Non-idempotent once (AC5):** asserted via `not.toBe("foobarbar")` and repaired value `"foobar"`.
- **Copy-on-write / metadata (AC8):** `cache_control` referential identity asserted in both Task 1 and Task 4.
- **CRLF/Unicode exact match (design test 19):** Task 4 test pins the raw-source / normalized-result asymmetry — it would fail if the implementation recorded a normalized `source`, so it correctly locks the `source: basePrompt` (raw) invariant (plan 1193) against `result: result.systemPrompt` (normalized, plan 1194).
- **Secret-free logging (design "Logging"):** Task 2 asserts the SHA-256 digest excludes key and value; Task 4 asserts the log file excludes `VERY_SECRET_BP/RP`.

Gaps (all Low):
1. **Env-volatility fail-open (ties to M1):** no test mutates an unrelated env var between `begin` and first discovery. Add one to pin the documented behavior.
2. **Line-ending matrix (design test 19):** the single combined CRLF+trailing-newline+Unicode test covers the exact-match path, but a pure LF-multiline and a pure trailing-newline-only case are not separately exercised. Optional.
3. **`ctx.cwd` vs `event.cwd` precedence (ties to M2):** no direct assertion.
4. **Partial config-load failure** (global `rules.ts` throws, project loads and changes the prompt): existing catch-to-null behavior is unchanged, so not required, but the design's clear-case 2 ("applicable configuration cannot be loaded") is only tested for the total-failure path (Task 4 "clears remembered state when configuration reload fails").

---

## 5. Things done well

- **Provider-agnostic + scoped:** No provider-name branching or hard-coded payload field names anywhere; Task 5 Step 6 adds a `git grep` guard (`anthropic|openai|google|bedrock|mistral`) to enforce this. All changes stay within `packages/replace-prompt`. Confirmed `before_provider_request` receives the built payload as `unknown` (`types.d.ts:457`) and replacement semantics match `docs/pi/docs/extensions.md:673` ("returning any other value replaces the payload").
- **Correct exact-string path model:** `findExactStringPaths` inspects values not keys, rejects substrings, ignores non-plain objects (`Date`, functions), handles root strings, and uses an ancestors-`WeakSet` that is added on entry and *deleted on exit* — so shared (non-cyclic) subtrees are correctly reported at each path while true cycles terminate. The tests pin all of these.
- **Safe copy-on-write:** `replaceValueAtPath` clones only the mutated branch, preserves array vs. object prototype, and returns the original payload reference on any miss — verified against the referential-identity assertions.
- **Sound fail-open state machine:** every design "Failure behavior" row maps to a branch; warnings are deduped per transformation via `discoveryWarningLogged`/`stalePathWarningLogged`; RP-at-learned-path is a silent no-op (no log spam).
- **Correct isolation identity:** `Model<any>` exposes string `provider`/`api`/`id` (`pi-ai/dist/types.d.ts:478`, `Api`/`Provider` are string unions), so `createModelKey` composes cleanly and is stricter than the public `ConditionContext` (which only exposes model `id`) — a deliberate, documented conservative choice.
- **TDD + commit scoping:** each task writes a failing test, runs it to confirm the missing-module/handler failure, implements, re-runs focused test + `npm run typecheck -w pi-replace-prompt`, then commits one reviewable slice. All commands are valid against `package.json` scripts (package `test`/`typecheck`) and root workspace scripts (`npm test`, `npm run typecheck` fan out via `--workspaces --if-present`). Package name `pi-replace-prompt` matches the `-w` targets.
- **Docs anchors verified present:** README `## Logging` (line 70) and feature list (6–11); `docs/usage.md` `## Logging behavior` (385), `Typical events include:` (399), and the existing `## Line ending normalization` (276) that the CRLF behavior relies on.
- **Lifecycle handling:** `session_start` (all reasons) clears state; `before_agent_start` clears on unchanged/failed-load/all-skipped; `providerLogPath` correctly persists across the automatic post-tool turn (which bypasses `before_agent_start`) so restoration is still logged.

---

## 6. Final verdict

**Approved; revisions recommended.** No blocking or High-severity issues. Before implementation, address M1 (decide and document/test the whole-env fingerprint tradeoff) and M2 (call out the `cwd` source change), and optionally fold in the Low findings and the four coverage additions. None of these change the architecture or the task/interface contracts, so the plan can proceed as written with these notes applied during Tasks 2, 4, and 5.
