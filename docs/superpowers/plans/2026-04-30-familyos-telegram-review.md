# Review: FamilyOS Telegram Implementation Plan

**Reviewing:** `docs/superpowers/plans/2026-04-30-familyos-telegram.md` (commit `f574d95`)
**Against:** spec `docs/superpowers/specs/2026-04-30-familyos-telegram-design.md`, prior spec review `docs/superpowers/specs/2026-04-30-familyos-telegram-design-review.md` (commit `bd74acd`), Pi SDK docs at `docs/pi/docs/{sdk,extensions}.md`, and the `superpowers:writing-plans` skill rubric.
**Date:** 2026-04-30

The decomposition, TDD cadence, and most spec coverage are sound. Six issues are blockers because they each represent either a wrong API call (compile-time failure) or a violation of a load-bearing review decision (security or KV-cache integrity). Fix those first; the rest is polish. Plan line numbers are cited inline.

---

## Blockers

### B1 — Wrong Pi SDK tool-factory names. Module will fail to load.

**Plan:** `2026-04-30-familyos-telegram.md:1601-1609`, `:1673-1678`

The plan imports `createReadToolDefinition`, `createWriteToolDefinition`, `createEditToolDefinition`, `createGrepToolDefinition`, `createFindToolDefinition`, `createLsToolDefinition` from `@mariozechner/pi-coding-agent`. Verified against `docs/pi/docs/sdk.md:496-502, 1135-1136` and `docs/pi/docs/extensions.md:1825, 1828, 1841` — the actual exports are `createReadTool`, `createWriteTool`, `createEditTool`, `createGrepTool`, `createFindTool`, `createLsTool` (no `Definition` suffix). Vitest will throw `Module '"@mariozechner/pi-coding-agent"' has no exported member 'createReadToolDefinition'` the moment Task 5 step 4 loads the file.

**Fix:** Drop the `Definition` suffix from all six imports and call sites. Verify the return shape `{ name, description, parameters, execute, ... }` matches what Pi's `pi.registerTool` accepts before relying on the spread pattern in `:1675-1682`.

### B2 — Selective tool loading is not implemented. `bash` is still loaded into the runtime.

**Plan:** `2026-04-30-familyos-telegram.md:1665-1785`, `:1937-1973`, `:2055-2060`

`buildGuardedToolDefinitions` always builds all six wrappers and only filters at the very end (`:1782-1785`). The extension passes those to `pi.registerTool` and additionally calls `pi.setActiveTools(...)` (`:1952`). It does **nothing** to suppress Pi's built-in `read`/`write`/`edit`/`grep`/`find`/`ls`/`bash`. The runtime factory passes `noTools: "all"` to `createAgentSessionFromServices` (`:2059`), but `noTools` is **not a documented option** of `createAgentSession` / `createAgentSessionFromServices` — `docs/pi/docs/sdk.md` lists `tools` and `customTools` only. `--no-builtin-tools` is a CLI flag, not an SDK option.

This violates spec §"Hard boundary: no raw built-in tools" and review item #1 (selective-load, not gate-at-execute). `setActiveTools` is a runtime visibility toggle (`extensions.md:1465`); the underlying tools remain registered and any future code path that bypasses the active-tool gate (a `before_provider_request` mutation, a Pi internal change, an extension that calls `setActiveTools` later) re-exposes `bash`.

**Fix:**
1. Read `@mariozechner/pi-coding-agent`'s source for the `createAgentSession*` family (`/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/dist/...`) and find the actual surface that suppresses built-ins. Likely `tools: []` / `customTools: []` on `createAgentSession`. Drop `noTools: "all"`.
2. In the extension `session_start` handler, call `pi.registerTool(...)` for **only** the agent's permitted tools. Remove the post-hoc `.filter(...)` and the `setActiveTools` call.
3. Add a failing test that asserts, after runtime construction with various agent profiles, `pi.getAllTools()` does not contain `bash` and contains only the tools listed in `agent.capabilities.tools`. The plan's current Task 5 step 6 test (`:1497-1512`) does not provide this guarantee — it tests the wrapper-level policy, not the runtime tool list.

### B3 — Handoff injection mutates cached prefix and has an invalid fallback. Defeats KV-cache stability and may send invalid payloads.

