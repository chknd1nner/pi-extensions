# pi-memory-ledger — Design Specification v0.1

**Working title:** pi-memory-ledger (formerly pi-session-context)  
**Status:** Initial engineering draft — 21 October 2026  
**Target:** Pi 0.87.1+ / current Pi 1.x, TypeScript extension  
**Scope:** One active Pi session and its branches; cross-session memory deferred  
**Principal idea:** *The working agent proposes memories. An auditor reconciles them against evidence and all prior memories. Compaction deterministically materialises the current state of knowledge.*

---

## 1. Product vision

A user converses naturally with a Pi agent. At moments it considers meaningful, the agent silently calls `remember` to propose a concise, self-contained memory. The proposal is audited against the original conversation and the entire existing session-memory ledger. The auditor may confirm it, correct it, merge it, qualify it, identify a contradiction, or change the status of an earlier memory. The operator sees an unobtrusive **[Memory saved]** acknowledgement after a successful commit, not a verbose tool call.

At a manual or configured automatic compaction boundary, the extension builds a new context **deterministically** from the ledger's current effective state, without another LLM summarisation request. Original session messages, tool results, memory proposals, audit decisions, and reconciliation events remain append-only and inspectable. The model can retrieve the underlying evidence on demand without navigating `/tree`.

A memory is **not** necessarily a completed task. It may concern an insight, a changing understanding, a hypothesis, a correction, a user preference, a decision, a useful dead end, or an open question. Conversations, brainstorming, learning, research, and coding are equal citizens.

## 2. Goals and non-goals

### Goals (v0.1)

- Model-initiated memory proposals via a simple `remember` tool, with no mandatory task-boundary semantics.
- First-class **audit and cross-memory reconciliation for every committed memory**.
- Audit access to **every earlier memory on the active branch**, including superseded, retired, and disputed records, plus targeted raw evidence.
- Independently track whether a claim is supported and whether it is still applicable.
- Maintain an append-only, branch-aware, recoverable knowledge ledger in Pi's session JSONL.
- Deterministic compaction from audited memory, with no inference at compaction time.
- Preserve uncovered/unfinished work and decline unsafe compactions rather than silently lose it.
- Model-callable, source-accurate, bounded retrieval of raw messages/tool results using Pi entry IDs.
- Low-noise TUI and Radius/RPC presentation; useful status, inspection and diagnostics commands.
- Same-model auditing by default, optional separate model/provider; no dedicated model requirement.

### Non-goals (v0.1)

- Cross-session, workspace-wide, or global memory; semantic vector search; embeddings.
- Automatically saving every conversation turn or periodically summarising without model intent.
- Guaranteeing that source context or historical provider KV caches survive compaction.
- Modifying the original message content, deleting historical evidence, or rewriting existing memory records.
- Invisible autonomous changes to the user's actual files or decisions.
- Relying on an auditor's opinions as independent proof of external-world truth.

## 3. Non-negotiable invariants

1. **Evidence is immutable.** Never rewrite or delete original Pi session entries; all state transitions are appended.
2. **Proposal ≠ memory.** Only a committed, audited reconciliation is eligible for compaction. Pending or failed proposals are not authoritative.
3. **Audit is holistic.** Every audit reviews the current proposal against the entire prior memory index, including inactive history. It may retrieve the supporting raw entries of any implicated memory. An incomplete scan cannot claim a complete audit.
4. **Status is not truth.** `verified` and `active` are separate dimensions; a once-verified decision can later be superseded without becoming false.
5. **Conflicts are explicit.** Recency alone never resolves factual disagreement. Unresolved contradictions remain visible and carry both sides.
6. **Compaction is pure.** For identical session branch entries, configuration and cut point, the renderer must produce byte-identical compaction content and metadata, without calling an LLM.
7. **No silent loss.** A compacted-away span must be covered by an audited checkpoint, or be preserved verbatim in Pi's retained tail. Failure to satisfy the condition blocks memory-based compaction.
8. **Source-first retrieval.** All carried memories and reconciliation operations have usable source references. A model can request precise original evidence rather than trusting a paraphrase.
9. **Branch locality.** Events from an abandoned `/tree` branch do not silently become authoritative on another branch.
10. **Fail closed, recover explicitly.** A partial audit, corrupted record, unavailable provider, or over-budget ledger must not fabricate success.

## 4. User experience

### Normal conversation

