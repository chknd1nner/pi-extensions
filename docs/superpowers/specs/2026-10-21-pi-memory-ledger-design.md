# pi-memory-ledger — Design Specification v0.3

**Working title:** pi-memory-ledger (formerly pi-session-context)  
**Status:** Revised engineering draft — 27 October 2026  
**Target:** Current Pi coding-agent extension APIs, TypeScript  
**Scope:** Intra-session continuity across context compactions and branches; cross-session continuity is an architectural extension, not a v0.3 delivery goal  
**Principal idea:** *A compaction is a miniature session restart. Maintain living, dynamically organised knowledge documents; preserve every change and its evidence in an append-only history; reconstruct the useful current state at context boundaries.*

**Revision history:** v0.1 introduced audited memories and deterministic compaction; v0.2 added the passive Session Activity Ledger; v0.3 changes the primary memory abstraction from an accumulating collection of audited claims to a versioned set of editable Markdown blocks, governed by a dynamic manifest and YAML templates. Previous versions remain in Git history.

---

## 1. Product vision

The working agent and user gradually build a useful understanding of the current session. The representation is not a sequence of ever-growing summaries. It is a small, editable, evolving collection of Markdown memory blocks: current project decisions, constraints, hypotheses, user preferences, outstanding questions, and whatever other subjects prove useful.

The subjects are **not hard-coded**. The agent and user can create, rename, split, merge, reorganise, and retire blocks or sections. YAML templates describe a suggested Markdown structure and instructions for maintaining a particular type of block. Templates themselves can evolve. A versioned manifest lists the available blocks and their loading policies, including blocks not currently included in context.

The agent normally **edits existing knowledge instead of appending another observation**. Changes are audited against current relevant knowledge and original source evidence, and committed as atomic, append-only changesets in the Pi session. The materialized documents can be reconstructed at any point along an active branch. Historical states, the evolution of the organisational scheme, and exact raw evidence are retrievable on demand.

Compaction is a miniature session restart: materialize the current manifest and selected blocks, preserve working context and activity, and establish a fresh model context **without inference at compaction time**. Cross-session loading would use substantially the same projection machinery with a different persistence boundary.

A memory need not describe a completed task. Brainstorming, changing understanding, provisional decisions, research, ordinary conversation and implementation work all count.

## 2. Goals, non-goals, and guarantees

### Goals

1. Maintain a **living current-state knowledge base** with concise, editable Markdown blocks.
2. Let the user and agent choose **arbitrary categories and block names**, without fixed operator/project/family/pets schemas.
3. Keep a small, always-discoverable **manifest** describing blocks, stable IDs, summaries and load policies.
4. Define and evolve **YAML memory templates** containing suggested Markdown headings and block-specific editing instructions.
5. Prefer **edit > append**; consolidate superseded understanding in the active document rather than preserving every previous wording in context.
6. Audit proposed content and structural edits against exact source evidence and **relevant current blocks**, with historical investigation when challenged.
7. Version changes to block contents, manifest, templates, block identities and organisation in a **branch-aware append-only ledger**.
8. Preserve source-accurate, bounded retrieval of session messages, tool results, past versions, and audit decisions.
9. Certify conversation-span coverage **separately** from saving individual memories; refuse unsafe deterministic compaction instead of claiming that a single remembered fact covers a whole interval.
10. Rebuild memory and activity **deterministically** during compaction, with no model call at the folding boundary.
11. Support selectively loaded blocks and **cache-aware, append-only in-session visibility** where model/provider/Pi capabilities allow it.
12. Carry forward v0.2's deterministic passive **Session Activity Ledger**.

### Non-goals for v0.3

- Cross-session synchronisation, a global personal-memory database, Git repository mirroring, multi-agent shared memory, or automatic branch merging.
- Mandatory embeddings, vector search, an always-on background summariser, or an external memory database.
- Requiring every memory paragraph to be decomposed into a permanent graph of structured claims.
- Guarantees of perfect recall, perfect auditor judgment, perfect semantic coverage, or prompt-cache hits on every provider.
- Rewriting historical Pi entries; declaring that logical retirement is equivalent to secure erasure.
- Inferring arbitrary shell/subprocess file effects as verified activity.

### Distinct guarantees

**Durability** means committed changes and their provenance can be replayed from the active Pi session branch.

**Reconciliation** means a proposed edit was checked against its evidence and retrieved relevant current knowledge; it does *not* mean every historical memory was exhaustively scanned.

**Coverage** means the specified source interval was deliberately reviewed and assigned a preservation/discard decision; it is a best-effort semantic assessment, **not a mathematical proof** that nothing important was omitted.

**Determinism** means the extension renders an identical context for identical committed branch state, configuration, and selected compaction cut. It does not mean the earlier model-produced judgments were deterministic.

**Cache preservation** means the extension avoids rewriting an otherwise unchanged prefix where the provider allows it. Actual cache eligibility, expiry, placement, cost and hit rate remain provider-dependent.

## 3. Non-negotiable invariants

