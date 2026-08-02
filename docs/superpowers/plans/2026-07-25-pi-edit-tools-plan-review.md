# Plan review: pi-edit-tools

**Reviewed:** 2026-07-25
**Plan:** `docs/superpowers/plans/2026-07-25-pi-edit-tools.md` (2568 lines, 8 tasks)
**Design:** `docs/superpowers/specs/2026-07-25-pi-edit-tools-design.md` (982 lines)
**Base commit:** `c25b936 docs: add pi-edit-tools implementation plan, finalize spec package name`
**Reviewer method:** `reviewing-large-documents` skill with the plan lens. Lead reviewer held only the preamble, both outlines, and worker reports; body sections were reviewed by four delegated workers (`openai-codex/gpt-5.6-luna`, thinking `high`) over a frozen `delegate_pack` prefix. Every blocker and High finding below was re-verified personally against the plan text and the installed Pi SDK typings.

## Verdict

**Changes required — 2 blockers, 4 High.**

The plan's *architecture* is sound and faithful to the spec: strict TypeBox schemas, `prepareArguments` for repair, per-cwd cached `createEditToolDefinition`, renderer delegation, and no forked edit engine. Spec coverage is broad (see §7). The defects are concentrated in two places: (a) the repair algorithm in Tasks 4–5 has control-flow holes that a context-free implementer would ship as-is, and (b) Task 6's code as written does not compile and cannot pass its own tests. Task 7 additionally instructs the worker to expect a PASS before the implementation exists, which will stall an executing agent.

None of these require redesign. They are all fixable by editing the plan.

---

## 1. Blockers

### B1 — Task 6: `isRecord` is used but never imported (`native-adapter.ts` will not compile)

Plan lines 1706–1708 are the only imports in `native-adapter.ts`:

```typescript
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import type { EditInput, MultiEditInput, EditEntry } from "./normalize.js";
```

`isRecord` is called at plan line 1836 (`if (!args || !isRecord(args)) return undefined;`). It is exported from `normalize.ts` by Task 3 (plan line 533) but is a **value**, not a type — adding it to the existing `import type` line would also fail.

*Verified:* `awk 'NR>=1466 && NR<=1868' <plan> | grep -n "isRecord\|^import"` → imports at relative lines 242–243, sole `isRecord` use at relative line 371.

**Fix:** add a value import to Task 6 Step 3 and to the task's Interfaces block:

```typescript
import { isRecord } from "./normalize.js";
```

### B2 — Task 4: `fromTopLevel.get(1)!` throws `TypeError` when the only pair is numbered

`extractPairs` keys the map by the *suffix index* parsed from the key (plan lines 830–866). For input `{ path, oldText2: "A", newText2: "B" }` the map is `{2 => pair}`, so `fromTopLevel.size === 1`. Control flow then falls through to:

```typescript
  } else {
    pair = fromTopLevel.get(1)!;      // plan line 1034
  }

  return { path, oldText: pair.oldValue, newText: pair.newValue };
```

`get(1)` is `undefined`, and the non-null assertion silences the compiler, so the model receives `Cannot read properties of undefined (reading 'oldValue')` instead of either a repair or a corrective error. Spec "Numbered typo with one apparent pair" (lines 447–462) requires this input to be repaired; the plan has **no test for the same-suffix case** — its tests only cover the mismatched-suffix forms `{oldText, newText2}` and `{oldText2, newText}`, which take the `extractLooseSinglePair` path.

*Verified:* plan lines 830–866, 1028–1035; worker probe reproduced the `TypeError`.

**Fix:** replace line 1034 with a size-1-agnostic selection and add a regression test:

```typescript
  } else {
    const [only] = [...fromTopLevel.values()];
    pair = only;
  }
```

Add to the Task 4 test table: `{path, oldText2:"A", newText2:"B"}` → `{path, oldText:"A", newText:"B"}`.

---

## 2. High-priority findings

### H1 — Task 6: the aliased-renderer test contradicts the implementation it is paired with

