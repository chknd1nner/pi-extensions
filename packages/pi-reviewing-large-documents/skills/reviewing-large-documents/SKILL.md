---
name: reviewing-large-documents
description: Use when reviewing large specs, implementation plans, or task documents that are too large to keep fully in context while preserving judgment
---

# Reviewing Large Documents

**Announce at start:** "I'm using the reviewing-large-documents skill to run this review."

You are the **lead reviewer**. For documents large enough to trigger this skill, you
do not load the full document into context by default. Your context budget: outlines
+ preamble sections + worker reports + targeted extracts. Wanting to read a full
phase is the signal to dispatch a worker instead.

## When to use

- Reviewing a spec or implementation plan too large to read whole while keeping
  capacity for judgment (rule of thumb: 2,000+ lines or 10,000+ words).
- NOT for post-implementation code review — use the project's review process.
- NOT for documents that fit comfortably in context alongside your other work —
  just read those.

## Requirements

- `mdedit` on PATH (`mdedit --version` — if missing, stop and tell the operator).
- `delegate_pack` + `delegate_start` (pi-delegate-driven-development extensions).
- A lens, read before dispatching anything:
  - implementation plan under review → `references/plan-lens.md`
  - design spec under review → `references/spec-lens.md`

## The loop

1. **Triage** — `mdedit validate <doc>` then `mdedit outline <doc>` for every
   document under review (plan, and spec if one exists). The outline — headings,
   word counts, line ranges — is your map. Do not read the body.
2. **Tier** — classify sections from the outline:
   - **Preamble:** global constraints, goals/invariants, architecture overviews,
     file structure maps, risk registers, dependency lanes. Read these via
     `mdedit extract`.
   - **Body:** tasks (plan) or topic sections (spec). Reviewed only by workers.
3. **Batch** — group body sections along the document's declared phases/dependency
   lanes, balancing by outline word counts. Target: preamble + batch well under
   ~10,000 words per worker. Keep producers and consumers of the same interface in
   one batch when word counts allow. The document dictates how many batches exist;
   the harness concurrency limit only dictates scheduling.
4. **Pack** — `mdedit extract --to-file` each preamble section, save each document's
   outline to a file, and freeze them with `delegate_pack`. Put the document paths
   and the review framing in the pack note.
5. **Project lens** — check the document's surface area against the project's
   AGENTS.md task-specific references; list the relevant project doc paths for
   worker briefs. This skill ships no domain knowledge — the project supplies it.
6. **Dispatch round 1** — one worker per batch plus the lens's specialist worker
   (coverage-matrix for plans, internal-consistency for specs), briefed from the
   lens's templates. Extract each batch to a file (`mdedit extract --to-file`) and
   pass the path in the brief. High-risk batches may get a second independent
   reviewer.
7. **Cross-check** — join the contract ledgers across all reports:
   - Match every **consumes** claim against a **produces** claim. Exact-signature
     mismatch = confirmed finding, no extraction needed. Consumed-but-never-produced
     = likely blocker.
   - Validate **ordering claims** against the document's declared dependency order.
   - Read **foreign pulls** as a discovered dependency map; compare it with the
     declared one.
8. **Follow-up rounds (max 2)** — for each unresolved mismatch or suspected
   cross-batch risk, dispatch a small probe worker with a tight brief: which
   sections to extract, what to compare, which read-only commands to run. After two
   rounds, unresolved risks go into the review as explicit open questions, each
   with a recommended probe.
9. **Verify personally** — before publishing, extract and read: every blocker's
   cited section, every claimed ledger mismatch, and any finding that rests on
   ambiguous interpretation. Workers propose; you confirm.
10. **Write** — severity-tiered review (Blockers / High / Medium / Low / things
    done right / recommended edits), findings quoted with section + line refs and
    worker evidence, plus a **review-coverage appendix**: which batches went to
    which workers, what was probed, and what was not. Save per project convention
    (discover it — never assume a path).

## Guardrails

- **Evidence or downgrade:** a finding without repo file:line, probe output, or
  citation is a concern, not a finding. Implausibly fast worker verification is
  unverified — check the verification log, not the exit banner.
- **Non-destructive workers:** read-only repo access; throwaway tests only in temp
  directories, deleted afterward; no git state changes. Web tools for public
  documentation are allowed; product services, remote-state mutation, live prompts
  through paid model APIs, and credentials are forbidden unless explicitly
  authorized.
- **Report contract is mandatory:** a worker report missing the ledger or the
  verification log gets sent back, not interpreted charitably.
- **Bounded waves:** one round-1 sweep plus at most two follow-up rounds.

## Red flags — stop and correct course

- "It's only X lines, I'll just read the whole thing" — outline first; if it truly
  fits in context, this skill doesn't apply.
- Reading body sections "to get oriented" — orientation is the preamble's job.
- Publishing a blocker you have not personally verified against the document.
- Accepting a cross-batch claim with no matching ledger entry.
- Skipping the specialist worker because batch reviews "look clean" — absence of
  coverage is invisible in batch reports.