1. **Source evidence remains immutable.** Pi's original session transcript and tool results are not edited or deleted by the extension.
2. **Current state is a projection.** Manifest, templates and blocks are derived from validated, append-only changesets; materialized files or snapshots are caches, not competing authorities.
3. **Stable identity beats filename.** Block IDs and template IDs survive rename and section reorganisation. Split/merge operations preserve lineage.
4. **Every active revision is committed and auditable.** A proposal, draft diff or pending audit is not current knowledge until a validated atomic commit succeeds.
5. **Edits are preferred over append-only prose growth.** Historical wording is recoverable from revisions; active context carries the best current formulation.
6. **Evidence and authority are distinct.** User decisions, hypotheses, observed tool outputs, inferred conclusions and imported documents must not be conflated.
7. **Recent is not necessarily true.** A later source may revise a project decision; a conflicting factual claim may instead require qualification, investigation or an explicit dispute.
8. **The manifest is complete on its branch.** An unloaded block must remain discoverable and retrievable. No silent duplicate block creation after skipping relevant manifest entries.
9. **No surprise authority promotion.** Retrieved/untrusted content does not become system-level instruction merely because it was placed in a memory block.
10. **Coverage is separate from memory edits.** A successfully committed memory edit does not itself certify that every source since the last checkpoint was reviewed.
11. **Compaction is a pure, validated projection.** No auditor or other model call occurs within the compaction hook.
12. **No silently missing active knowledge.** The selected loaded block set and manifest must fit; other committed blocks are explicitly indexed and retrievable, not silently discarded.
13. **Branch locality.** Replay, coverage and activity follow active ancestry, not every entry in the JSONL file.
14. **Failure is visible and recoverable.** Stale revisions, missing evidence, parsing failures, unsafe cuts, conflicts and budget overflow never masquerade as successful writes.
15. **Activity is independently observed.** Successful native file operations are not semantic memories, and cannot advance audited narrative coverage.

## 4. Conceptual architecture: current state and history

The v0.3 model has five components.

### 4.1 Manifest (always discoverable)

The **manifest** is a small, versioned, first-class document or logical projection describing what memory exists. Its role comes from the user's prior Git-backed design, which injected a manifest even when some category documents were not always loaded.

Proposed manifest fields:

- Stable block ID, current human-readable title and current logical path.
- Short description, keywords/topic hints and optional relationships to other blocks.
- Load policy: **core** (normally loaded), **on-demand** (indexed, retrievable), or **inactive** (retired but historical).
- Template ID/version, current content revision, byte/token estimates, and optional priority.
- Optional lineage and aliases for previous names.
- A registry of available templates and the manifest schema version.

Load policy is not a category. Any user-defined category can be core or on-demand. Only the manifest's *role* is special; its headings and presentation may evolve within validated schema limits.

A manifest can be rendered as Markdown for the model, while storing its canonical registry as a validated object for deterministic lookup. This prevents free-form prose edits from accidentally making a block invisible.

### 4.2 YAML templates (editable policies)

Templates are **user- or agent-authored YAML artifacts**. They contain suggested Markdown structure and natural-language usage hints, not hard-coded application categories. Example:

~~~yaml
id: tmpl-project
name: Project knowledge
description: "For a project whose decisions evolve over time"
markdown: |
  # {title}

  ## Current understanding

  ## Decisions and rationale

  ## Constraints

  ## Open questions

editing:
  instructions: |
    Prefer replacing outdated paragraphs to appending dated observations.
    Reconcile changed decisions in place; preserve meaningful current rationale.
    Keep experiments provisional until adopted or independently verified.
    Preserve unresolved disagreements explicitly.
  prefer_edit_over_append: true
~~~

This is an **illustrative design schema**, not an already implemented Pi interface. Real YAML syntax/escaping, placeholders, fields and validation will be formalised in code. Templates must not contain arbitrary executable code. Template text is editorial guidance, not a way to bypass higher-priority user/developer safety boundaries.

A template can be revised, renamed or retired. An existing block can change templates with an explicit migration plan. No automatic rewrite of all blocks merely because a template changed.

### 4.3 Living Markdown blocks (current knowledge)

A block is a versioned Markdown document with stable identity, template association and evidence-backed revisions. Its current version captures the *present understanding*, rather than concatenating a full chronology.

Example:

~~~markdown
# Transport

## Current decision
Use SSE for the event stream.

## Rationale
Simpler transport requirements for the current client; existing authentication boundary remains.

## Open questions
Reconnect and event replay policy is not decided.
~~~

A later user decision would **edit** the current-decision section. Previous text stays accessible through the append-only ledger and source references, not copied into an ever-longer active file.

A block may include compact uncertainty labels, supporting evidence links, or a conflict subsection. v0.3 does **not** require independent claim IDs and status state machines for every sentence. For high-risk or disputed material, optional structured assertions and links can coexist with Markdown.

### 4.4 Event ledger (changes and organisation)

The ledger records the evolution of the **content and organisation** of memory. It covers ordinary text edits, new blocks, renames, splits, merges, section changes, template revisions, manifest/load-policy changes, retired blocks, audits and coverage certificates.

Use Pi's append-only **custom** session entries with customType **pi-memory-ledger**. These are not model-visible by default. The authoritative projection is reduced from events along the active branch.

### 4.5 Original session evidence

The Pi transcript remains the source of truth for what the user actually decided, what the model merely proposed, and what tools reported. References use durable Pi source entry IDs, tool-call IDs and bounded ranges. Memory history is not a substitute for exact primary evidence.