Task 6 Step 1 test (plan lines 1631–1643) feeds `{ file_path: "/f.ts", oldText: "A", newText: "B" }` and asserts the native renderer receives `edits: [{ oldText: "A", newText: "B" }]`.

`toMultiEditRenderableArgs` (plan lines 1843–1848) only ever maps `args.edits`:

```typescript
edits: Array.isArray(args.edits)
  ? args.edits.map(...)
  : [],
```

For that input `args.edits` is `undefined`, so the function returns `edits: []`. It also only recognises `path` and `file_path` for the path, ignoring the other four documented aliases. **Task 6 Step 4 ("Expected: PASS") cannot succeed as written.**

**Fix:** have the renderer adapter call `prepareMultiEditArgs` inside the existing `try`/`catch` (falling back to raw args on throw) rather than hand-rolling a partial normaliser. That also removes the duplicated, weaker alias logic.

### H2 — Task 7: Step 2 expects PASS before Step 3 writes the implementation

Step 1 is titled "Write **failing** registration test" (plan line 1881); Step 2 says:

```
Run: `npx vitest run packages/pi-edit-tools/tests/registration.test.ts`
Expected: PASS (all tests — these use already-written modules)
```

(plan lines 1988–1991), while `index.ts` is not written until Step 3 (plan line 1993). The test imports the extension's default export, which is still Task 1's `export default function () {}` placeholder. A context-free worker following `executing-plans` will halt here. The Files block (plan lines 1871–1872) also lists only `Modify: index.ts` and omits `Create: tests/registration.test.ts`.

**Fix:** change Step 2's expectation to `FAIL — extension registers no tools`, add a Step 4 re-run expecting PASS, and add the test file to the Files list as a Create.

### H3 — Tasks 3/4/5: numbered path aliases (`path2`, `file2`) are silently accepted

`normalizeBase` strips trailing digits *before* the alias lookup (plan lines 514–519), and `classifyKey` then returns `{ kind: "path", index: 0 }` (plan line 526). `extractPath` selects on `classifyKey(key).kind === "path"` (plan line 811), so `{ path2: "/wrong.ts", ... }` resolves to `/wrong.ts`.

The spec enumerates exactly six path aliases, none numbered (spec lines 310–321), and the spec explicitly warns against pattern-matching over explicit tables (spec line 382). `multi_edit` inherits the same helper (plan line 1387).

Worse, because path classification discards the index, `{ path: "/a.ts", path2: "/b.ts" }` is caught by the conflict check only because the *values* differ — but `{ file: "/a.ts", filename2: "/a.ts" }` passes silently, and a model that emits `path2` alone gets an edit against a file it never named canonically.

**Fix:** in `classifyKey`, test path membership against the *un-digit-stripped* normalised key, so numeric suffixes never classify as `path`; add negative tests for `path2` and `file2` in the Task 3 test table.

### H4 — Task 5: numbered pairs *inside* an `edits[]` entry are rejected, regressing `edit-field-guard`

`prepareMultiEditArgs` maps each entry through `extractSinglePair` (plan lines 1405–1411), which collapses every `old`-kind key into one slot and throws on differing values (plan lines 874–903). So `edits: [{ oldText:"A", newText:"B", oldText2:"C", newText2:"D" }]` throws `conflicting old-text values inside an edit entry` instead of expanding to two edits.

Spec "Repair Rules for `multi_edit`" (lines 479–523) requires numbered fields to be paired by suffix, and the existing `packages/edit-field-guard/lib.ts:84–160` already expands numbered fields inside entries — with regression tests at `packages/edit-field-guard/tests/lib.test.ts:58–85`. This is an unlearned lesson from the prior art the spec's Motivation section cites.

**Fix:** route nested entries through a suffix-aware helper that returns *all* complete pairs in an entry (in suffix order), and reject only genuinely unpairable leftovers. Add a Task 5 test for the nested numbered case.

---

## 3. Medium findings

### M1 — Recognised old/new fields with non-string values are silently dropped