```
User: We originally considered WebSockets, but SSE is simpler.
      Let's use SSE for the event stream.

Agent: Agreed. We'll use SSE and retain the relay's existing
       authentication boundary.
       ✓ Memory saved
```

The visible acknowledgement is tied to **successful audit commit**, not merely invocation of `remember`.

### Compacting

```
[Compacting]
[Context compacted · 9 active memories · 2 superseded · 1 unresolved]
```

Compaction may be initiated via native `/compact`, Pi's threshold policy, or an overflow-recovery hook, subject to configuration and safety checks. Any claim about exact placement *beneath* the final assistant response in TUI/Radius is a UI integration requirement, not something guaranteed by a generic hidden custom-entry flag.

### Inspecting and controlling

Proposed commands (namespace and details to be confirmed during implementation):

- `/memory status` — active/pending/disputed counts, audited coverage, safe compactability, last fold, rough context budget.
- `/memory list [all|active|disputed|pending]` — concise ledger timeline.
- `/memory show <id>` — current claims, audit, history, and references.
- `/memory compact` — invoke the native compaction path with this extension's policy, or use native `/compact`.
- `/memory audit <id>` — re-audit a record and reconcile all prior memories, without rewriting it.
- `/memory mode [on|off]` — opt-in/opt-out without mutating global Pi settings.

## 5. Model-facing tools

### `remember({ memory: string })`

Keep the primary interface deliberately small; no user-supplied source IDs, categories, confidence percentages, or supersession IDs.

**`promptSnippet`**

> `remember` — Save meaningful discoveries, decisions, evolving ideas, corrections, preferences, and open questions for later context compaction; an auditor verifies and reconciles them with earlier memories.

**Description**

> Propose a focused, self-contained memory about something meaningful established or changed in the conversation. Use for coding, research, brainstorming, learning, or ordinary discussion; a completed task is not required. Include what happened or was established, why it matters, and any important uncertainty or unresolved question. Distinguish user decisions from your suggestions, observed evidence from interpretation, and confirmed findings from hypotheses. A separate audit will compare this proposal against the original conversation and all earlier memories, resolving refinements, contradictions, duplication and supersession. Do not manage entry IDs or earlier memory statuses. Do not remember every exchange; call only when the conversation's useful knowledge has changed meaningfully.

**`promptGuidelines`**

1. Remember salient developments as they happen; do not wait for a task to end.
2. Be precise about epistemic status: observed, user-decided, suggested, assumed, disputed, or open.
3. Prefer focused memories containing independently verifiable claims; do not capture trivial chit-chat or repetitive paraphrases.
4. Do not claim tests passed, decisions were final, or facts were verified unless the conversation supports that claim.
5. You may propose a revision of earlier thinking without identifying an earlier memory; reconciliation is the auditor's responsibility.

**Tool result:** small machine-readable acknowledgement with candidate/committed memory ID and status; TUI renderer hides the proposal body and displays a subtle status indicator. The raw Pi assistant tool-call arguments and result remain in the source transcript even if the UI hides them. They still count toward model context until compaction; v0.1 does not use per-unit `context_edit` to erase them and thereby invalidate cached prefixes.

### `memory_recall({ id, view?, anchor?, cursor?, limit? })`

Read-only tool. `id` is an opaque memory or source ID. `view` may be `memory`, `audit`, `source-outline`, or `source-raw`; defaults to `memory`. For raw source, provide bounded output, pagination by source-entry ID, and optional exact-text windowing. Return source IDs, speaker/tool type and truncation notice on every chunk. Do not reduce a supposedly raw tool output to a paraphrase without labelling the reduction; support exact bytes for requested text ranges when feasible. Binary/image payloads require a separate media interface, not fake text.

## 6. Data model: append-only ledger

Store records as Pi `custom` session entries, e.g. `customType: "pi-memory-ledger"`. Pi's `custom` entries do not enter model context; their current state is obtained by replaying *active-branch* entries, not by scanning all file records indiscriminately.

### Proposed events

- `memory.proposed`: candidate ID, raw model text, proposal time, evidence window start/end Pi entry IDs, working branch information, schema version.
- `memory.reconciled`: **single logical commit** with auditor version/model, verdict, normalized memory/claims, evidence references, applied status deltas, audit coverage interval and rationale.
- `memory.audit_failed`: candidate ID and explicit failure reason; never treated as committed.
- `memory.reaudited`: later authoritative reconciliation of an existing memory/claim and any related memories.
- `memory.compacted`: successful compact checkpoint/cut metadata (also included in Pi compaction `details`); no duplicate user-visible memory.
- `memory.policy`: configuration changes that must follow the branch, if/when needed.