## 5. Mutable taxonomy and organisational operations

The memory categories are **created as needed**, not configured in a fixed list. An initially empty session may contain only the manifest and a small general template registry.

Supported conceptual operations:

- Create, rename, revise, retire or restore a memory block.
- Add, edit, move, rename or delete a section of a block.
- Split one block into multiple blocks while recording source/target lineage.
- Merge several blocks into one, retaining all source identities/history.
- Create, revise, retire or reassign a YAML template.
- Change manifest descriptions, topic hints, aliases and per-block load policy.
- Consolidate a bloated block without changing its intended current meaning.

**Default organisational rule:** edit an existing block first; add a section second; create a new block only when separation helps retrieval, responsibility or context budgeting. Splits/merges are relatively high-impact operations and should be explicitly auditable. Direct user requests take precedence over heuristic preferences.

A structural change affecting multiple blocks and the manifest MUST commit as a **single logical changeset**. A failed split cannot leave the manifest referring to missing blocks. Retire/rename is not physical deletion of session evidence.

The reducer validates references, unique IDs, path/alias collisions, YAML parsing, block/template associations, split/merge lineage, load policies and base revisions before committing.

## 6. Tools and agent-facing workflow

### 6.1 remember({ memory: string })

Preserve the deliberately minimal primary interface. The agent explains the meaningful new or changed knowledge in natural language; it does not need to know internal block IDs, section coordinates or diff syntax.

**Proposed hint:**

> Remember a meaningful discovery, decision, correction, hypothesis, constraint, preference or open question from the conversation. A completed task is not required. Record what currently matters and any uncertainty. Existing memory blocks should be *edited rather than appended to* where possible. The extension will locate related blocks, reconcile with original evidence and relevant current knowledge, and commit an audited revision. Do not save every exchange.

Tool workflow:

1. Persist a source-bounded proposal.
2. Search the **entire current manifest** for relevant blocks, including unloaded ones, by deterministic index plus optional semantic ranking.
3. Fetch relevant current block content and directly implicated evidence/history.
4. Ask an isolated auditor to verify provenance and propose the smallest coherent document edits or new block.
5. Validate and atomically commit a changeset against expected block and manifest revisions.
6. Return a terse saved/updated/unchanged/pending/error result. Do not claim success before commit.

### 6.2 organize_memory({ operation, ... })

A separate model-facing or operator-accessible family of **typed, constrained structural operations**: create/rename/split/merge/retire blocks; edit template or manifest metadata; move/rename sections; change load policy. Exact schema can evolve, but must NOT accept an unrestricted filesystem shell command or unchecked arbitrary document replacement.

Operations that materially change the meaning of active knowledge are audited with source evidence. Purely structural refactors are audited for completeness, lineage and unintended semantic loss. A rename alone does not imply a new fact has been learned.

### 6.3 memory_read / memory_recall

Provide a model-facing read operation, possibly as two tools or one tool with explicit view modes:

- List current manifest entries and filters; retrieve current blocks by stable ID or alias, even if not loaded.
- Read a template, its usage hints and revision.
- Inspect current state, revision history, exact diff, provenance and audit receipt.
- Retrieve bounded raw Pi messages/tool results by exact entry IDs; paginate and clearly mark truncation.
- Look up historical names after rename/split/merge.

Existing v0.2 **memory_recall({ id, view?, anchor?, cursor?, limit? })** semantics for source-accurate retrieval remain a requirement; extend its addressable objects to blocks, templates, manifest changes and revisions. Tool namespace is provisional.

### 6.4 checkpoint_memory / coverage review

A **separate checkpoint operation** audits a precisely bounded conversation interval, with or without any new memory proposal. It may produce multiple changesets, report that no additional material must be retained, or refuse certification.

This operation should normally be scheduled proactively before context pressure becomes critical. No model call should be deferred to the compaction hook itself.

### 6.5 Operator interface

Proposed commands:

- /memory status — manifest/version, loaded/on-demand counts, coverage frontier, activity, risks.
- /memory list — blocks, templates, status and load policies.
- /memory show <block-id> — rendered block, revision, sources, template, lineage.
- /memory history <block-id> — changes and diffs; retrieve original evidence.
- /memory organize — controlled operations and inspection.
- /memory activity — deterministic file-operation history.
- /memory checkpoint — request explicit audit/certification before compaction.
- /memory compact — invoke Pi compaction with the extension's validation.
- /memory mode [on|off] — enable/disable without mutating global Pi configuration.

Exact commands and Radius UI affordances remain implementation choices.

## 7. Audit and selective reconciliation

### Shift from v0.2

v0.2 required **every audit to inspect every earlier memory**, even retired ones. v0.3 explicitly removes that requirement. It grows quadratically, overfits the idea of a memory as a fixed claim, and ignores the user's practical current-state-document model.

**New rule:** reconcile against the **current relevant state**. History is retrieved selectively when needed to understand disputed decisions, provenance, revisions, or suspicious inconsistencies.

Retrieval is central to correctness. Use the complete manifest for candidate discovery, then a deterministic lexical/topic index as a minimum baseline. Semantic search or embeddings can be added later but are not required. If retrieval misses a relevant contradiction, the audit may be incomplete. Do NOT report global absence of contradictions merely because none appeared among retrieved blocks.

