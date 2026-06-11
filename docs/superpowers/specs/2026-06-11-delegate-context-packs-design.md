# Delegate Context Packs — Design

**Date:** 2026-06-11
**Package:** `pi-delegate-driven-development` (delegate sub-extension + delegate-driven-development skill)
**Status:** Approved

## Problem

`delegate_anchor` + `inherit_context` give workers a shared, cache-friendly session
prefix, but the prefix must be a literal prefix of the orchestrator's live session
branch. This forces a convoluted setup choreography ("anchor FIRST, read spec, read
plan, recover with `session_entries` if noise slipped in"), couples the worker prefix
to whatever the orchestrator happened to live through, and dies with the orchestrator
session: `anchorMap` is in-memory, and snapshots are throwaway temp files. There is
also no way to give different worker roles (implementer vs reviewer) different
curated context without polluting the orchestrator's own transcript.

## Solution overview

Add **context packs**: named, frozen, on-disk context artifacts compiled from an
ordered list of files (plus optional freeform note), consumable by `delegate_start`
alongside or instead of an anchor.

- New tool **`delegate_pack`** compiles files → a frozen pack file under
  `.pi/delegate/<date>/packs/<name>.jsonl`.
- New **`context_pack`** parameter on `delegate_start` (name or path) appends the
  pack's content to the worker's session snapshot.
- `context_pack` **composes** with `inherit_context`: anchor content first, pack
  content after. All four combinations are valid.
- New **`system_prompt_file`** parameter on `delegate_start`: a path whose content
  the extension reads at spawn time and passes via `--append-system-prompt`, so
  role prompts ride in the system layer without inlining their bodies into the
  orchestrator transcript.
- The delegate-driven-development skill switches from anchor choreography to packs,
  and from "worker reads the role template" to `system_prompt_file`.

Three-layer cache model this enables (top of token prefix to tail):

| Layer | Varies by | Cached? |
|---|---|---|
| `system_prompt_file` (+ base π prompt, tool defs) | role | per-role lineage |
| context pack (spec, plan, …) | implementation effort | shared within lineage |
| task prompt | every ticket | uncached tail |

No drift enforcement (fingerprinting was considered and rejected): the DDD skill's
"pick and stick" discipline — choose implementer/reviewer/fixer model, tools, and
system prompt at run start and never vary them — is documented, not policed.

## Component 1: `delegate_pack` tool

Registered by the delegate sub-extension next to `delegate_anchor`.

### Schema

```ts
{
  name: string,        // required; must match /^[a-z0-9][a-z0-9_-]*$/
  files: string[],     // ordered paths, resolved against orchestrator cwd; min 1
                       // (0 allowed only when note is present)
  note?: string,       // optional freeform prose, appended after the files
  overwrite?: boolean, // default false; required to replace an existing pack
                       // of the same name on the same date
}
```

### Behavior

1. Validate `name`; read every file in order (fail fast with the offending path if
   any file is missing/unreadable; empty files are an error — likely a wrong path).
2. Compile to pack JSONL (format below).
3. Write to `.pi/delegate/<date>/packs/<name>.jsonl`, creating directories as
   needed. `<date>` is today (same convention as existing delegate artifact dirs).
   If the file exists and `overwrite` is not set, fail — packs are frozen artifacts.
4. Return: absolute pack path, item count, total bytes, and a rough token estimate
   (`bytes / 4`) so the orchestrator can sanity-check pack size.

Packs are immutable after creation (modulo explicit `overwrite`). If the source .md
files change later, the pack does **not** change — that is the point. Re-run
`delegate_pack` deliberately to issue a new prefix generation.

### Pack file format

Line 1 — pack header (audit metadata, skipped at compose time):

```json
{"type":"pack","version":1,"name":"plan-foundation","timestamp":"…",
 "sources":[{"path":"docs/specs/foo-design.md","bytes":12345}, …, {"note":true,"bytes":210}]}
```

Lines 2+ — standard session `message` entries, one **user** message per item, in
order. Text content is the frozen payload:

```
[context-pack:plan-foundation] File: docs/specs/foo-design.md

<verbatim file content>
```

The `note` item uses the framing `[context-pack:<name>] Note from orchestrator:`.
Entry `id`/`parentId` values in the pack file are placeholders; they are rewritten
at compose time (ids are not tokenized, so rewriting never affects the cache —
only the `message` payloads must stay byte-identical, and they do because the file
is frozen).

Consecutive user messages are valid in π sessions (steering already produces them)
and accepted by providers; no synthetic assistant acknowledgment is fabricated.

## Component 2: `delegate_start` changes

### New parameter

```ts
context_pack?: string
// Pack name, or explicit path. Description documents the resolution rule
// and that it composes with inherit_context (anchor first, pack appended).
```

### New parameter: `system_prompt_file`

```ts
system_prompt_file?: string
// Path to a file whose content is appended to the worker system prompt.
// Mutually exclusive with system_prompt (error if both are set).
```

Resolved against the worker cwd (`params.cwd` if set, else orchestrator cwd) —
role templates live in the worktree per the DDD skill. The extension reads the
file at spawn time and passes the content as `--append-system-prompt`; the path,
not the content, appears in the orchestrator transcript. Unlike packs the file is
re-read per spawn (no freeze): identical file content → identical per-role cache
lineage; mid-run edits would silently fork the lineage, which the skill's
cache-discipline section calls out as the orchestrator's responsibility.

### `context_pack` resolution

- Value contains `/` or ends with `.jsonl` → treat as a path (relative to
  orchestrator cwd or absolute).
- Otherwise → search `.pi/delegate/*/packs/<name>.jsonl`, newest date first, pick
  the first hit. This covers midnight rollover and resume-next-morning without
  ceremony. Not found → fail with a message listing available pack names.

### Snapshot composition

`buildSessionSnapshot` (snapshot.ts) gains pack support. The composed temp session
file written per spawn becomes:

```
session header (fresh id, workerCwd)          ← as today
[anchor branch entries]                       ← if inherit_context true/"name", as today
[pack message entries]                        ← if context_pack set
```

Pack entries are re-identified (fresh ids) and re-parented: the first pack entry's
`parentId` is the anchor branch's leaf id (or `null` when there is no anchor);
subsequent entries chain. All four combinations of `inherit_context` ×
`context_pack` are valid:

| `inherit_context` | `context_pack` | Worker sees |
|---|---|---|
| absent/false | absent | ephemeral (`--no-session`), as today |
| true/"name" | absent | anchor snapshot, as today |
| absent/false | set | header + pack only |
| true/"name" | set | anchor branch + pack appended |

Error handling mirrors the existing anchor path: any failure (unresolvable pack,
unreadable/corrupt pack file, bad header) transitions the worker to `failed`,
cleans up the temp file, and throws with the reason. A pack header `version`
other than `1` is rejected.

The `delegate_start` result `details` includes the resolved pack path for audit.
Per-spawn temp session files are cleaned up exactly as today (`entry.tempFilePath`);
the pack file itself persists.

### Lifecycle / durability

Packs live beside the session dirs that consumed them:

```
.pi/delegate/<date>/<orchestrator-session-uuid>/w<N>.*   ← existing run artifacts
.pi/delegate/<date>/packs/<name>.jsonl                   ← packs (date-scoped, NOT session-scoped)
```

Date-scoping (not session-scoping) is deliberate: the crash-resume story is "new
orchestrator session picks up the tickets and keeps spawning workers against the
same frozen pack," and a new session has a new UUID. Packs age out with the date
dir as a unit under any future retention sweep.

## Component 3: delegate-driven-development skill changes

- **Run setup** drops the "anchor FIRST" choreography. New flow: at any point
  before dispatching, `delegate_pack({ name: "plan-foundation", files: [<spec>,
  <plan>] })`. Order of orchestrator activities no longer matters; no
  `session_entries` recovery dance.
- All worker dispatch examples switch `inherit_context: "plan-foundation"` →
  `context_pack: "plan-foundation"`.
- **Role prompts move to the system layer.** Dispatches pass
  `system_prompt_file: "<worktree>/skills/delegate-driven-development/references/<role>-prompt.md"`
  instead of instructing the worker to read the template. The `task` argument
  shrinks to pure per-task data (plan excerpt, worktree path, task base SHA,
  fix instructions, ticket pointer).
- **Template rewording pass.** The three role templates are rewritten as system
  prompts: no `{{…}}` placeholders or "apply these substitutions" framing —
  instead "your task message provides …". Per-task values appear only in the
  uncached task prompt, never in the system layer.
- New short **cache discipline** subsection: pick implementer/reviewer/fixer model,
  provider, tools, and system prompt file at run start and hold them constant
  (the file is re-read per spawn — don't edit role templates mid-run); each
  distinct role system prompt is its own warm lineage; never put per-ticket detail
  in the pack or system prompt.
- New **resume** note: after an orchestrator restart mid-run, reuse the existing
  pack by name — do not recompile (recompiling cold-starts the cache and may
  silently pick up edited files).
- Anchors remain documented as the mechanism for inheriting *session* context
  (e.g. a worker that needs the orchestrator's live conversation), composable with
  packs via both parameters.

## Error handling summary

| Failure | Behavior |
|---|---|
| `delegate_pack` missing/empty/unreadable source file | tool error naming the path; nothing written |
| `delegate_pack` invalid name | tool error |
| `delegate_pack` name exists for today, no `overwrite` | tool error suggesting `overwrite: true` or a new name |
| `delegate_start` pack name unresolvable | worker `failed` + error listing available packs |
| `delegate_start` pack file corrupt / wrong version | worker `failed` + reason |
| `delegate_start` `system_prompt_file` missing/unreadable | worker `failed` + error naming the path |
| `delegate_start` both `system_prompt` and `system_prompt_file` set | tool error before spawn |

## Testing

Unit (vitest, alongside existing delegate tests):

- Pack compiler: ordering preserved, framing format, note placement, header
  `sources` metadata, byte counts.
- Freeze semantics: same inputs → byte-identical message payloads; collision
  without `overwrite` fails; with `overwrite` replaces.
- Resolution: newest-date-first across multiple date dirs; path form bypasses
  search; not-found error lists names.
- Snapshot composition: all four `inherit_context` × `context_pack` combos;
  re-parenting onto anchor leaf; fresh ids; identical `message` payloads across
  repeated spawns (cache-stability proxy).
- `delegate_start` failure paths transition worker to `failed` and clean temp files.
- `system_prompt_file`: content read and forwarded as `--append-system-prompt`;
  resolution against worker cwd; mutual-exclusion error; missing-file failure path.

Integration: extend the existing delegate integration test to spawn a worker with
`context_pack` and assert the worker can see pack content.

## Out of scope (considered, rejected/deferred)

- **Fingerprint enforcement** of model/tools/system_prompt per pack — rejected;
  "pick and stick" discipline is documented in the skill instead.
- **Raw `session_file` escape hatch** on `delegate_start` — deferred; hand-crafted
  session JSONL is the fragility packs exist to avoid.
- **System prompt replace** (vs append) for workers — YAGNI.
- **Pack listing/inspection tool** — `ls`/`read` suffice.
- **Interleaved items API** (`items: [{file}|{text}]`) — `files` + trailing `note`
  covers known needs; revisit if real interleaving demand appears.
