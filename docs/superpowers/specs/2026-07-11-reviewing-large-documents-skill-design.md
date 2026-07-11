# Reviewing Large Documents — Skill Design

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan
**Deliverable:** A reusable skill, `reviewing-large-documents`, developed as a π package
under `packages/pi-reviewing-large-documents/` in this monorepo (beside
`pi-delegate-driven-development`), published to its own mirror repo via
`scripts/release-bundle.sh`, and wired into projects through `.pi/settings.json` git
package entries.

## Problem

Large specs and implementation plans (~4k+ lines, 20k+ words) exceed the context
budget a reviewer can spend while still reasoning well — LLM quality degrades with
context length. A lead reviewer who reads the whole document has little capacity left
for judgment, and a naive per-section delegation misses issues that only appear across
section boundaries (interface mismatches, dependency-order errors, uncovered spec
requirements).

Motivating example: `docs/superpowers/plans/2026-07-10-streaming-timeline-core-implementation.md`
— 24,106 words, 4,306 lines, 26 tasks in 8 phases.

## Goals

- The lead reviewer's context stays compact: outline + preamble + worker reports + targeted extracts. For documents large enough to trigger this skill, the lead does not load the full document into context by default.
- All three review dimensions are covered:
  1. **Per-task depth** — each task internally sound, verified against the real codebase.
  2. **Cross-document coherence** — interfaces, ordering, and assumptions consistent
     across tasks/phases.
  3. **Spec conformance** — the plan covers the spec and does not contradict it.
- Works for two document types with one shared process: implementation plans and
  specs (specs reviewable before a plan exists).
- Reusable across projects: no hardcoded project conventions; project-specific review
  guidance is discovered via the project's AGENTS.md.

## Non-goals

- Post-implementation code review (covered by existing review methodology docs and
  delegate-driven-development's review stages).
- Reviewing documents small enough to read whole — the skill should say when not to
  use it (roughly: if the document fits comfortably alongside the reviewer's other
  context, just read it).

## Primitives used

- `mdedit` — `outline` (hierarchy + word counts + line ranges), `extract [--to-file]`,
  `validate`, `search`. The outline is the lead's map; extraction produces worker shards.
- `delegate_pack` — frozen shared context prefix (preamble + outlines) for all workers.
- `delegate_start` — isolated worker processes for batch reviews and targeted probes.
- `read` / `bash` (rg, etc.) — workers' codebase verification; lead's targeted checks.
- `web_search` / `fetch_content` — workers verifying external claims (library versions,
  platform APIs).

## Architecture

### Document tiers

1. **Preamble (always loaded)** — global constraints, goals/invariants, architecture
   overview, file structure map, risk register, dependency lanes. Loaded by the lead
   and embedded in the shared pack for every worker.
2. **Body sections (batched)** — tasks (plan) or topic sections (spec). Each batch is reviewed deeply by at least one worker; high-risk batches may receive a second targeted reviewer.
3. **Everything else (lazy)** — any worker or the lead may `mdedit extract` any other
   section on demand when a suspected dependency warrants it.

### The lead's loop

1. **Triage** — `mdedit validate` + `mdedit outline` on the plan (and spec if present).
   Word counts and line ranges come free and drive batching.
2. **Tier** — identify preamble vs body sections from the outline. Lead reads the
   preamble via `mdedit extract`.
3. **Batch** — group body sections into review lanes along declared phases/dependency
   lanes, balancing by word count. Target: each worker's core reading (preamble +
   batch) stays well under ~10k words. Batch count is driven by the document, not by
   the concurrency limit.