### Audit input

1. Exact candidate or structural changeset; original source span and provenance.
2. Current manifest and the search criteria/results used to select relevant blocks.
3. Current revisions of matched blocks, their YAML template guidance, and relevant related blocks.
4. Historical diffs and raw evidence only for implicated earlier decisions or unresolved conflicts.
5. Instructions to distinguish user decisions from assistant proposals, facts from hypotheses, and current authority from historical truth.

An isolated model audit is synchronous by default, using the working model unless explicitly configured otherwise. A different provider may receive session data only with an explicit user-selected policy. Nested audit inference must not be granted arbitrary shell/network/write tools.

### Auditor output and validation

The auditor proposes **document-level edits with minimal diffs**, revision preconditions, source references, uncertainty notes, reconciliation rationale and optional structured conflict records.

The deterministic runtime validates:

- Changes affect only known/approved target IDs, sections and revision bases.
- Diff application yields the exact proposed new content; no malformed or partial patch is accepted.
- YAML/template and manifest invariants hold after the entire transaction.
- User intent and evidence are attributed accurately to the extent checkable.
- No independent un-audited modification is smuggled into a multi-block operation.
- Audit/retrieval gaps are explicitly represented, not converted into verified status.

Possible results: saved, updated, unchanged, corrected, contested, unsupported, incomplete or failed. **Only a validated committed transaction changes current memory.**

### Factual versus decisional updates

When a user revises a project decision, the current block may be updated to the latest explicit decision, preserving prior decisions in history. When two external factual claims conflict, chronology does not settle the dispute. The block must retain uncertainty, request more evidence, or describe the disagreement instead of asserting an arbitrary winner.

### Provisional content

A brainstormed option should appear under alternatives/open questions, not silently replace an adopted decision. A failed test is evidence of a failure, not a decision to abandon a feature. A successful tool call is evidence of a reported outcome, not necessarily proof of enduring state.

## 8. Changesets, revision semantics and branch replay

### Storage

Persist a structured event in Pi's session JSONL as customType **pi-memory-ledger**. Pi custom entries are durable but excluded from the model context. Conceptual event kinds:

- memory.proposed / memory.audit_failed
- memory.changeset_committed
- memory.coverage_reviewed / memory.coverage_refused
- memory.snapshot_checkpoint (optional acceleration cache)
- memory.context_published (what was made model-visible, tied to branch/cut)
- activity.file (retained from v0.2)
- memory.compacted / memory.policy

A single **memory.changeset_committed** represents one atomic, audited logical transaction, whether it edits one paragraph or splits several blocks and updates the manifest. The event stores a schema version, stable ID, expected projection revision, operations, resulting checksums/diffs, exact source IDs, audit metadata, actor/user intent, and a complete commit outcome.

### Illustrative changeset

~~~json
{
  "schema": 3,
  "kind": "memory.changeset_committed",
  "changeId": "chg_...",
  "baseRevision": "rev_...",
  "sourceEntryIds": ["entry_..."],
  "audit": {
    "status": "supported",
    "model": "provider/model",
    "reviewedBlockIds": ["blk_transport"],
    "retrievalScope": "relevant-current-state"
  },
  "operations": [
    {
      "op": "block.replace_section",
      "blockId": "blk_transport",
      "sectionId": "current-decision",
      "expectedBlockRevision": "rev_...",
      "newText": "Use SSE for the event stream."
    }
  ]
}
~~~

This is a conceptual schema, **not a native Pi event format**. Schema and operation validation must be defined before code is shipped.

### Identity and reconstruction

- Block IDs and template IDs remain stable through rename; paths and aliases are mutable.
- Section IDs may be assigned for robust patching; an implementation may use a Markdown AST, but must reject ambiguous matches rather than editing the wrong heading.
- Split/merge operations retain explicit lineage and source mappings, including retired source IDs.
- Every changeset has a monotonic logical projection revision on the active branch.
- Concurrency uses optimistic revision preconditions and serial commit ordering. A stale proposal is re-audited or rejected, not blindly applied.
- Materialized Markdown, rendered manifest, generated diffs and replay snapshots are **derived** and may be discarded/rebuilt.
- Snapshots must be tied to a branch ancestor + content hash and validated before replay. A branch fork starts from its shared ancestor and does not inherit later sibling events.
- A single active session writer is the default; simultaneous process writes are unsupported without tested locking.

### Git relationship

Versioned Markdown blocks, templates and the manifest are deliberately **Git-like** in user experience. v0.3 does not require a real Git repository to persist them; Pi's append-only branch history is canonical. Export-to-files or Git mirroring is a possible later adapter, not an additional writer in the initial design.

## 9. Load policy, context publication and prompt-cache economics

### Memory tiers

**Core:** manifest plus user-selected/essential blocks loaded into reconstructed context. The manifest is small and always visible, subject to safety constraints.

**On-demand:** current blocks discoverable through the manifest and fetched as needed, without permanent occupation of every turn's context.

**Retired/historical:** old revisions and retired blocks available through explicit retrieval but not implicitly loaded.

Load policies and selected core blocks are versioned in the manifest. Initial loading should favour user selection and a modest budget, not an agent deciding that every interesting block is permanently resident.