Only `memory.reconciled` or `memory.reaudited` changes effective memory state. Construct candidate and event IDs with collision-resistant identifiers; use Pi entry IDs for source positions, not ordinal offsets.

### Candidate (illustrative)

```json
{
  "v": 1,
  "kind": "memory.proposed",
  "candidateId": "p_a91...",
  "text": "We chose SSE over WebSockets for the event stream...",
  "source": {"afterEntryId": "...", "throughEntryId": "..."}
}
```

### Atomic reconciliation (illustrative)

```json
{
  "v": 1,
  "kind": "memory.reconciled",
  "candidateId": "p_a91...",
  "memoryId": "m_007",
  "audit": {"verdict": "supported", "coverage": "complete", "model": "provider/model"},
  "claims": [
    {
      "claimId": "m_007/c1",
      "text": "SSE was selected for the event stream.",
      "verification": "verified",
      "lifecycle": "active",
      "evidenceEntryIds": ["...", "..."]
    }
  ],
  "mutations": [
    {"targetClaimId": "m_003/c1", "action": "supersede", "byClaimId": "m_007/c1", "reason": "User explicitly changed transport choice", "evidenceEntryIds": ["..."]}
  ],
  "coverageThroughEntryId": "..."
}
```

This is a **proposed schema**, not Pi's native format; the actual Pi `custom` entry supplies `id`, `parentId` and timestamp.

### Two independent claim dimensions

**Verification**: `verified | plausible | unverified | disputed | refuted`.

**Lifecycle**: `active | superseded | retired | retracted`.

A claim can be verified-but-superseded, unverified-but-active, or disputed-but-active. An auditor may add graph relations such as `supports`, `qualifies`, `contradicts`, `supersedes`, `partially-supersedes`, and `duplicates`; the ledger reducer must validate references and avoid silent deletion. The claim/memory distinction prevents one changed sentence from retiring an entire multi-claim memory.

## 7. Audit and reconciliation protocol

### Trigger

Every `remember` call writes a proposal, then runs a mandatory audit before acknowledging a committed memory. Default **synchronous audit**: the memory tool awaits the audit and persistence of the reconciliation commit. This is a deliberate v0.1 trade-off: correctness and clear UX versus latency. A queued/background mode is a later feature; it must show pending status rather than claiming success early.

### Auditor context

The audit input contains:

1. Candidate memory exactly as the working agent wrote it.
2. The raw, ordered source messages/tool calls/results in the candidate's evidence interval; include provenance and truncation markers.
3. The **entire previous memory ledger index** on the active branch, including current verification/lifecycle states, supersession edges, retired records and unresolved disputes. The index can be compactly rendered but may not silently omit history.
4. A read-only evidence retrieval capability for the raw source of any earlier implicated memory.
5. Explicit rules for user versus agent attribution, uncertainty, contradictions and time-varying decisions.

Default to the **same underlying model** as the working agent, in a separate audit inference context. Permit a configured alternative model/provider. Do not modify shared global Pi settings to launch an audit; audit is read-only and runs with strictly limited capabilities. Protect user privacy: do not silently route private session data to a different external provider.

If the full ledger index cannot fit the audit window, perform documented multi-pass auditing with deterministic partitioning and a final reconciliation pass **or** fail the audit as incomplete. A truncated one-pass ledger is *not* an acceptable successful audit. This is a material v0.1 implementation constraint.

### Audit questions

- Does the raw evidence support each candidate claim? Is it an observation, inference, user decision, agent suggestion, or unresolved hypothesis?
- Are there claims or decisions in the evidence interval that need preservation but were omitted from the proposed memory?
- Does the new memory duplicate, refine, contradict, supersede, qualify or invalidate *any* earlier record?
- Is a change in decision explicit, or merely an alternative being explored?
- Can a conflict be resolved with source evidence? If not, record both sides as disputed and identify what evidence would settle it.
- Are older memories marked obsolete only at the claim level actually affected?
- Is the evidence interval sufficiently reviewed to advance the **audited coverage frontier**?

### Auditor output