`extractPairs`, `extractSinglePair`, `extractLooseSinglePair` and `countOldNewCandidates` all begin with `if (typeof value !== "string") continue;` (plan lines 833, 878, 1057, 1080). So `{ path, oldText:"A", newText:"B", oldText2: 42 }` returns the first pair instead of rejecting.

This contradicts the task's own stated contract — "Never silently drops or picks among conflicting values" (plan line 937) — and the Ambiguity Policy's requirement that the extension "must never partially execute a request merely because part of it could be understood" (spec lines 121–123).

**Fix:** classify the key first; if the kind is `old` or `new` and the value is not a string, throw. Apply in both `prepareEditArgs` and `prepareMultiEditArgs`.

### M2 — Task 8's "integration" tests never exercise the registered tool definitions

`tests/integration.test.ts` imports `prepareEditArgs`/`prepareMultiEditArgs` from `../normalize.js` and `getNativeEditTool`/`toNativeArgs` from `../native-adapter.js` (plan lines 2161–2162) and re-assembles the pipeline by hand. It never imports `../index.js`.

Consequences: a mis-wired `prepareArguments`, a wrong `parameters` schema, a broken `renderCall` binding, or a `toNativeArgs` call with the wrong `toolType` in `index.ts` would pass the entire suite. The suite also discards the native result, so **none** of spec "Behaviour Preserved From Pi" (lines 617–636) items *generated diff text*, *unified patch details*, or *first-changed-line metadata* is asserted, despite the plan's self-review checklist claiming they are preserved.

**Fix:** add at least one case that imports the default export, registers into a fake `ExtensionAPI`, and drives the resulting `editDef.prepareArguments` → `editDef.execute` path end to end; assert `result.details.diff`, `.patch`, and `.firstChangedLine` on a canonical edit.

### M3 — Task 8 has no coverage for the failure modes found above

No integration case covers `{oldText2, newText2}` (B2), a numbered path alias (H3), or a non-string recognised field (M1). The suite does cover `oldText + newText2` (plan lines 2317–2330), which is the *other* numbered form. Absence of coverage is why these defects survived the plan's own self-review.

**Fix:** add real-file cases for all three, asserting rejection **and** that the file on disk is unchanged.

### M4 — Spec "Repair Feedback" has zero implementation coverage

`rg -n "debug|logRepair|repair type|logger" <plan>` returns **no hits**. Spec lines 727–758 require: no warning injection for routine aliases; an optional debug mode recording tool / repair type / original field names / canonical field names / model / provider / timestamp; **no source-code string contents logged by default**; and no verbose warning text on successful results.

The plan satisfies the two negative requirements by omission (it never adds warnings or logging), but nothing states this as an intentional decision, and the "no source strings by default" invariant has no test guarding future regression.

**Fix:** either add a small Task 7 step implementing the debug-mode record (spec calls it optional — "may"), or add an explicit note to Global Constraints that debug logging is deferred, plus a test asserting successful results carry no repair warning text.

### M5 — Acceptance criterion 11 (`edit-field-guard` coexistence) has no concrete action

Criterion 11 (spec lines 946–948) asks that production configuration not expose two competing `edit` overrides. The plan addresses this with one Global Constraints bullet (line 16) and one README sentence (line 93). Nothing removes `edit-field-guard` from `~/.pi/agent/settings.json`, where it is currently loaded, and no test detects the collision.

Relevant SDK behaviour: extension tools override built-ins, but among *extensions* the **first** registration for a name wins (`ExtensionRunner`, `runner.js:278–295`) — so a stale `edit-field-guard` entry would silently shadow `pi-edit-tools`' `edit` while `multi_edit` still registers, producing a half-migrated state that is hard to diagnose.

**Fix:** add a Task 7 (or new Task 9) step that removes the `edit-field-guard` entry from the dogfood settings and documents the precedence rule in the README.

---

## 4. Low findings