### Within a running session

Avoid wholesale rewriting of the leading system prompt when a block changes. Use one of these progressively weaker strategies based on actual provider/model/Pi support:

1. **Native appended system updates** at permitted turn boundaries, containing a trusted, bounded memory snapshot/delta and stable block/version markers. Preserve the existing conversation prefix and append a newer authoritative revision notice.
2. **Append-only non-system update / tool result** with explicit version and provenance, when system-update authority is unavailable or inappropriate. The agent can also fetch blocks on demand.
3. **Deferred materialization at compaction** for unsupported configurations, high-churn blocks, or where the prefix/cache economics are unfavourable.

Never edit an earlier model-visible message merely to update memory in place; this commonly invalidates the cache following that position. Append-only updates themselves consume context tokens, so consolidate on compaction and bound maximum delta frequency/size.

### Trust boundary

A memory block contains *data about the user/project*, not automatically application instructions. The extension must not promote arbitrary user-supplied files, copied websites, shell output, third-party tool results, or untrusted document text to privileged system instructions. Any high-priority publication must be explicitly scoped to trusted, audited and appropriately attributed facts/configuration. Other information stays lower-trust even when cached or retrieved.

### Pi/provider integration status (researched, not assumed)

Current Pi's model transcript has first-class **SystemMessage** objects with later updates, named sections and tool deltas. Its provider implementations gate native mid-conversation system messages using the model compatibility property **supportsMidConvoSystemMessages**. When false, Pi collapses the transcript's system updates into a reconstructed leading prompt; this may sacrifice the desired cache benefit.

Pi's **before_agent_start**, **context**, and **context_with_system** hooks provide integration points, but merely changing prompt text in a hook does not prove a persisted, correctly positioned, cache-preserving provider message. Integration must produce valid Pi session entries and respect provider restrictions.

**Anthropic:** supported Claude models accept native mid-conversation system messages that preserve preceding cached context. Their content-bearing messages have specific placement restrictions (including the relation to user turns/tool results), cache controls must be enabled, and edits to earlier messages still invalidate prefix reuse.

**OpenAI:** Responses API supports cacheable append-only conversation histories and explicit/implicit prompt-cache breakpoints on applicable models. Pi exposes native mid-conversation system-message compatibility for supporting models. Changing top-level instructions, tools or certain request settings can invalidate a prefix; neither a compatibility flag nor an API capability guarantees every request will hit cache.

**Other providers/local inference:** detect capabilities instead of presuming parity. A provider lacking native later system messages can continue using the on-demand read tool and compaction refresh.

**Acceptance is empirical.** Inspect which Pi model entries set the compatibility flag, provider-native serialization and placement legality. Instrument actual cache read/write tokens, latency, cost, branch replay and compaction behaviour. Do not automatically select a high-priority transport where the source content does not deserve that authority.

### Publication version control

Each published snapshot/delta identifies block IDs + revisions and a manifest revision. Later updates supersede earlier *semantic state* without rewriting earlier messages. The renderer and agent must be able to identify the latest authoritative version. If publication fails, durable memory still succeeds but user/model-facing status reports that live context was not refreshed; the next on-demand read or compaction can recover.

## 10. Coverage frontier and compaction safety

**Coverage certification remains a distinct operation.** A memory edit records a discovery; it does not automatically mean every earlier user message, tool result, outstanding task or unresolved decision was reviewed.

Persist a **branch-local coverage frontier** and contiguous **coverage receipts** with precise source entry bounds, auditor identity, retrieval/truncation diagnostics, retained changesets, open work, and explicit no-salient-memory decisions where appropriate.

A checkpoint may advance the frontier only if the auditor actually reviewed the entire claimed interval under documented bounds. When the interval is too large, use bounded consecutive intervals; never claim a partial or truncated scan as complete. Coverage is best-effort and uncertainty must be visible. Unreviewed tool results cannot be silently counted as covered because the agent remembered a fact from the adjacent discussion.

### Compaction algorithm

1. Read Pi's proposed cut point and the complete active branch up to that point.
2. Rebuild authoritative current manifest/templates/blocks, committed coverage and the activity projection. Recover from validated snapshots only as an optimisation.
3. Determine the exact compacted-away interval. Confirm continuous coverage for material that would leave context; pending/failed proposals do not count. If there is a gap, move the cut backward while within budget or refuse. No new LLM audit happens here.
4. Choose core and context-relevant on-demand blocks **by a deterministic versioned policy**, using committed manifest selections and explicit user/operator choices. The manifest still indexes omitted blocks for later retrieval.
5. Render each chosen block exactly once at its latest relevant revision, with stable IDs, concise source pointers, uncertainty and open work. Do not concatenate older compaction summaries or prior block snapshots.
6. Append the deterministic Session Activity Ledger footer, as in v0.2, and store its complete metadata in the compaction details.
7. Check all size, manifest completeness, identity, source and schema invariants. If the required core state + manifest + activity + retained tail cannot fit, refuse rather than silently truncate.
8. Return a validated Pi CompactionResult with summary, cut, token estimates where supported, and structured revision/coverage/activity metadata. **No provider call.**
9. After compaction, retain the new snapshot as the current context state. Raw Pi source entries and all custom ledger events remain available for explicit retrieval, including pre-compaction history.