Strict structured result with `verdict`, normalized candidate claims, claim-level updates to earlier memories, source references, evidence-gap list, and coverage decision. Verdicts: `supported | corrected | merged | redundant | contested | unverifiable` (reasons required for other-than-supported). The runtime validates IDs, references, scope, schema and supported operations **before** committing. Audit text is untrusted data, not executable instructions.

A rejected/duplicate proposal may produce no new active memory but still commit a reconciliation event if the audit changed earlier states. UI should distinguish `Memory saved`, `Memory updated`, `Memory unchanged`, and `Memory pending/failed`.

### Conflict example

Earlier `m_003/c1`: "Use WebSockets" (verified, active). New evidence explicitly selects SSE. Auditor writes new `m_007/c1` "Use SSE" (verified, active), appends `supersede(m_003/c1, m_007/c1)`, leaves unrelated relay-authentication claims active. If the user only floated SSE as an option, retain the WebSocket decision and store the alternative as exploratory, or flag an unresolved conflict; **never apply last-write-wins to truth**.

## 8. Source coverage and compaction safety

**The difficult part:** a remembered *insight* is not automatically a summary of everything said since the previous memory. Recording one salient fact must not certify that an entire conversation span can be safely discarded.

Define an **audited coverage frontier**: the highest source-entry boundary through which an auditor has reviewed *all intervening relevant conversation*, including tool results, and decided what must survive. It may commit multiple memories, mark nothing salient, or refuse coverage if evidence was incomplete. The frontier advances only on explicit, complete, validated audit decisions. Persist the frontier as event data, so it survives restart and follows the active branch.

At compaction time:

1. Derive Pi's proposed `firstKeptEntryId` from `event.preparation`.
2. Rebuild the current branch-local audited ledger, including previous compactions and status deltas.
3. Check that the whole interval Pi proposes to discard since the last trustworthy checkpoint is covered by committed audit decisions. Proposals alone never count. Raw source beyond the frontier must remain in the retained tail.
4. If coverage is insufficient, move the cut point backwards to the earliest uncovered entry **if** the resulting context fits, otherwise refuse the ledger-based compaction with a clear reason. A deliberate operator fallback to native `/compact` can be offered, but must never be falsely described as fully audited or deterministic.
5. Render the authoritative active and disputed claim set, with current status and evidence pointers; include open questions and materially relevant prior decisions. Omit superseded/retired full bodies from active context, but preserve minimal lineage pointers as needed.
6. Verify projected post-compaction token budget. If all required memories cannot fit, do **not** silently drop active claims: refuse and require reconciliation/retirement or an explicit user-selected degradation policy.
7. Return `CompactionResult` with `summary`, validated `firstKeptEntryId`, `tokensBefore`, optional `estimatedTokensAfter`, and audit/coverage/provenance data in `details`. Do not invoke a model.
8. Confirm `session_compact` success before displaying a successful-compaction acknowledgement.

**Repeated compaction:** the effective ledger is the single source of truth. Do not blindly concatenate `previousSummary` with a fresh memory stack, because it may contain decisions that were subsequently superseded. Import/track any pre-existing non-ledger compaction summary explicitly as legacy context or require an opt-in bootstrap; do not assume it is reconciled.

**Automatic compaction:** use Pi's existing threshold and overflow lifecycle. The extension's choice to intercept must respect Pi's own auto-compaction settings. Avoid global settings mutations or a conflicting independent threshold loop. A memory-based compaction cannot be safe if the required audit is still pending and the cut would lose uncovered content.

## 9. UI and Radius integration

- Custom `remember` tool renderer (`renderCall`/`renderResult`) displays only a short status, not memory text or auditor payload; raw tool arguments remain inspectable in session history/exports.
- In TUI, show a subtle success/pending/error notification. A persistent inline entry under the last agent response may require a custom entry renderer or client-specific handling; avoid claiming `custom` invisibility automatically gives that placement.
- For Radius/RPC, surface the committed custom entry or an extension notification with a stable `memoryId` and `status`; Radius can render `[Memory saved]` as a lightweight annotation on the relevant assistant turn, with click-through details later.
- During native compaction, show `[Compacting]`; after success, show counts and savings. Never call a memory `verified` if the audit only classified it as plausible or unverified.
- Avoid verbose tool chatter in normal operation. Operator inspection and diagnostic tracing are explicit commands.

## 10. Pi integration map