- **L1 — Dead alias entries.** `PATH_ALIASES`/`OLD_TEXT_ALIASES`/`NEW_TEXT_ALIASES` (plan lines 459–495) contain underscore spellings (`file_path`, `old_string`, `old_text`, `new_string`, `new_text`, `replace_with`) that `normalizeBase` can never produce, since it strips `[\s_-]`. They are harmless — every one has a matching stripped entry — but the comment calls the tables "normalized". Trim them, or reword the comment to "accepted spellings".
- **L2 — `index` contract violated for path and zero suffixes.** `Classified.index` is documented as "1-based … Defaults to 1" (plan lines 452–454) but `classifyKey` returns `0` for paths (line 526), and `oldText0` yields `index: 0`. Reject non-positive suffixes or classify them `unknown`, and correct the doc comment.
- **L3 — Misleading error for a lone unpaired field.** `{path, oldText:"A", newText:"B", oldText2:"C"}` throws `edit requires path, oldText, and newText.` (plan lines 993–999) even though all three were supplied. Spec Errors (lines 752–754) models the better shape: `edit could not pair oldText2 with a corresponding newText2.`
- **L4 — Renderers are bound to the registration-time cwd.** `index.ts` captures `nativeRenderCall`/`nativeRenderResult` from `getNativeEditTool(process.cwd())` (plan lines 2019–2031) while `execute` resolves against `ctx.cwd` (line 2063). The plan comments on this, but in a multi-cwd session the preview may resolve paths against the wrong root. Consider resolving the renderer's native tool from `context.cwd` inside the adapter.
- **L5 — Test commands bypass the workspace convention.** Every task runs `npx vitest run packages/pi-edit-tools/tests/<file>.test.ts`; `AGENTS.md` prescribes `npm test -w <package-name>`. The `npx` form works (root `vitest ^3.2.4`, no config file needed) but diverges from the documented convention. Add a final `npm test -w pi-edit-tools && npm run typecheck -w pi-edit-tools` verification step.
- **L6 — Project structure deviation is unjustified.** The spec suggests `normalize-edit.test.ts` + `normalize-multi-edit.test.ts` (spec lines 789–797); the plan consolidates into `normalize.test.ts` and adds `registration.test.ts` / `integration.test.ts`. This is a reasonable improvement — just say so in the plan so a reviewer does not read it as an oversight.
- **L7 — `executionMode` omission is correct; the coverage concern is withdrawn.** Spec lines 703–708 require not forcing global sequential execution. Omitting `executionMode` achieves exactly that: `pi-agent-core/dist/agent-loop.js` gates on `t.n === "sequential"`, so `undefined` means parallel — and Pi's own `createEditToolDefinition` sets no `executionMode` either. No change needed. Recorded here only because it looked like a gap in the coverage sweep.

---

## 5. Things done right

- **The architecture matches the spec exactly.** No forked edit engine; all mutation flows through `createEditToolDefinition`. Verified `getNativeEditTool` (plan lines 1711–1720) against spec lines 555–570 — same per-cwd `Map` shape.
- **SDK conformance is genuinely accurate.** `prepareArguments` is used synchronously as the typings require (`types.d.ts:354–355`), `execute` is called with the correct five arguments (`types.d.ts:364–365`), and `ExtensionAPI`, `ToolDefinition`, `AgentToolResult`, `AgentToolUpdateCallback`, `ExtensionContext`, `createEditToolDefinition` are all real root exports. `ctx.cwd` exists (`types.d.ts:216`).
- **Scaffolding follows repo convention precisely.** Task 1's `package.json` and `tsconfig.json` are byte-comparable to `packages/edit-field-guard/` — same `"pi"` manifest key, same `peerDependencies: "*"` policy, `typescript`/`vitest` correctly left in root devDependencies, `.js` import extensions matching the existing `moduleResolution: "Bundler"` setup.
- **Task 4 collects all candidates before deciding.** The "validate the entire request, not return early from one branch" structure (plan lines 946–947) is the right shape for the Ambiguity Policy, and it correctly catches the hard cases: conflicting path aliases, conflicting old/new aliases, multi-item nested `edits`, malformed stringified `edits`, and stringified-plus-top-level collisions.
- **Tool descriptions and prompt guidance are transcribed from the spec, not invented.** Plan lines 2036–2046 and 2080–2091 track spec lines 194–215 and 273–280.
- **Task 8 does test real filesystem behaviour** for CRLF, BOM, multiline/quote/backslash payloads, missing matches, overlapping edits, and same-file concurrency against Pi's mutation queue. The gaps in M2/M3 are additions, not rewrites.