**Important limitation:** semantic coverage is a judgment, not an absolute guarantee. Coverage receipts and deterministic compaction prevent accidental *procedural* loss, but cannot prove the auditor understood every important implication of the discarded conversation.

### Compaction as session restart

The same abstract operation — **assemble context from current materialized state** — underlies intra-session compaction and potential future cross-session startup. Their differences are scope, permission, retrieval and persistence boundaries. v0.3 only implements the Pi-session boundary.

### Legacy/native compacted sessions

Importing a Pi session that was compacted before this extension started requires a clearly labelled bootstrap. A native summary is not retroactively an audited coverage receipt. Do not advertise a fully verified frontier before the first extension-controlled checkpoint.

## 11. Session Activity Ledger (v0.2 retained)

The v0.2 passive Session Activity Ledger is **orthogonal** to model-authored memory documents. Carry forward its observation and replay rules unchanged in intent.

- Instrument reported successful native **read**, **write** and **edit** calls with canonical paths, original spelling, cwd, tool-call IDs, associated durable result-entry IDs and outcome. Failed operations are not successful modifications.
- Stage callbacks until durable message/result provenance can be associated. Recover missed events after a crash by idempotent backfill from persisted native tool results. Concurrent callbacks must not determine event order or commit identity.
- Distinguish **reported tool success** from verified filesystem content, final Git state or historical truth. Shell commands, nested processes and third-party tools may produce unobservable changes; label these tracking gaps.
- Do not store file contents, credentials or command stdout in activity events.
- Replay only the active branch, including activity older than earlier compactions. Deduplicate and stably sort read/modified sets; a modified path supersedes its appearance in the read-only list.
- At compaction, render one cumulative **session-activity** footer, and store the complete structured projection in CompactionResult.details. Never append the previous footer to a new one, and never let passive activity events advance narrative coverage.
- Continue to fail explicitly if the configured full footer cannot fit. A later bounded-footer design must first supply reliable model-callable retrieval of the complete list.
- Expose activity history and tracking limitations via /memory activity and compact status UI.

Example footer:

~~~xml
<session-activity schema="1">
  <read-files>
    src/config.ts
  </read-files>
  <modified-files>
    src/auth.ts
    src/session.ts
  </modified-files>
</session-activity>
~~~

Future adapters (Git commits, test outcomes, created artifacts) require their own observation rules, provenance, privacy and reducer validation.

## 12. Failure, concurrency, privacy and security

- **Audit unavailable/timeout:** persist proposal + failure; no block revision or coverage advance, no phantom success notification. Re-attempt explicitly and idempotently.
- **Crash during commit:** a single logical changeset must replay all or none of its operations. Validate schema, IDs and resulting state before accepting an event.
- **Concurrent proposals:** serialize commits; validate base revision; retry audit/patch generation after another successful edit when necessary.
- **Structure edits:** a manifest/template/block migration either validates as a whole or fails. Block aliases must never resolve ambiguously after rename/split.
- **Branch switching:** rebuild exact ancestor-local state and frontier; do not incorporate sibling changes without an explicit audited merge operation (deferred).
- **Concurrent Pi processes:** single active writer per session by default.
- **Untrusted YAML/Markdown:** treat content and editing hints as untrusted data relative to higher-priority instructions. Parse safely, bound sizes and disallow executable YAML tags or scripts.
- **Prompt-injection resistance:** recalled webpages/tool outputs remain lower-trust even if summarized in memory; audit text is never executable code.
- **Evidence and transparency:** keep source IDs and review scope; do not label a selective audit as exhaustive history verification. Preserve explicit disputes and unresolved questions.
- **Privacy:** define redaction for UI/export; don't route private source to unselected external auditor providers; distinguish logical retirement from actual deletion of persisted raw data or backup files.
- **Cache failures:** unsupported mid-conversation system placement or provider 400 errors must fall back without corrupting the transcript or causing an infinite retry loop.
- **Activity tracking failures:** native file-tool operations should not fail solely because passive event collection failed; surface observation gaps.

## 13. UI and Radius

Normal conversation should show concise **Memory saved**, **Memory updated**, **Memory unchanged** or **Memory pending/failed** only when appropriate. Structural revisions may show **Memory reorganized** with inspectable details.

The TUI and Radius/RPC client can expose a manifest browser, current block Markdown, source links, revision diffs, active/on-demand state, audits, coverage and file activity. The default interactive display stays quiet. A custom entry renderer, client integration or notifications may be needed; do not assume a hidden custom entry magically appears below the relevant final assistant response.

After successful compaction, show meaningful counts (blocks loaded, on-demand entries indexed, activity paths, last covered source) rather than legacy counts of all historical active claims.

## 14. Pi integration map

