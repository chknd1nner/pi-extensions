# Delegate tools: lazy tool-loading refactor findings

**Date:** 2026-07-16
**Status:** Research complete; refactor not yet scoped or approved (opt-in, upside-only)
**Observed with:** Pi `@earendil-works/pi-coding-agent` 0.80.7 (Dynamic Tool Loading), `pi-delegate-driven-development` bundle (`extensions/delegate`, `extensions/tickets`)
**Related:** `docs/superpowers/research/2026-07-16-delegate-check-automatic-turn-prompt-cache-findings.md`, `docs/superpowers/plans/2026-07-16-replace-prompt-provider-fallback.md`

## Executive summary

Pi 0.80.7 adds **Dynamic Tool Loading**: an extension keeps a small set of tools active and lets a loader tool add more mid-run via `pi.setActiveTools([...additive])`. On models with native deferred loading (Anthropic ≥ 4.5 non-Haiku; OpenAI `gpt-5.4`+) the new schemas anchor at the tool-result position, preserving the cached prompt prefix. On other models Pi resends the full active tool list, invalidating the cached prefix once.

The delegate bundle currently registers **all** tools statically and active from startup, and **never calls `setActiveTools()`**. That is cache-safe today: every tool's schema and prompt metadata is baked into the initial prefix and never moves. There is no bug to fix.

This report evaluates whether the delegate toolset is a good candidate for a *future, opt-in* lazy-loading refactor, and if so, what the migration would touch. Conclusion: the toolset already has a favorable hub/satellite shape, so the refactor is low-risk and mostly mechanical, but its payoff is modest and should be gated on evidence that the delegate tool schemas materially cost prefix tokens or cache churn in real sessions.

## Background: why the feature matters for cache

A provider caches a **prefix** of each request: system prompt + tool definitions + leading conversation. A cache hit requires that prefix to be byte-identical to a previously seen one.

Three fields that are easy to conflate have very different prefix consequences:

| Field | Lives in | Effect when it changes |
|---|---|---|
| `description` | the tool definition (`tools[]` array) | changes the **tools block** only |
| `promptSnippet` | the **system prompt** ("Available tools" section) | rebuilds the **system prompt** (front of prefix) |
| `promptGuidelines` | the **system prompt** ("Guidelines" section, only while active) | rebuilds the **system prompt** (front of prefix) |

Key consequence for lazy loading: adding a deferred tool that carries **only** `description` is cache-cheap (schema slots in at the tool-result position on native models). Adding a deferred tool that also contributes `promptSnippet`/`promptGuidelines` forces a **system-prompt rebuild from token 0**, invalidating the prefix even on native models. Pi's own guidance: *lazily loaded tools should rely on their `description` and omit active-only prompt metadata.*

## Current delegate tool inventory

Source: `packages/pi-delegate-driven-development/extensions/delegate/index.ts`, `.../extensions/tickets/index.ts`. Confirmed via `rg`: **no `setActiveTools()` calls anywhere in `packages/`.**

### `extensions/delegate`

| Tool | `promptSnippet` | `promptGuidelines` | Notes |
|---|---|---|---|
| `delegate_start` | yes | yes (9 bullets) | orchestration hub; carries cross-tool workflow guidance |
| `delegate_anchor` | no | no | description-only |
| `delegate_pack` | yes | yes (3 bullets) | called pre-dispatch |
| `delegate_check` | no | no | description-only |
| `delegate_steer` | no | no | description-only |
| `delegate_abort` | no | no | description-only |
| `delegate_result` | no | no | description-only |

### `extensions/tickets`

All ticket tools (`ticket_shard`, `ticket_list`, `ticket_show`, `ticket_move`, `ticket_set`, `ticket_next`, `ticket_get`) carry a short `promptSnippet` and **no** `promptGuidelines`.

## Findings

### F1 — Current static registration is cache-safe

Because all tools are active from startup and nothing calls `setActiveTools()`, prompt metadata is contributed exactly once, up front, and remains in the stable prefix for the whole session. This is the cache-friendly pattern, not the hazardous one. No action is required for correctness.

### F2 — Guideline authoring is mostly compliant

Pi appends `promptGuidelines` flat into the Guidelines section with no tool-name prefix, so each bullet must name its tool. In `delegate_start`, bullets 1, 3, 5, 6, 7, 8 name concrete tools; three bullets are declarative context/constraints rather than tool-selection instructions ("The worker runs as a separate Pi process…", "Prefer running details.watch.command…", "Maximum 2 concurrent workers…") and are acceptable, though "Prefer running details.watch.command…" could name `delegate_start` for clarity. `delegate_pack` bullets all reference concrete tools.

### F3 — Some single-tool how-to sits in guidelines that would travel better in `description`

Migration candidates if the tool is ever deferred:

- `delegate_start` bullet 1 (what the tool is for) and bullet 3 (its return shape / `details.watch.command`) → `description`.
- `delegate_pack` bullets 1–2 (freeze spec/plan; immutability + `overwrite` semantics) → `description`.