| Capability | Pi integration |
|---|---|
| Model-initiated memory | `pi.registerTool({ name: "remember", ... })` |
| Persistent, non-contextual memory | `pi.appendEntry("pi-memory-ledger", event)` |
| Model-initiated retrieval | `pi.registerTool({ name: "memory_recall", ... })` |
| Current branch state | `ctx.sessionManager.getBranch()` and entry-ID lookups |
| Audit inference | `ctx.modelRegistry.streamSimple()` or equivalent current SDK facility; isolate audit request/context |
| Custom tool presentation | `renderCall`, `renderResult`, `ctx.ui.notify`, registered entry renderer where supported |
| Native compaction override | `pi.on("session_before_compact", ...)` returning `{ compaction: CompactionResult }` |
| Compact success/failure | `session_compact`, `session_compact_failed` |
| Session reconstruction | `session_start`, rebuild reducer from active branch |
| Process lifetime | `session_shutdown`, cancel pending audit, preserve recoverable proposal |
| Pi client transport | Extension events/custom entries; Radius adapts display |

Pi's `custom` entries are *not* included in the model's message projection. They are suitable for the ledger, while model-visible active memory is carried in the compaction summary. A separate `custom_message` would enter the prompt and is not required for ordinary memory writes. Pi's `context_edit` is **not** used for routine v0.1 memory formation: changing an old projected message can invalidate prompt-prefix caching despite preserving append-only raw history.

## 11. Configuration (proposed)

```json
{
  "enabled": true,
  "auditor": {
    "provider": "same-as-session",
    "model": "same-as-session",
    "mode": "synchronous",
    "timeoutMs": 120000,
    "onFailure": "retain-pending"
  },
  "compaction": {
    "strategy": "audited-ledger",
    "interceptManual": true,
    "interceptAutomatic": true,
    "onUnsafeCoverage": "refuse",
    "maxSummaryTokens": 20000,
    "respectPiKeepRecentTokens": true
  },
  "retrieval": {
    "defaultMaxChars": 8000,
    "allowRawSources": true
  },
  "ui": {
    "compactNotifications": true,
    "showMemoryBodyByDefault": false
  }
}
```

Values are **initial proposals**, not confirmed Pi setting names or benchmark-tuned defaults. Configuration must specify the data-sharing implications if a separate remote auditor is selected.

## 12. Failure, concurrency and security

- **Audit timeout/crash:** retain `memory.proposed` and append `memory.audit_failed`; no active-memory commit; user sees failure/pending. Optional retry later is explicit and idempotent.
- **Crash after successful audit, before commit:** replay treats proposal as pending; rerun or resume. The reconciliation event is a single append-only logical transaction.
- **Multiple `remember` calls in one turn:** serialize reconciliation commits against a versioned ledger snapshot. Reject stale audits and rerun against newer state; do not lose supersession updates.
- **Multiple Pi processes or Radius clients:** Pi session file concurrency needs an explicit policy: v0.1 single active writer per session or a tested append/locking strategy; never assume arbitrary concurrent append is safe.
- **Tree navigation:** replay branch-local state and coverage; do not make memories from abandoned sibling branches active without an explicit merge process.
- **Compaction while audit runs:** ensure no uncommitted proposal is counted toward coverage; coordinate with any compaction event without waiting indefinitely or deadlocking Pi.
- **Foreign compaction extensions:** detect competing `session_before_compact` implementations where possible and warn/refuse rather than stack incompatible takeovers.
- **Untrusted tool outputs / prompt injection:** auditor sees source records as data, not instructions. Disallow dangerous tools or autonomous file/network writes in its context. Strictly validate JSON and permitted update operations.
- **Privacy:** memory data and raw source can contain secrets; avoid logging them, do not send to unexpected audit providers, avoid embedding file contents in UI notifications.
- **Audit reliability:** the same model re-checking its own summary is a consistency check, not an independent guarantee. Measure and label evidence support; support cross-model audits later.

## 13. Acceptance tests