---

## 6. Recommended edits, in order

1. Task 6 Step 3 — add `import { isRecord } from "./normalize.js";` **(B1)**
2. Task 4 Step 3 — replace `fromTopLevel.get(1)!` with sole-value selection; add the `{oldText2,newText2}` test **(B2)**
3. Task 6 Step 3 — replace `toMultiEditRenderableArgs` with a `prepareMultiEditArgs`-based adapter **(H1)**
4. Task 7 Step 2 — expect FAIL; add post-implementation PASS step; add `tests/registration.test.ts` to Files **(H2)**
5. Task 3 Step 3 — stop stripping digits before path classification; add `path2`/`file2` negative tests **(H3)**
6. Task 5 Step 3 — suffix-aware expansion of numbered pairs inside `edits[]` entries **(H4)**
7. Tasks 4 & 5 — reject non-string recognised old/new fields **(M1)**
8. Task 8 — add an entry-point integration case asserting `details.diff` / `.patch` / `.firstChangedLine`, plus regression cases for B2, H3, M1 **(M2, M3)**
9. Global Constraints or Task 7 — state the Repair Feedback decision; add a no-warning-text assertion **(M4)**
10. New step — remove `edit-field-guard` from dogfood settings; document first-registration precedence **(M5)**
11. Sweep the Low findings **(L1–L6)**

---

## 7. Spec coverage

Coverage is good. Of the spec's requirement-bearing sections, the coverage sweep confirmed implementation for: Summary, all five Design Principles, Tool 1 (schema, description, prompt guidance), Tool 2 (schema, semantics, description), Pre-Validation Compatibility Layer, all three Canonical Naming alias tables, both Repair Rules sections, Ambiguity Policy, Native Pi Adapter, Rendering, Registration, Errors, Suggested Project Structure, all four Testing categories, Acceptance Criteria 1–10, and the Architectural Principle.

**Orphan requirements** (spec requirement with no implementing task):

| Spec section (lines) | Requirement | Severity |
|---|---|---|
| Behaviour Preserved (617–636) | Generated diff text asserted | Medium (M2) |
| Behaviour Preserved (617–636) | Unified patch details asserted | Medium (M2) |
| Behaviour Preserved (617–636) | First-changed-line metadata asserted | Medium (M2) |
| Behaviour Preserved (617–636) | Abort handling | Low — `signal` is forwarded to native `execute` (plan line 2068); untested |
| Repair Feedback (727–758) | Debug-mode record; no-source-strings-by-default | Medium (M4) |
| Execution & Concurrency (701–726) | Unrelated-file concurrency preserved | Low — untested, but architecturally free |
| Acceptance Criterion 11 (946–948) | Production config has one `edit` override | Medium (M5) |
| Model Evaluation (882–930) | Empirical model comparison | Low — plan explicitly defers to post-release (line 2565+); acceptable for v0.1.0 |

**Unmotivated tasks:** none. Every task traces to a spec requirement; Task 1's `npm install` / lockfile steps trace to `AGENTS.md` rather than the spec, which is correct.

**Self-review checklist audit** (plan lines 2513–2568) — the plan's own §1 Spec Coverage table is **overstated in three rows**:

| Plan claims | Reality |
|---|---|
| "Native diff/patch/BOM/line-ending preserved → Task 8" | BOM and line endings are tested; diff, patch and first-changed-line are **not asserted at all** |
| "TUI renderer behavior … repaired arg normalization for both tools → Task 6" | The multi_edit renderer adapter handles only 2 of 6 path aliases and drops all top-level pair repair (H1) |
| §2 Placeholder Scan (lines 2540–2549) | Did not catch the undefined `isRecord` reference (B1) or the `fromTopLevel.get(1)!` unsafe assertion (B2) |