The remaining bullets are genuine **cross-tool orchestration** (the `delegate_check`→`delegate_result` handshake, `delegate_steer`/`delegate_abort`, `delegate_pack` + `context_pack`) and legitimately belong in the Guidelines section attached to the always-active hub.

### F4 — The toolset already has a hub/satellite shape favorable to lazy loading

- **Natural always-active hub:** `delegate_start`. It is the entry point and carries the cross-tool workflow narrative, so keeping it active keeps orchestration guidance in the stable prefix.
- **Ready-made deferred satellites:** `delegate_check`, `delegate_steer`, `delegate_abort`, `delegate_result` are already `description`-only. They are ideal deferred tools: their schemas can slot in at the tool-result position with zero system-prompt rebuild.
- **One snag:** `delegate_pack` carries `promptSnippet` + `promptGuidelines`. If deferred, fold bullets 1–2 into `description` and drop the snippet, or simply keep it active (it is called early, before dispatch).

## Proposed refactor (design sketch, not yet approved)

1. **Keep active from startup:** `delegate_start` (hub, with orchestration `promptGuidelines`), `delegate_anchor`, and `delegate_pack` (early-use). Optionally keep `tickets` tools active — they are workflow-driving and low in count.
2. **Defer:** `delegate_check`, `delegate_steer`, `delegate_abort`, `delegate_result`. These become inactive at `session_start` and are activated by the hub the first time a worker is actually spawned (i.e., inside `delegate_start.execute`, call `pi.setActiveTools([...active, "delegate_check", "delegate_result", "delegate_steer", "delegate_abort"])`, additive only).
3. **Metadata hygiene:** ensure every deferred tool is `description`-only; move any `promptSnippet`/`promptGuidelines` content into `description` (F3).
4. **Additivity invariant:** never remove currently active tools in the same `setActiveTools()` call; removals fall back to full-list resends and defeat the purpose.

### Activation trigger options

- **On first dispatch (recommended):** activate the monitoring satellites inside `delegate_start.execute` after a worker is successfully spawned. Simple, deterministic, and the model only sees `delegate_check`/`delegate_result` once they are relevant.
- **Via a dedicated loader tool:** a `delegate_tools`/`search_tools`-style loader. Overkill for a fixed, small satellite set; adds a round-trip.

## Migration checklist (per tool)

- [ ] `delegate_start`: move bullets 1 and 3 into `description`; keep cross-tool bullets as `promptGuidelines`; add the additive `setActiveTools()` call after successful spawn.
- [ ] `delegate_pack`: decide keep-active vs defer; if deferred, fold bullets 1–2 into `description` and drop `promptSnippet`.
- [ ] `delegate_check` / `delegate_steer` / `delegate_abort` / `delegate_result`: confirm `description` is self-sufficient; set inactive at `session_start`.
- [ ] `session_start`: compute the initial active set (built-ins + other extensions' tools + delegate hub set), preserving tools owned by other extensions.
- [ ] Tests: assert the initial active set excludes the satellites; assert a successful `delegate_start` makes the additive change; assert no `setActiveTools()` call ever removes a previously active tool.

## Interaction with the replace-prompt provider-fallback fix

`replace-prompt` restores the transformed **system prompt** at a learned provider-payload path. It watches the system-prompt region, not the `tools[]` block.

- Deferring `description`-only satellites (the recommended set) **does not touch** the learned path → replace-prompt is unaffected and keeps repairing across post-tool continuations.
- Only a deferred tool carrying `promptSnippet`/`promptGuidelines` would rebuild the system prompt mid-run and make replace-prompt's recorded transformation go stale (it fails open with one `provider prompt path was stale` log, then re-establishes on the next normal `before_agent_start`).

Therefore the metadata-hygiene step (F3 / checklist) is what keeps the two features cleanly composable. This is captured as a documentation caveat in the replace-prompt plan (Task 5, usage guide, "Dynamic tool loading").

## Risks and non-goals

- **Payoff is modest.** The delegate satellite schemas are small; deferring them saves few prefix tokens. Do not undertake this for its own sake.
- **Non-native models see a one-time prefix recompute** on first activation regardless; only native models get the anchored, no-rebuild behavior.
- **Non-goal:** removing tools mid-run or dynamic search/discovery. The satellite set is fixed and known.
- **Regression surface:** the additive-only invariant and the `session_start` initial-set computation are the two places a bug would silently defeat caching or hide tools.

## Recommendation

Treat this as **opt-in, evidence-gated cleanup**, not a required change. Proceed only if real-session measurement shows the delegate tool schemas cost meaningful prefix tokens or provoke cache churn. If undertaken, do it together with the F3 metadata move so the deferred satellites are `description`-only, keeping the replace-prompt fix cleanly composable. Until then, the current static registration is correct and cache-safe.