1. **Conversation memory:** a brainstorming exchange produces a useful tentative idea without any completed task; memory audit preserves tentative wording and source references.
2. **Decision revision:** an explicit WebSockets → SSE user decision supersedes only the transport claim and keeps the authentication claim active.
3. **False memory proposal:** agent claims nonexistent passing tests; auditor rejects/corrects claim from recorded tool output; status and evidence remain traceable.
4. **Unresolved contradiction:** two claims conflict without deciding evidence; both become disputed; no arbitrary newest-wins selection.
5. **Memory duplication:** near-identical proposal is merged/redundant; context does not accumulate needless duplicates.
6. **Cross-history audit:** a new proposal can update a superseded memory and a currently active memory, demonstrating access to all prior records.
7. **Recovery:** restart after proposal but before commit leaves it pending; no phantom `[Memory saved]`, no unauthorized coverage advance.
8. **Repeatability:** same branch snapshot and cutoff produce byte-identical compaction summary (including deterministic claim ordering).
9. **No LLM at fold:** instrument provider calls and prove none occur inside memory-based compaction hook.
10. **Coverage hole:** no memory audit covers a to-be-discarded interval; extension retains it, adjusts cutoff, or refuses—never silently discards.
11. **Over-budget ledger:** summary exceeds configured cap; compaction fails safely and names offending constraints.
12. **Raw retrieval:** retrieve exact original source excerpts by entry ID, even after compaction, with reliable pagination/truncation markers.
13. **Branch isolation:** `/tree` to a prior entry does not inherit future-branch memory claims; source retrieval remains possible by explicit ID when permitted.
14. **Cache instrumentation:** storing a memory does not inject/replace historical model-visible messages; compaction may cause expected KV-prefix re-prefill.
15. **TUI/RPC parity:** memory statuses and errors are accessible in Pi TUI and Radius; hidden memory bodies do not leak into routine screen output.
16. **Concurrent writes:** two proposals or a proposal plus compaction do not produce partial, reordered, or contradictory commits.

## 14. Suggested implementation slices

**Slice A — Event store and inspection:** schema, append-only session events, active-branch reducer, typed validation, `/memory status/list/show`, source-range extraction, unit tests.

**Slice B — Model memory + mandatory audit:** `remember`, same-model audit request, full-ledger reconciliation, atomic commit, provenance, failures/retry, small UI acknowledgement.

**Slice C — Deterministic compaction:** audited-coverage tracking, renderer, Pi `session_before_compact` interception, budget gates, repeatability and no-provider-call tests.

**Slice D — Raw retrieval and Radius polish:** `memory_recall`, exact source/anchor/pagination, RPC events and Radius annotation, audit review UI.

Slices are implementation order only; **do not ship a v0.1 that commits memory without auditing**. Slice B is a prerequisite for user-facing memory creation.

## 15. Open decisions for v0.2 discussion

1. **Audited coverage:** should `remember` audit only the proposed fact and source span, or explicitly review *everything* since the last coverage frontier? This draft requires the latter for advancing coverage, but that can increase audit cost.
2. **Audit resource policy:** synchronous same-model audit avoids a separate model but may contend with local inference/KV caches; determine operational timeouts and interruption semantics.
3. **Atomic claim granularity:** one `remember` proposal may produce one or several claim records; evaluate prompt burden, audit complexity and partial supersession fidelity.
4. **Historical ledger growth:** eventually every prior memory may exceed the audit model's context; design trustworthy multi-pass reconciliation or an audited index hierarchy without silent omission.
5. **Legacy sessions:** explicit import/bootstrap of sessions already compacted natively before installation, versus fresh-session-only guarantee.
6. **Compaction under hard overflow:** formalise safe refusal/recovery when retaining all uncovered text still exceeds the model window.
7. **Branch merges:** whether and how to reconcile memories across sibling branches without merging unrelated conversations.
8. **Retention and deletion policy:** user privacy, session exports, explicit redaction requests, and the distinction between logical retirement and actual removal of sensitive raw data.

## 16. Source references

- [Pi extension APIs](https://pi.dev/docs/latest/extensions)
- [Pi session file format (CustomEntry, ContextEditEntry, CompactionEntry)](https://pi.dev/docs/latest/session-format)
- [Pi compaction reference and `session_before_compact`](https://pi.dev/docs/latest/compaction)
- [Pi session manager source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)
- [Pi extension event and tool types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- [SAM reference](https://github.com/LePrau/pi-self-aware-memory)
- [POM reference](https://github.com/elpapi42/pi-observational-memory)
- [Blackhole reference](https://github.com/k0valik/pi-blackhole)

---

**Guiding principle:** The working model decides what might matter. The auditor decides what the evidence supports and how the existing knowledge changes. The extension deterministically preserves the resulting knowledge across context compaction. The original transcript is always the source of truth.