4. **Pack** — `mdedit extract --to-file` the preamble sections, generate outline files
   for all documents under review, and freeze them with `delegate_pack` (plus a note
   carrying document paths and the review's framing).
5. **Project lens** — check the reviewed document's surface area against the project's
   AGENTS.md task-specific references; include relevant project doc paths in worker
   briefs (or pack them if small). The skill ships no domain knowledge of its own.
6. **Dispatch round 1** — one worker per batch, plus one specialist worker
   (coverage-matrix for plans; internal-consistency for specs). Each batch worker
   receives: the shared pack (`context_pack`), its batch extracted to a file via
   `mdedit extract --to-file` (path given in the task brief), the lens brief
   (checklists, verification mandate, report contract), lazy-pull instructions,
   and relevant project-lens doc paths. Workers run at whatever concurrency the
   harness allows; extra batches queue sequentially.
7. **Cross-check** — join the contract ledgers from all reports: match *consumes*
   claims against *produces* claims; validate ordering claims against declared
   dependency lanes; read the foreign-pulls trails as a discovered dependency map.
8. **Dispatch follow-up rounds (max 2)** — small, targeted probe workers with tight
   briefs (e.g. "extract Task 7 and Task 14, compare the snapshot wire format each
   states, run these rg checks"). After two rounds, unresolved risks go into the
   review as explicit open questions with a recommended probe.
9. **Write** — severity-tiered review document; location per project convention
   (discovered, not assumed).

Before publishing the review, the lead must personally inspect:

- every blocker's cited document extract,
- every claimed cross-task ledger mismatch,
- any worker finding that depends on ambiguous interpretation.

### Worker report contract

Every batch worker returns a structured report:

1. **Verdict per task/section** — PASS / FAIL / PASS-WITH-CONCERNS.
2. **Findings** — severity (Blocker / High / Medium / Low), document location
   (section heading + line range), evidence (repo file:line, probe output, or web
   citation — never unsupported assertion), and a concrete fix instruction so a
   finding converts directly into a plan edit or fixer brief.
3. **Contract ledger** — the cross-boundary mechanism:
   - **Produces:** types, function signatures, file paths, wire formats, invariants
     this batch's tasks create, as literally stated in the document.
   - **Consumes:** everything this batch assumes exists from other tasks, with the
     exact signature/format expected.
   - **Ordering claims:** "must run after Task N because ..." — lets the lead validate
     the document's declared dependency ordering.
4. **Foreign pulls** — which out-of-batch sections were extracted and why.
5. **Verification log** — commands run, probe results, throwaway tests written (with
   confirmation of cleanup).

The lead's cross-check is then mechanical-plus-judgment: mismatched signature between
a *consumes* and its *produces* is a confirmed finding with no extraction needed;
an ambiguous match becomes a follow-up probe; consumed-but-never-produced is a likely
blocker.

### Specialist workers

- **Coverage-matrix worker (plan lens):** walks the spec outline section by section and
  maps every requirement to a plan task number. Reports orphans in both directions
  (spec requirements no task implements; tasks no spec requirement motivates). Needs
  only the spec, the plan outline, and task summaries — stays compact.
- **Internal-consistency worker (spec lens):** hunts contradictions and terminology
  drift across spec sections using the outline plus targeted extraction of
  suspicious pairs.

## Skill layout

```
skills/reviewing-large-documents/
  SKILL.md            # lens-agnostic lead process (the loop above) — kept short
  references/
    plan-lens.md      # plan review checklists, batch-worker brief template,
                      # coverage-matrix worker brief, verification mandate wording
    spec-lens.md      # spec review checklists (consistency, ambiguity, placeholders,
                      # feasibility, completeness), batch-worker brief template,
                      # internal-consistency worker brief
```

Lenses are reference docs loaded only when that document type is under review.
There is deliberately no bundled domain lens (no iOS/crypto/daemon reference):
domain-specific review conventions are the project's responsibility, discovered via
AGENTS.md (the "project lens" step). This keeps a single source of truth and avoids
the skill accreting per-domain knowledge that drifts.

### Frontmatter

```yaml
---
name: reviewing-large-documents
description: Use when reviewing large specs, implementation plans, or task documents
  that are too large to keep fully in context while preserving judgment
---
```

### Lens contents

**plan-lens.md**
- Per-task checks: file paths exist in the repo or are created by an earlier task;
  imports/APIs verified against the real codebase; TDD steps coherent; the task is
  executable by a context-less worker.
- Cross-task checks: ledger categories to extract; ordering-claim capture.
- Coverage-matrix worker brief.
- Verification mandate wording (see Guardrails).

**spec-lens.md**
- Internal consistency: contradictions between sections, terminology drift.
- Ambiguity scan: requirements interpretable two ways.
- Placeholder scan: TBD/TODO/vague sections.
- Feasibility probes: does the codebase support the assumed architecture.
- Completeness heuristics: error handling, migration, testing sections present.
- Internal-consistency worker brief.

## Guardrails

- **Lead context budget:** outline + preamble + reports + targeted extracts. Wanting
  to read a full phase is the signal to dispatch a worker instead.
- **Bounded iteration:** round-1 sweep plus at most 2 follow-up probe rounds. The
  bounded resource is waves, not worker count — the document dictates how many
  batches exist; the harness concurrency limit only dictates scheduling.
- **Evidence standards:** findings without file:line / probe output / citation are
  downgraded to concerns. Implausibly fast worker verification is treated as
  unverified.
- **Non-destructive mandate for workers:** read-only on the repo except throwaway
  test files in temp directories (deleted afterward); no git state changes. Workers
  may use `web_search`/`fetch_content` for public documentation and external claims,
  but must not call product services, mutate remote state, send live prompts through
  paid model APIs, or use credentials unless explicitly authorized.
- **Output:** severity-tiered review document (Blockers / High / Medium / Low /
  things-done-right / recommended edits), findings quoted with section + line refs
  and worker evidence, plus a review-coverage appendix: which batches went to which
  workers, what was probed, and what was not.

## Skill validation

Before deploying the skill, run baseline pressure scenarios without it:

1. Large plan review where the model tries to read the whole document and loses
   review depth.
2. Plan with a hidden cross-task interface mismatch.
3. Spec with terminology drift across distant sections.
4. Plan with missing spec coverage despite plausible per-task detail.

Scenarios 2–4 require crafted fixture documents with planted defects.

Then run the same scenarios with the skill and verify the lead:

- uses `mdedit validate`/`outline` first,
- personally reads the preamble/always-important sections,
- delegates bounded batches,
- collects contract ledgers,
- produces the review-coverage appendix,
- does not claim a complete review without coverage.

## Decisions log

- One skill, two lenses — not separate plan-review and spec-review skills. The
  shared machinery is ~90% of the content; two skills would drift.
- Worker context strategy: preamble + own batch + full outline, with lazy
  `mdedit extract` pulls of foreign sections — not full-document packs (re-bloats
  workers) and not blind shards (forbids cross-boundary discovery).
- Spec handling in plan reviews: outline in pack + lazy pulls + a dedicated
  coverage-matrix worker, because absence of coverage is invisible to distributed
  reviewers.
- Workers must verify against reality: targeted read-only codebase probes, small
  non-destructive throwaway tests, and web checks for external claims.
- No bundled domain lenses; project lens discovered via AGENTS.md.
- Concurrency is a harness setting, not a skill constant.