| Capability | Candidate integration |
|---|---|
| remember / read / organize / checkpoint tools | pi.registerTool |
| Branch-local canonical event persistence | pi.appendEntry with customType pi-memory-ledger |
| Branch projection and exact evidence references | ctx.sessionManager active branch APIs + source entry IDs |
| Audit model inference | ctx.modelRegistry.streamSimple in isolated bounded context |
| Current prompt/section updates | before_agent_start or compatible system-update mechanism, subject to source verification |
| Model request-local transforms | context / context_with_system, **not** a substitute for durable state |
| Live publication | Persisted or safely appended model-visible system/custom context when provider capability and Pi lifecycle allow |
| Deterministic compaction | session_before_compact returning CompactionResult |
| Successful/failing compaction | session_compact / session_compact_failed |
| File operations | tool_result / tool_execution_end with durable association later in the turn |
| Recovery, source replay, activity replay | session_start and active-branch reducer |
| TUI / Radius | renderers, notifications, commands, client-specific event presentation |

Pi's current session format supports custom entries, compaction entries, later system messages and branch-local replay. Exact event types, registration signatures and timing must be checked against the installed Pi version before implementation.

## 15. Proposed configuration

All names and defaults are **design placeholders**, not verified Pi settings or benchmark-tuned optimal values.