Execution/Concurrency and Repair Feedback are absent from the checklist entirely.

---

## 8. Review-coverage appendix

**Method:** `reviewing-large-documents` + `references/plan-lens.md`. Shared frozen prefix via `delegate_pack` (`edit-tools-plan-review`, 7 items, ~6.7k tokens): plan preamble, plan outline, spec outline, nine extracted spec preamble sections, the plan's self-review checklist, and `AGENTS.md`.

**Workers** — all `openai-codex` / `gpt-5.6-luna`, thinking `high`:

| Worker | Scope | Plan lines | Result |
|---|---|---|---|
| batch A | Tasks 1–3 (scaffolding, schemas, key classification) | 23–555 | 2 PASS, 1 PASS-WITH-CONCERNS; 3 findings |
| batch B | Tasks 4–5 (repair rules) | 556–1465 | 2 FAIL; 7 findings + 32-row rule-trace table |
| batch C | Tasks 6–8 (adapter, entry point, integration tests) | 1466–2512 | 1 FAIL, 2 PASS-WITH-CONCERNS; 6 findings + SDK conformance table |
| coverage-matrix | spec ↔ plan, both directions | whole documents | 76-row coverage matrix; 13 orphan requirements; AC trace |

**Probed empirically:** batch B and C workers transcribed the plan's TypeScript into throwaway scripts under `/tmp` (deleted afterward) and executed every documented example input plus edge cases — this is what produced the B2 `TypeError` and the H3/M1 reproductions. Batch A probed TypeBox strict-schema and `minItems` behaviour against the installed `typebox@1.1.39`.

**Personally re-verified by the lead reviewer** (not taken on worker authority): B1 (import scan of plan lines 1466–1868), B2 (plan lines 830–866 and 1028–1035 read in full), H1 (test at 1631–1643 vs implementation at 1843–1848), H2 (plan lines 1869–1996), H3 (plan lines 508–531 vs spec lines 310–321), M1 (all four `typeof value !== "string"` guards), M2 (import list of `tests/integration.test.ts`), M4 (`rg` for debug/logging → zero hits), M5 (`rg` for `edit-field-guard` → 3 hits, all documentation), L7 (`ToolExecutionMode` semantics in `pi-agent-core/dist/agent-loop.js` and absence of `executionMode` in `dist/core/tools/edit.js`), plus SDK ground truth for `ToolDefinition`, `ToolRenderContext`, `ExtensionContext.cwd` and `createEditToolDefinition`.

**Not probed:**
- No code was executed against the real `createEditToolDefinition` backend — `packages/pi-edit-tools/` does not exist, so every "will it actually run" claim about Task 8 is static analysis. Recommended probe once Task 6 lands: run the Task 8 suite and diff its assertions against `dist/core/tools/edit.js:177–220`.
- Extension registration precedence between two same-named *extension* tools was read from `runner.js:278–295`, not exercised. Recommended probe: load `edit-field-guard` and `pi-edit-tools` together in a scratch session and observe which `edit` wins.
- The spec's Model Evaluation section was surveyed but not reviewed for methodology, since the plan defers it.

**Follow-up rounds used:** 0 of the permitted 2. Round 1 ledgers reconciled cleanly — batch C's "requires `isRecord` although the declared interface omits it" matched batch A's "Task 3 produces `isRecord`" with no corresponding consume declaration in Task 6's Interfaces block, which is precisely blocker B1. All other produces/consumes pairs matched on exact signature.

**Dispatch note:** the first round-1 attempt ran two workers concurrently and both failed after 3600s with zero tool calls and zero tokens — an apparent retry stall on the Codex subscription under concurrent large requests. Isolation tests (bare worker, pack-only worker) succeeded, and all four reviews then completed when dispatched serially. Worth knowing for future `openai-codex` fan-out.