**Plan:** `2026-04-30-familyos-telegram.md:1854-1916`, `:1955-1959`

`injectHandoffIntoPayload` has three branches:
- **String `system`** (`:1862-1864`): concatenates the handoff into the cached prefix string. On any provider whose system field is a single string with cache markers attached, this mutates the cached payload byte-for-byte — cache miss every turn after `/agent`.
- **Array `system`** (`:1865-1867`): appends an item without specifying `cache_control`. This branch can be correct for Anthropic if (and only if) the *previous* item carries the cache breakpoint and this new item does not. The plan never says which item carries it, never tests cache-read tokens stay non-zero, and never references provider-payload semantics.
- **Fallback** (`:1907-1912`): prepends a synthetic `{ role: "system", ... }` to `messages`. Most provider APIs (Anthropic Messages in particular) reject `system` role inside `messages`. Review item #22 explicitly rejected this option.

This is the single most cited review item (#22) and it is the implementation closest to "do not do this." It will either silently miss cache, work by accident on one provider, or send an invalid payload.

**Fix:**
- Delete the string-concat and messages-prepend branches. If MVP supports Anthropic only, say so and only handle the array case.
- Append the handoff as a separate `{ type: "text", text: handoff }` item to the array `system`, with **no** `cache_control` on it. Document and assert that the persona+tools prefix block above carries the cache marker.
- Add a test that captures `payload.system` before and after `before_provider_request` runs for an `/agent` continue and asserts: (a) the prefix items are byte-identical, (b) exactly one extra item is appended, (c) no item ever migrates to `messages`.

### B4 — `appendSystemPromptOverride` is not a real Pi option. Tool guidelines may not reach the model.

**Plan:** `2026-04-30-familyos-telegram.md:2050`

`resourceLoaderOptions: { ..., systemPromptOverride: () => agent.soul, appendSystemPromptOverride: () => [] }`. `appendSystemPromptOverride` does not appear in `docs/pi/docs/sdk.md` — the documented `DefaultResourceLoader` keys are `systemPromptOverride`, `skillsOverride`, `agentsFilesOverride`, `promptsOverride` (`sdk.md:458, 619, 637, 668`). This either throws on construction or is silently ignored.

The deeper issue: by setting `systemPromptOverride: () => agent.soul`, the plan replaces the entire system prompt. Pi's normal pipeline auto-injects a `Guidelines` block composed from registered+active tools' `promptGuidelines`. Whether `systemPromptOverride` suppresses that pipeline is undocumented and the plan never resolves it. Review items #2, #3 require both SOUL and re-authored tool guidelines to reach the model — and to be cacheable together.

**Fix:** Pick one and commit to it:
1. Have `systemPromptOverride` return `${agent.soul}\n\n${composeGuidelines(activeTools)}`. The plan owns guideline composition — straightforward, fully deterministic.
2. Verify in SDK source that `systemPromptOverride` does *not* suppress Pi's auto-injection of `promptGuidelines` from registered tools; cite the source line in the plan.

Either way, drop `appendSystemPromptOverride`. Add a test that fetches the actual built system prompt via `ctx.getSystemPrompt()` (`extensions.md:496`) and asserts both SOUL content and each guarded tool's guideline string are present.

### B5 — `ModelRegistry.getAvailable()` is async; plan uses it synchronously. `/model` will crash.

**Plan:** `2026-04-30-familyos-telegram.md:2887-2893`

```typescript
listAvailableModels() {
  return this.deps.modelRegistry.getAvailable().map((model) => ({...}));
}
```

`docs/pi/docs/sdk.md:386` shows `const available = await modelRegistry.getAvailable();` — returns `Promise<Model[]>`. `Promise.prototype.map` does not exist. First click of `/model` throws `TypeError`. No test catches it because Task 10's `/model` flow mocks `listAvailableModels`.

**Fix:** `async listAvailableModels()` with `await`. Update the `/model` router branch to `await`. Add a smoke test that exercises the real `ModelRegistry`.

### B6 — `getDefaultSessionDir` and `setRebindSession` are undocumented. Pi session storage and re-binding may not work.

**Plan:** `2026-04-30-familyos-telegram.md:1985, 2001, 2579-2581, 2776, 2850`

Neither name appears in `docs/pi/docs/sdk.md` or `docs/pi/docs/extensions.md`. The docs say only that the runtime exposes `runtime.session.bindExtensions(...)` and that you should call it again after a new session (`sdk.md:169`); there is no `setRebindSession` configurator API documented. Likewise, session storage layout is documented but `getDefaultSessionDir` is not an export.

If either name is wrong, two things break: (1) Pi sessions land in the wrong directory or fail to resolve, and (2) extension hooks (`before_provider_request`, tool registration, `agent_*` events) silently stop firing after the first `newSession()` / `switchSession()` — which means handoff injection, audit, and per-agent tool loading all break the moment a user runs `/new` or `/agent`.

**Fix:** Verify both names against the installed SDK source. If they don't exist:
- Replace `getDefaultSessionDir` with whatever path-builder the SDK actually exports (likely just `path.join(sharedPiAgentDir, "sessions", encodeCwd(homeDir))` — encode logic must match Pi's).
- Replace `runtime.setRebindSession(...)` with a `pi.on("session_start", ...)` handler that re-runs the binding. Verify the actual signature of `bindExtensions` first — the plan calls `bindExtensions({})` (`:2578`) with an empty object; the docs don't show what shape it expects.

Add an integration test: create runtime → `await runtime.newSession(...)` → fire a turn → assert the `agent_start` listener and `before_provider_request` mutation both still execute.

---

## Major issues

### M1 — `/tree` does not render a real ASCII tree. Indentation alone is a flat list.

**Plan:** `2026-04-30-familyos-telegram.md:2294-2301`

The renderer outputs `${"  ".repeat(item.depth)}[N] ...`. Review item #6 explicitly required ASCII tree glyphs (`├──`, `│  `, `└──`) precisely because indentation-only rendering throws away the structural distinction between `/tree` and `/resume`. Render real glyphs by tracking last-child status at each depth and add a test that a 3-deep branch shows `└──` on the last leaf and `├──` on non-last siblings.

### M2 — Tree page index→entryId map is recomputed per callback, not pinned in the flow store.

**Plan:** `2026-04-30-familyos-telegram.md:4072-4099`

Review item #6 required: "the mapping from numeric button to Pi entry ID is stored server-side under the flow token, not encoded into `callback_data`." The plan does store `entryId` in the *action* flow (`:4082-4090`), good — but the `tree` flow's `pick` handler calls `buildTreePage(...)` again and indexes `page.entries[Number(value)-1]`. If session entries change between render and click (autocompaction, a user turn racing the queue, Pi internal re-numbering), `[3]` resolves to a different entry than the user saw.

**Fix:** When rendering `/tree`, persist `{ kind: "tree", filter, page, indexToEntryId: Object.fromEntries(page.entries.map(e => [e.index, e.entryId])) }` under the flow token. Look up by index from the stored map on `pick`, never recompute.

### M3 — Filter button labels diverge from Pi's documented modes.

**Plan:** `2026-04-30-familyos-telegram.md:2246-2257, 3625-3634`

Pi documents `default, no-tools, user-only, labeled-only, all`. The plan exposes `all, no-tools, user-only, labeled` — missing `default`, renaming `labeled-only`. Either match Pi's names verbatim (recommended for the spec's "preserve Pi's tree semantics") or document the rename in the spec.

### M4 — `before_provider_request` event payload shape is unverified.

**Plan:** `2026-04-30-familyos-telegram.md:1955-1959`

`extensions.md:589` shows `pi.on("before_provider_request", (event, ctx) => { ... });` — the plan's handler signature is fine (extra args ignored). But it accesses `event.payload` and the plan never verifies that's the right key (vs. `event.request`, `event.providerPayload`, etc.). One-line spot-check against the SDK source before B3's fix lands; if the key is wrong, the entire handoff system silently no-ops.

### M5 — `isIdle` does not consider queue depth. State-changing commands can race.

**Plan:** `2026-04-30-familyos-telegram.md:2757-2760`

`isIdle(user) { return !handle || !handle.runtime.session.isStreaming; }` — only checks the SDK's streaming flag. Spec §"Runtime Safety and Concurrency" requires idle to also mean the per-user queue is drained. Currently a `/new` queued behind an in-flight `sendTurn` reports `isIdle === true` while the prior streaming turn is still resolving (between `isStreaming` flipping false and the next operation starting). Expose a `isQueueDrained(user)` or have `isIdle` check both.

### M6 — Bot-token / agent.json shape verifications missing.

**Plan:** `2026-04-30-familyos-telegram.md:2737-2745, 1497-1512`

- `sendMessage({ customType, content, display: false, details, ... }, { deliverAs: "nextTurn" })`: `customType`/`display` field names are not in the cited docs. Verify against the SDK source — invented field names will silently drop messages.
- `generateBranchSummary({ entries: handle.runtime.session.sessionManager.getBranch(), model, apiKey, headers, signal, customInstructions })` (`:2682-2688`): the documented public signature isn't in `docs/pi/docs/compaction.md`; the parameter shape is invented. Verify before writing the code.
- The Task 5 mock `ExecutionContext` (`:1497-1512`) is an `as any` puddle that doesn't actually exercise the SDK contract; if Pi validates ctx shape, the test breaks for an unrelated reason.

### M7 — Step granularity exceeds skill limit at Task 6 step 4.

**Plan:** `2026-04-30-familyos-telegram.md:1937-2065`

"Implement the FamilyOS extension factory and runtime factory" asks for two non-trivial files in one step — extension hooks, Pi imports, session-lifecycle wiring, ~80 lines of code. The `writing-plans` skill caps a step at 2-5 minutes; this is 15-20. Split into "implement extension factory" → "implement runtime factory."

### M8 — Audit log is not flushed on shutdown.

**Plan:** `2026-04-30-familyos-telegram.md` (entry-point, search "AuditLog" / "main")

The audit log writer is created once and never closed on SIGTERM/SIGINT. Append-only without flush + close means the last buffered events are lost on graceful shutdown. Add `process.on("SIGTERM", async () => { await auditLog.close(); process.exit(0); })` and the same for SIGINT.

---

## Minor / nits

- **`:1188`** — Task 4 step 2 expects "FAIL because `merge.ts` and `agent-loader.ts` do not exist yet" but `merge.test.ts` only imports merge. Wrong expected message.
- **`:1782-1785`** — `definitions.filter((d) => agent.capabilities.tools.includes(d.name as ToolName))` — `as ToolName` cast hides typos. Use a guard.
- **`:2459-2464`** — `buildPromptText` appends file paths to the prompt for *images* that are also forwarded inline. Decide whether the agent sees them as both text and inline image, or only inline.
- **`:3132-3135`** — `setInterval(() => void sendTyping())`; if Telegram returns 429, the rejection is swallowed. Add `.catch(emitAuditEvent)`.
- **`:3500`** — `[...(flowStore as any).values.keys()][0]` in tests reaches into private state. Add `getTokenForTest`.
- **`:3924-3927`** — `unsupportedMessage` reply happens *after* the pending-compact-instruction check. If a user is in custom-instruction mode and sends a voice note, the voice note becomes the compact instruction. Reorder.
- **`:4034-4036`** — `service.isIdle(user as any)` — `requireRegisteredUser` already returns the typed user. Drop the cast.
- **`:4194-4214`** — `createTelegramBot` constructs the file downloader from `bot.api` before `bot.start()` resolves. Verify grammY's `bot.api` is usable pre-start.
- **`:4395-4396`** — `Spec Coverage Check` section attributes "Identity and onboarding" to Tasks 3, 8, 10, 11. Tasks 8 and 11 do not implement identity. Tighten.
- **Strings vs filter names** — Pi's filter modes are `default, no-tools, user-only, labeled-only, all`. Adopt them or document the rename (see M3).

---

## Spec coverage gaps (require new plan tasks/tests)

1. **No test that an unregistered user uploading a 5MB file triggers no download.** Code path is correct (`requireRegisteredUser` short-circuits before `persistAttachments`) but review item #12 wants this asserted. Add a test in Task 9.
2. **No test that the bot token is unreachable from an agent.** Spec §"Control plane vs execution plane": agent attempts to read `config/familyos.json` → must be denied. Add a test in Task 5.
3. **No test that Pi session files land under `paths.sharedPiAgentDir`.** `runtime-isolation.test.ts` (`:2438`) checks isolation but not location. Add an assertion.
4. **`deepMerge` is implemented but never used.** Task 4 implements `deepMerge` but no plan task composes shared Pi settings + `home/.pi/settings.json`. Either Pi's `SettingsManager.create(cwd, sharedPiAgentDir)` (`:2033`) does this internally — cite the SDK line — or the plan must do the merge. Spec §"Mergeable config" mandates it.
5. **Compaction / generateBranchSummary error path has no test.** "Compaction throws → status message edits to error string" is not tested. Add a Task 8 test.
6. **`agents/_system/handoff.md` location decision not stated.** Spec allows handoff text in code or in `agents/_system/handoff.md`. Plan keeps it in code — fine, but state the choice in the plan README.
7. **`thinkingLevel` deferral not stated.** Spec defers it; plan does too (no `thinkingLevel` flow). Note the deferral explicitly so reviewers don't go looking for it.

---

## Review-feedback honoring matrix

| Review # | Topic | Status |
|---|---|---|
| 1 | Selective-load tool override | **No** (B2) |
| 2 | Re-author `promptSnippet` / `promptGuidelines` | **Partial** — defined; delivery uncertain (B4) |
| 3 | System prompt = SOUL + tool guidelines, both cacheable | **Partial** (B4) |
| 4 | Per-user runtime lifecycle | **Yes** |
| 5 | Pi sessions under `agentDir` | **Yes** (modulo B6 verification) |
| 6 | `/tree` ASCII glyphs, numeric `[N]`, server-side mapping | **Partial** (M1, M2, M3) |
| 7 | Typing indicator + `/compact` carve-out | **Yes** |
| 8 | Reply splitting + HTML parse mode | **Yes** |
| 9 | Attachment scope | **Yes** |
| 10 | `/cancel` for MVP | **Yes** |
| 11 | Non-private chats silently ignored | **Yes** |
| 12 | Unregistered users — no work, no download | **Code yes, no test** |
| 13 | Admin = OOB shell access | **Yes** (README) |
| 14 | Single-process assumption | **Yes** |
| 15 | Atomic `state.json` via tmp + rename | **Yes** |
| 16 | Audit log: single writer, append, no rotation | **Yes** but no SIGTERM flush (M8) |
| 17 | Concrete `agent.json` example, reject unknown/`bash` | **Yes** |
| 18 | Default agent bundle | **Yes** |
| 19 | `TELEGRAM_BOT_TOKEN`, fail-to-start | **Yes** |
| 20 | `thinkingLevel` decide or defer | **Defer (state it)** |
| 21 | First-run scaffold = empty `{}` files | **Yes** |
| 22 | Handoff post-cache via `before_provider_request`, fixed text | **No** (B3) |

---

## Strengths worth preserving

- File decomposition is clean; channel-agnostic core is properly separated from the `telegram/` adapter.
- Test-first cadence is consistent across every code task.
- Atomic `state.json`, append-only audit log, flow-token TTL — all match the spec's reliability/security posture.
- Path policy uses `realpath` and tests the symlink-escape case explicitly.
- `agent-loader` rejects `bash` and unknown tools at load time — review item #17 honored well.
- Reply splitter correctly handles fenced code blocks; the test is meaningful.
- Per-user serialized operation queue is implemented and matches the spec's concurrency model.
- Lazy home scaffolding with empty `{}` settings files matches review item #21 cleanly.
- Telegram router uses discriminated unions for flow kinds — readable and testable.

---

## Bottom line

Six blockers (B1-B6) are wrong API names or wrong architectural choices that will surface as compile failures, security holes, or invalid provider payloads. Fix those first. Then address M1-M8 and the spec coverage gaps above. The rest is polish — proceed.

The fastest path to "ready to execute": resolve B1 + B2 + B6 together by reading the installed SDK source under `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/dist/` for the actual `createAgentSession` / `createAgentSessionFromServices` signatures and the runtime's session-rebinding surface. Most of the remaining issues fall out cleanly once those three are right.