~~~json
{
  "enabled": true,
  "memory": {
    "representation": "markdown-blocks",
    "manifest": "always-visible",
    "defaultLoadPolicy": "on-demand",
    "editPreference": "replace-existing",
    "allowAgentCreateBlocks": true,
    "allowAgentRenameBlocks": true,
    "allowAgentSplitMerge": "audited",
    "maxLoadedBlockTokens": 12000
  },
  "templates": {
    "format": "yaml",
    "allowUserDefined": true,
    "allowAgentRevision": "audited"
  },
  "auditor": {
    "provider": "same-as-session",
    "model": "same-as-session",
    "mode": "synchronous",
    "reconciliation": "relevant-current-state",
    "timeoutMs": 120000,
    "onFailure": "retain-pending"
  },
  "contextPublication": {
    "strategy": "auto-capability",
    "preferAppendOnly": true,
    "promoteRawRetrievedDataToSystem": false,
    "onUnsupported": "tool-read-or-compaction",
    "maxPendingDeltaTokens": 2500
  },
  "coverage": {
    "enabled": true,
    "reviewStrategy": "explicit-bounded-checkpoints",
    "onGap": "retain-or-refuse",
    "proactiveCheckpoint": true
  },
  "compaction": {
    "strategy": "materialized-current-state",
    "interceptManual": true,
    "interceptAutomatic": true,
    "onUnsafeCoverage": "refuse",
    "respectPiKeepRecentTokens": true,
    "maxSummaryTokens": 20000
  },
  "activity": {
    "enabled": true,
    "nativeTools": ["read", "write", "edit"],
    "trackReads": true,
    "trackWritesAndEdits": true,
    "includeInCompactionFooter": true,
    "onFooterOverflow": "refuse"
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
~~~

## 16. Acceptance tests

1. **Dynamic categories:** start with no fixed domain blocks; user and agent establish arbitrary new block names and purposes.
2. **Manifest discovery:** a block not loaded in context remains listed in the manifest and retrievable by its stable ID.
3. **Template authoring:** YAML template defines Markdown headings and editing hints; a new block adopts them without a compiled category enum.
4. **Template evolution:** revising a template is independently versioned; old blocks are not silently rewritten.
5. **Edit over append:** a changed transport decision updates an existing paragraph rather than appending an obsolete duplicate to active memory.
6. **Reversible history:** retrieve exact previous document text, diff, edit rationale and original Pi evidence from an earlier revision.
7. **Rename stability:** block rename preserves ID, revision history, provenance and prior-name alias.
8. **Atomic split/merge:** a multi-block structural change updates the manifest and lineage together; a failed partial operation changes nothing.
9. **User versus suggestion:** brainstorming an alternative does not supersede an adopted decision without explicit authority.
10. **Factual conflict:** contradictory unsupported external claims remain disputed instead of arbitrary last-write-wins.
11. **Selective audit:** unrelated historical blocks need not be sent to every auditor; retrieved matches and retrieval gaps are recorded.
12. **Search miss caution:** a relevant unloaded block cannot be silently treated as nonexistent merely because it was absent from the current prompt.
13. **False proposal:** nonexistent passing tests are rejected/corrected using actual source results.
14. **Coverage independence:** saving an important fact does not certify every intervening turn for compaction.
15. **No-op checkpoint:** a complete bounded source review may advance the frontier without creating or editing any block.
16. **Coverage gap:** cutting an uncertified interval retains the necessary tail or refuses safely.
17. **No model at compaction:** instrument inference calls; the compaction hook makes zero calls.
18. **Deterministic render:** same active branch/cut/config yields byte-identical manifest, block selection, snapshot and footer.
19. **No duplicate memory:** repeated compactions render each selected block once at its latest revision; old snapshots don't accumulate.
20. **On-demand retrieval:** unloaded current blocks and exact pre-compaction source ranges remain accessible.
21. **Provider compatibility:** native later system messages are emitted only for verified-capable model/provider pairs and valid turn boundaries.
22. **Cache measurement:** compare cached tokens and latency for appended updates versus leading-prompt replacement; do not infer hits merely from successful requests.
23. **Stale update detection:** an audit against an earlier block version cannot overwrite a newer concurrent revision.
24. **Branch isolation:** rewinding to an ancestor restores the ancestor manifest, templates, blocks, coverage and file activity.
25. **Recovery:** restart between proposal/audit/commit never yields half an applied structural change or a false saved indicator.
26. **Activity accuracy:** successful read/write/edit operations generate deduplicated branch-local records; failed and inferred shell effects are not counted as verified modifications.
27. **Activity persistence:** two compactions retain cumulative activity with exactly one footer; metadata remains complete.
28. **Budget refusal:** a required core block, manifest or full activity footer that cannot fit produces an explicit failure rather than silent truncation.
29. **Privacy/authority:** untrusted imported document text and YAML hints cannot become privileged system instructions, and separate audit provider use is opt-in.
30. **Legacy bootstrap:** a pre-extension native compaction is not falsely advertised as an audited source frontier.

## 17. Implementation slices

**A — Core event store and materializer:** define stable IDs, changeset schema, active-branch reducer, canonical registry/manifest, Markdown blocks, template parsing, snapshots, revision/diff inspection and invariants. Test all structural operations with no LLM.

**B — Model memory and relevant-state audit:** implement remember, manifest search, selective current-state retrieval, isolated audit, minimal edit/diff generation, atomic commit, provenance and failure recovery. Expose concise UI.

**C — Coverage and deterministic compaction:** implement bounded proactive coverage checkpoints, manifest/block selection, evidence gates, renderer, cut/budget verification and repeatability tests. No inference inside the hook.

**D — In-session visibility and provider compatibility:** prototype append-only system updates where supported; confirm Pi serialization, message placement, prompt authority and actual cache metrics. Add fallback tool-result/on-demand behaviour; ship no speculative cache promises.

**E — Retrieval, structural organisation and presentation:** model/operator tools to inspect, rename, split/merge, edit templates, view history; Radius integration; robust source pagination.

**F — Session Activity Ledger from v0.2:** instrument and backfill native file activity, deterministic reducer and footer, track limitations and operator inspection. Implement early enough to avoid losing pre-hook tool observations.

These are engineering slices, not a commitment to include speculative capability flags without testing. User-facing memory commits require a validating auditor from the first release.

## 18. Open decisions and experimental risks

The following are **not blockers to a v0.3 draft**, but must be resolved before claiming production reliability.

1. **Coverage completeness and cost.** How frequently should the agent checkpoint? What is a defensible bounded evidence window, and how are very large tool results handled? The v0.3 baseline is explicit contiguous best-effort review; no automatic advancement based solely on remember.
2. **Native high-priority update transport.** For each Pi version/model/provider combination, determine legal message placement, persistence, model compatibility flags and actual cache economics. Baseline fallback is on-demand retrieval and compaction refresh, not leading-prompt mutation every turn.
3. **Memory structure autonomy.** The user can explicitly reorganise freely. For autonomous splits/merges, initial implementation should apply strict size/risk limits, audited lineage and optional user approval for high-impact changes; calibrate after real usage.
4. **Markdown patch representation.** Compare section-ID operations, Markdown AST transformations and unified patches for reliability, diff clarity and deterministic replay.
5. **Manifest search quality.** Deterministic lexical indexing is the baseline. Evaluate retrieval misses and conflicts before deciding whether embeddings or broader cross-block checks are necessary.
6. **Claim metadata.** Determine the minimum structured uncertainty/dispute representation needed without reinstating v0.2's full claim graph.
7. **Manifest size and budgeting.** Decide when a single manifest grows too large and needs compact hierarchical indexes; require bounded complete discoverability.
8. **Publication invalidation.** Establish how an agent recognises older in-context block versions as superseded by newly appended versions, particularly for providers that fold later system messages.
9. **Mixed manual/native compaction and crashes.** Test overflow recovery, session forks, competing compaction hooks, and pre-existing compacted sessions under actual Pi.
10. **Auditor operational costs.** Model contention, synchronous delay, retries, provider privacy, tool restrictions and deterministic commit ordering.
11. **Retention/privacy policy.** Logical retirement is not deletion of raw Pi evidence, backups or exported Git artifacts; user-facing removal semantics require a separate design.
12. **Concurrent multi-process access.** Maintain single-writer assumption until a locking/merge strategy is tested.
13. **Session-activity limits.** Native tool result coverage, arbitrary bash effects, huge file sets and optional bounded footer retrieval.
14. **Cross-session durability.** The architecture naturally extends to startup/restart, but scope, file store, user identity, sharing permissions and memory promotion across sessions are deferred.

## 19. References

- [Pi coding-agent repository](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
- [Pi extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi session format and branch projection](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)
- [Pi compaction documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)
- [Pi model transcript SystemMessage types](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)
- [Pi Anthropic Messages provider](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/anthropic-messages.ts)
- [Pi OpenAI Responses provider](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-responses.ts)
- [Anthropic mid-conversation system messages and tool changes](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [SAM reference](https://github.com/LePrau/pi-self-aware-memory)
- [Pi observational memory reference](https://github.com/elpapi42/pi-observational-memory)
- [Pi Blackhole reference](https://github.com/k0valik/pi-blackhole)

---

**Guiding principle:** The agent maintains a compact, revisable representation of its *current understanding*, not an ever-expanding transcript summary. The manifest says what exists; templates govern how documents are maintained; selective audits check changes; the ledger preserves their full evolution; explicit source coverage protects compaction; and deterministic context reconstruction gives each new context epoch the latest appropriate knowledge.
