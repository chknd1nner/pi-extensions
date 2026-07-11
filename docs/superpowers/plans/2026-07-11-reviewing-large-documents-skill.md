# Reviewing-Large-Documents Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package the `reviewing-large-documents` skill — a hierarchical review workflow for large specs and implementation plans — as a π package under `packages/` in this monorepo, ready to publish to its own mirror repo and wire into projects.

**Architecture:** A docs-only π package (`pi-reviewing-large-documents`) developed under `packages/pi-reviewing-large-documents/` in the `pi-extensions` monorepo and published to a dedicated mirror repo via `scripts/release-bundle.sh`. It contains one skill: a lens-agnostic SKILL.md describing the lead reviewer's loop (outline → tier → batch → pack → dispatch → cross-check → probe → write), plus two reference lenses (`plan-lens.md`, `spec-lens.md`) holding checklists, worker-brief templates, and report contracts. No extensions, no runtime code.

**Tech Stack:** Markdown, YAML frontmatter, `mdedit` (validation), git. Consumed at runtime alongside the `delegate_pack`/`delegate_start` extensions from `pi-delegate-driven-development`.

**Spec:** `docs/superpowers/specs/2026-07-11-reviewing-large-documents-skill-design.md` (in this `pi-extensions` monorepo).

## Global Constraints

- Package root: `packages/pi-reviewing-large-documents/` within this monorepo (repo root `/Users/martinkuek/Documents/Projects/pi-extensions`). Paths below are relative to the package root unless absolute. This is a monorepo package — do NOT create a separate external git repo; follow the repo's `AGENTS.md` packaging rules (own `package.json` with a `pi` manifest, `README`, `keywords: ["pi-package"]`; no nested `node_modules`; no per-package lockfile). Release to the mirror via `scripts/release-bundle.sh` (monorepo tag `pi-reviewing-large-documents-v<version>`, mirror tag `v<version>`).
- This plan builds documentation, not code. Verification per task = objective checks: `mdedit validate`, `wc -w` budgets, `grep` for required sections, `node -e "JSON.parse(...)"` for JSON. Run every check and show output before committing.
- Frontmatter: exactly `name` and `description`; combined under 1024 characters; description third-person, starts with "Use when", never summarizes the workflow.
- No project-specific conventions in any skill file: no project-specific paths (radius, pi-extensions, etc.), no model names, no review-output locations, no domain (iOS/crypto/daemon) content. Projects supply domain guidance via their AGENTS.md ("project lens").
- The bounded resource is waves (round-1 sweep + max 2 follow-up rounds), never worker count. Concurrency is a harness setting — do not encode a worker limit.
- Worker mandate wording (verbatim wherever the plan says VERIFICATION-MANDATE): read-only repo access; throwaway tests only in temp directories, deleted afterward; no git state changes; `web_search`/`fetch_content` allowed for public documentation and external claims; no product services, no remote-state mutation, no live prompts through paid model APIs, no credentials unless explicitly authorized.
- Skill validation (pressure-scenario testing per writing-skills) is **explicitly deferred** by operator decision to a follow-up spec/plan; this plan merges the greenfield skill and records the deferral in the README. Do not add validation tasks.
- Commit after every task with the exact message given.

## Execution Preflight

- [ ] `mdedit --version` succeeds (expect `mdedit 0.1.0` or later). If missing, STOP and ask the operator.
- [ ] Working from the monorepo root `/Users/martinkuek/Documents/Projects/pi-extensions` on a clean tree (or a feature branch off `main`).
- [ ] `ls /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents` fails with "No such file or directory" (greenfield check). If it exists, STOP and ask the operator.

## File Structure Map

```
packages/pi-reviewing-large-documents/
  package.json          # π package manifest — skills only, no extensions
  README.md             # what/requirements/install/status (validation deferred)
  CHANGELOG.md          # 0.1.0
  skills/
    reviewing-large-documents/
      SKILL.md          # lead reviewer loop — lens-agnostic, kept short
      references/
        plan-lens.md    # plan checklists + batch/coverage briefs + report contract
        spec-lens.md    # spec checklists + batch/consistency briefs + report contract
```

---

## Tasks

### Task 1: Scaffold the package repo

**Files:**
- Create: `packages/pi-reviewing-large-documents/package.json`
- Create: `packages/pi-reviewing-large-documents/README.md`
- Create: `packages/pi-reviewing-large-documents/CHANGELOG.md`

**Interfaces:**
- Consumes: the existing monorepo git repo and root npm workspace (`packages/*`).
- Produces: package directory at `packages/pi-reviewing-large-documents/` with `pi.skills = ["./skills"]`; later tasks add files under `skills/reviewing-large-documents/`.

- [ ] **Step 1: Create the package directory (inside the existing monorepo — no `git init`)**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions
mkdir -p packages/pi-reviewing-large-documents/skills/reviewing-large-documents/references
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "pi-reviewing-large-documents",
  "version": "0.1.0",
  "private": false,
  "description": "Hierarchical review workflow for π: review large specs and implementation plans with a compact-context lead reviewer and delegated batch reviewers.",
  "keywords": [
    "pi-package"
  ],
  "repository": {
    "type": "git",
    "url": "https://github.com/chknd1nner/pi-reviewing-large-documents.git"
  },
  "license": "MIT",
  "pi": {
    "skills": [
      "./skills"
    ]
  }
}
```

- [ ] **Step 3: Write `README.md`**

````markdown
# pi-reviewing-large-documents

A π package containing one skill: **reviewing-large-documents** — a hierarchical
review workflow for specs and implementation plans too large (~4k+ lines) to read
whole while preserving reviewer judgment.

A lead reviewer works from `mdedit` outlines and preamble sections only, delegates
deep review of batched sections to isolated workers with a frozen shared context
pack, cross-checks the workers' contract ledgers for cross-boundary defects, and
dispatches bounded targeted probes before writing a severity-tiered review.

Design spec: `docs/superpowers/specs/2026-07-11-reviewing-large-documents-skill-design.md`
in the originating `pi-extensions` monorepo.

## Requirements

- [`mdedit`](https://crates.io/crates/mdedit) on PATH (structured markdown
  outline/extract; the skill fails closed without it).
- The `delegate` extension (`delegate_pack`, `delegate_start`) from
  [pi-delegate-driven-development](https://github.com/chknd1nner/pi-delegate-driven-development).

## Install

Add to a project's `.pi/settings.json`:

```json
{
  "packages": [
    "git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.0",
    "git:github.com/chknd1nner/pi-reviewing-large-documents@v0.1.0"
  ]
}
```

## Layout

```
skills/reviewing-large-documents/
  SKILL.md            # lead reviewer process (lens-agnostic)
  references/
    plan-lens.md      # implementation-plan review lens
    spec-lens.md      # design-spec review lens
```

## Status

v0.1.0 ships the skill untested-by-pressure-scenario. Validation via crafted
fixture documents with planted defects (per the design spec's "Skill validation"
section) is deferred to a follow-up spec/plan and must land before the skill is
considered hardened.
````

- [ ] **Step 4: Write `CHANGELOG.md`**

> No per-package `LICENSE` file: this monorepo keeps licensing in the root and via
> each package.json's `"license": "MIT"` field (matching the other `packages/*`),
> so do not add a `LICENSE` file here.

```markdown
# Changelog

## 0.1.0 — 2026-07-11

- Initial release: `reviewing-large-documents` skill with plan and spec lenses.
- Pressure-scenario validation deferred to a follow-up plan (see README Status).
```

- [ ] **Step 5: Verify**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents
node -e "const p=require('./package.json'); if(!Array.isArray(p.pi.skills)) throw new Error('pi.skills missing'); console.log('package.json OK:', p.name, p.version)"
```
Expected: `package.json OK: pi-reviewing-large-documents 0.1.0`

- [ ] **Step 6: Register the workspace and commit**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions
npm install   # root workspace globs packages/*; refreshes the single root lockfile
git add packages/pi-reviewing-large-documents/package.json packages/pi-reviewing-large-documents/README.md packages/pi-reviewing-large-documents/CHANGELOG.md package-lock.json
git commit -m "chore: scaffold pi-reviewing-large-documents package"
```

---

### Task 2: Write SKILL.md — the lead reviewer loop

**Files:**
- Create: `skills/reviewing-large-documents/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the loop that references `references/plan-lens.md` and `references/spec-lens.md` by exactly those relative paths (Tasks 3–4 must create exactly those filenames). Defines the shared vocabulary used by both lenses: "preamble", "batch", "contract ledger", "foreign pulls", "verification log", "review-coverage appendix".

- [ ] **Step 1: Write `skills/reviewing-large-documents/SKILL.md`**

````markdown
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
````

- [ ] **Step 2: Verify**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents
mdedit validate skills/reviewing-large-documents/SKILL.md
wc -w skills/reviewing-large-documents/SKILL.md
grep -c "references/plan-lens.md\|references/spec-lens.md" skills/reviewing-large-documents/SKILL.md
awk '/^---$/{n++} n==1' skills/reviewing-large-documents/SKILL.md | wc -c
```
Expected: `VALID` with no issues; word count under 1000; grep count ≥ 2; frontmatter byte count under 1024.

- [ ] **Step 3: Commit**

```bash
git add skills/reviewing-large-documents/SKILL.md
git commit -m "feat: add reviewing-large-documents SKILL.md (lead reviewer loop)"
```

---

### Task 3: Write references/plan-lens.md

**Files:**
- Create: `skills/reviewing-large-documents/references/plan-lens.md`

**Interfaces:**
- Consumes: SKILL.md's vocabulary (preamble, batch, contract ledger, foreign pulls, verification log) and the loop step numbers.
- Produces: per-task checklists, the verbatim verification mandate, the batch-worker brief template, the mandatory report format, and the coverage-matrix worker brief — everything the lead needs to dispatch plan-review workers without inventing wording.

- [ ] **Step 1: Write `skills/reviewing-large-documents/references/plan-lens.md`**

````markdown
# Plan Lens — reviewing implementation plans

Load when the document under review is an implementation plan (task-structured,
e.g. `### Task N:` sections). Coverage checking requires the source spec; if no
spec exists, skip the coverage-matrix worker and record that gap in the
review-coverage appendix.

## Batching guidance

- Follow the plan's declared phases/dependency lanes.
- Keep the producer and consumers of the same interface in one batch when word
  counts allow; the contract ledger catches whatever crosses batches anyway.

## Per-task checks (batch workers apply to every task in their batch)

1. **Files** — every `Modify:` path exists in the repo at the stated location
   (verify with `ls` / `rg --files`); every `Create:` path is genuinely new and its
   location follows the project layout; cited line ranges are plausible against the
   real files.
2. **APIs and imports** — every type, function, module, command, or library the
   task references either exists in the repo, is produced by an earlier task, or is
   confirmed against current public documentation. Check the repo — do not trust
   the plan.
3. **TDD shape** — the failing-test step precedes implementation; the stated
   expected failure is what the runner would actually emit; the test exercises the
   claimed behavior rather than restating the implementation.
4. **Executability** — a context-free worker could run this task: no TBD/TODO, no
   "similar to Task N", no symbol used before any task defines it, commands
   runnable exactly as written.
5. **Internal consistency** — the task's Files list, Interfaces block, step code,
   and commit message agree with each other.
6. **Spec conformance** — extract the spec sections this task implements
   (`mdedit extract <spec> "<section>"`) and check the task does what they say and
   nothing that contradicts them.

## Verification mandate (include verbatim in every brief)

> Verify claims against reality, not against the document. You MAY: read any repo
> file; run read-only commands (`rg`, `ls`, `git log`); write small throwaway tests
> in a temp directory (delete them afterward) when logic is testable without
> external services; use `web_search`/`fetch_content` for public documentation and
> external claims. You MUST NOT: modify repo files, change git state, call product
> services, mutate remote state, send live prompts through paid model APIs, or use
> credentials. Every finding needs evidence — repo file:line, probe output, or a
> citation. Findings without evidence are downgraded to concerns.

## Batch worker brief template

Fill every `{SLOT}`. Send as the `delegate_start` task with the shared pack as
`context_pack`.

```text
You are a plan-review batch worker. Review ONLY the tasks in your batch; treat
everything else as context.

Inputs:
- Batch file: {BATCH_FILE} — tasks {TASK_RANGE} extracted from {PLAN_PATH}
  (lines {LINE_RANGE}).
- Your context pack already contains the plan preamble and the outlines of the
  plan and spec.
- Spec: {SPEC_PATH}. Plan: {PLAN_PATH}. Extract any section of either on demand:
  mdedit extract <doc> "<heading>".
- Project conventions — read these files before reviewing: {PROJECT_DOC_PATHS}.

Apply every per-task check in the plan lens (checks 1–6): {LENS_PATH}.

Cross-boundary rule: when a task in your batch assumes anything from a task outside
your batch, record it in the contract ledger. If the assumption is load-bearing or
looks suspicious, extract the foreign section and verify; record the pull and the
result either way.

{VERIFICATION_MANDATE}

Return your report in exactly the "Report format" of the plan lens. A report
missing the contract ledger or verification log will be rejected.
```

## Report format (mandatory footer for batch workers)

```text
## REVIEW REPORT — batch {BATCH_ID}

### Verdicts
- Task {N}: PASS | PASS-WITH-CONCERNS | FAIL

### Findings
- [Blocker|High|Medium|Low] Task {N} (lines {a}–{b}): {one-sentence claim}.
  Evidence: {repo file:line | probe output | citation}.
  Fix: {concrete edit instruction for the plan}.

### Contract ledger
Produces:
- {exact signature / path / wire format, as literally stated} (Task {N})
Consumes:
- {exact expected signature / format} — from Task {M} | from UNKNOWN
Ordering:
- Task {N} must follow Task {M} because {reason}

### Foreign pulls
- {section heading} — why: {reason} — result: {what was found}

### Verification log
- {command} → {result summary}
- throwaway tests: {temp paths} (deleted) | none
```

## Coverage-matrix worker brief template

```text
You are the coverage-matrix worker. Verify the plan covers the spec — in both
directions. Do NOT review task internals; batch workers do that.

Inputs:
- Spec: {SPEC_PATH}. Plan: {PLAN_PATH}. Outlines of both are in your context pack.

Method:
1. Walk the spec outline top to bottom. For each requirement-bearing section,
   mdedit extract it and enumerate its individual requirements.
2. For each requirement, identify the plan task(s) that implement it. Confirm with
   targeted extraction or mdedit search — a matching heading is not confirmation.
3. Reverse pass: for each plan task in the outline, name the spec requirement that
   motivates it, extracting task sections only as needed.

{VERIFICATION_MANDATE}

Report format:

## COVERAGE REPORT
### Coverage matrix
| Spec section | Requirement | Plan task(s) | Confidence (confirmed/heading-only) |
### Orphan requirements (spec requirement → no task)
- {spec section, lines}: {requirement} — severity assessment
### Unmotivated tasks (task → no spec requirement)
- Task {N}: {what it does} — plausible motivation or flag
### Verification log
- {extractions and searches performed}
```
````

- [ ] **Step 2: Verify**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents
mdedit validate skills/reviewing-large-documents/references/plan-lens.md
grep -c "VERIFICATION_MANDATE\|Contract ledger\|Foreign pulls\|Verification log\|Coverage matrix" skills/reviewing-large-documents/references/plan-lens.md
```
Expected: `VALID` with no issues; grep count ≥ 8.

- [ ] **Step 3: Commit**

```bash
git add skills/reviewing-large-documents/references/plan-lens.md
git commit -m "feat: add plan lens (checklists, briefs, report contract)"
```

---

### Task 4: Write references/spec-lens.md

**Files:**
- Create: `skills/reviewing-large-documents/references/spec-lens.md`

**Interfaces:**
- Consumes: SKILL.md's vocabulary and loop; mirrors plan-lens.md's brief/report structure (same verification mandate verbatim, same report skeleton) with a spec-flavored ledger.
- Produces: per-section checklists, terminology & claims ledger definition, batch-worker brief template, report format, internal-consistency worker brief.

- [ ] **Step 1: Write `skills/reviewing-large-documents/references/spec-lens.md`**

````markdown
# Spec Lens — reviewing design specs

Load when the document under review is a design spec (requirements, architecture,
decisions — no task structure yet), typically before an implementation plan exists.

## Batching guidance

- Batch by theme/subsystem following the spec's own top-level structure.
- Put sections that define terms in the same batch as their heaviest users when
  word counts allow; the terminology ledger catches the rest.

## Per-section checks (batch workers apply to every section in their batch)

1. **Internal consistency** — statements in your batch do not contradict each other
   or the preamble sections in your pack.
2. **Ambiguity** — any requirement interpretable two ways: report both readings and
   a recommended disambiguation.
3. **Placeholders** — TBD, TODO, "details later", or vague normative language
   ("appropriate handling", "should generally").
4. **Feasibility** — claims about the existing codebase are true (verify with
   read-only repo probes); claimed external capabilities exist (verify against
   current public documentation with web tools).
5. **Completeness** — within your batch's scope: error paths, migration/compat,
   and testing strategy are addressed or explicitly deferred with a reason.

## Verification mandate (include verbatim in every brief)

> Verify claims against reality, not against the document. You MAY: read any repo
> file; run read-only commands (`rg`, `ls`, `git log`); write small throwaway tests
> in a temp directory (delete them afterward) when logic is testable without
> external services; use `web_search`/`fetch_content` for public documentation and
> external claims. You MUST NOT: modify repo files, change git state, call product
> services, mutate remote state, send live prompts through paid model APIs, or use
> credentials. Every finding needs evidence — repo file:line, probe output, or a
> citation. Findings without evidence are downgraded to concerns.

## Terminology & claims ledger (spec flavor of the contract ledger)

- **Defines:** terms, types, formats, limits, invariants your batch introduces —
  with the exact defining text and location.
- **Uses:** terms your batch relies on that are defined elsewhere (or nowhere) —
  with the meaning your batch's text assumes.
- **Claims:** cross-section assumptions ("section X guarantees Y") — with location.

## Batch worker brief template

Fill every `{SLOT}`. Send as the `delegate_start` task with the shared pack as
`context_pack`.

```text
You are a spec-review batch worker. Review ONLY the sections in your batch; treat
everything else as context.

Inputs:
- Batch file: {BATCH_FILE} — sections {SECTION_LIST} extracted from {SPEC_PATH}
  (lines {LINE_RANGE}).
- Your context pack already contains the spec preamble and full outline.
- Extract any other section on demand: mdedit extract {SPEC_PATH} "<heading>".
- Project conventions — read these files before reviewing: {PROJECT_DOC_PATHS}.

Apply every per-section check in the spec lens (checks 1–5): {LENS_PATH}.

Cross-boundary rule: record every term or guarantee your batch relies on from
other sections in the terminology & claims ledger. If a reliance is load-bearing
or looks suspicious, extract the foreign section and verify; record the pull and
the result either way.

{VERIFICATION_MANDATE}

Return your report in exactly the "Report format" of the spec lens. A report
missing the ledger or verification log will be rejected.
```

## Report format (mandatory footer for batch workers)

```text
## REVIEW REPORT — batch {BATCH_ID}

### Verdicts
- {Section heading}: PASS | PASS-WITH-CONCERNS | FAIL

### Findings
- [Blocker|High|Medium|Low] {Section} (lines {a}–{b}): {one-sentence claim}.
  Evidence: {repo file:line | probe output | citation | both conflicting readings}.
  Fix: {concrete edit instruction for the spec}.

### Terminology & claims ledger
Defines:
- {term} := {exact definition} ({section}, lines {a}–{b})
Uses:
- {term} — assumed meaning: {meaning} — defined in {section} | UNDEFINED
Claims:
- {section} assumes {other section} guarantees {what}

### Foreign pulls
- {section heading} — why: {reason} — result: {what was found}

### Verification log
- {command} → {result summary}
- throwaway tests: {temp paths} (deleted) | none
```

## Internal-consistency worker brief template

```text
You are the internal-consistency specialist. Hunt contradictions and terminology
drift ACROSS the whole spec — batch workers cannot see across their boundaries.
Do NOT re-review section internals.

Inputs:
- Spec: {SPEC_PATH}. Full outline in your context pack.

Method:
1. From the outline and mdedit search, list every term, interface, limit, or
   numeric constant that appears in two or more distant sections.
2. For each, extract the defining section and every using section; compare the
   exact texts.
3. Compare every number/limit stated in more than one place.

{VERIFICATION_MANDATE}

Report format:

## CONSISTENCY REPORT
### Drift table
| Term/constant | Defining site (lines) | Conflicting site (lines) | Exact texts |
### Findings
- [Blocker|High|Medium|Low] {contradiction}: {defining text} vs {conflicting text}.
  Fix: {which reading to keep and where to edit}.
### Verification log
- {searches and extractions performed}
```
````

- [ ] **Step 2: Verify**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents
mdedit validate skills/reviewing-large-documents/references/spec-lens.md
diff <(sed -n '/^> Verify claims against reality/,/^> citation\./p' skills/reviewing-large-documents/references/plan-lens.md) \
     <(sed -n '/^> Verify claims against reality/,/^> citation\./p' skills/reviewing-large-documents/references/spec-lens.md)
```
Expected: `VALID` with no issues; `diff` output empty (mandate identical verbatim in both lenses).

- [ ] **Step 3: Commit**

```bash
git add skills/reviewing-large-documents/references/spec-lens.md
git commit -m "feat: add spec lens (checklists, briefs, report contract)"
```

---

### Task 5: Final verification sweep and handoff

**Files:**
- Modify: none (verification only; fix-forward any failures found, then re-run).

**Interfaces:**
- Consumes: all files from Tasks 1–4.
- Produces: a verified v0.1.0 tree under `packages/pi-reviewing-large-documents/` ready for the operator to release to the mirror via `scripts/release-bundle.sh` and add to project `settings.json`.

- [ ] **Step 1: Structural sweep**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents
for f in skills/reviewing-large-documents/SKILL.md skills/reviewing-large-documents/references/plan-lens.md skills/reviewing-large-documents/references/spec-lens.md README.md CHANGELOG.md; do mdedit validate "$f"; done
```
Expected: five `VALID` lines, no issues.

- [ ] **Step 2: Cross-reference check** — every relative path SKILL.md mentions exists:

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents/skills/reviewing-large-documents
grep -o 'references/[a-z-]*\.md' SKILL.md | sort -u | while read p; do test -f "$p" && echo "OK $p" || echo "MISSING $p"; done
```
Expected: `OK references/plan-lens.md` and `OK references/spec-lens.md`; no `MISSING`.

- [ ] **Step 3: Convention checks**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/packages/pi-reviewing-large-documents
grep -n "radius\|pi-extensions\|docs/superpowers/reviews\|apps/radius\|iOS\|SwiftUI" skills/reviewing-large-documents/*.md skills/reviewing-large-documents/references/*.md; echo "exit=$?"
grep -rn "TBD\|TODO" skills/ ; echo "exit=$?"
```
Expected: both greps find nothing (`exit=1`). Any hit is a hardcoded-convention or placeholder violation — fix and re-run.

- [ ] **Step 4: Confirm commit history (do NOT create a bare `v0.1.0` tag here — the release script owns tagging)**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions
git log --oneline -5
```
Expected: the 4 task commits (scaffold, SKILL.md, plan lens, spec lens) at the tip. Tagging happens in Step 5 via `scripts/release-bundle.sh`, which creates the monorepo tag `pi-reviewing-large-documents-v0.1.0` and the mirror tag `v0.1.0` — never tag `v0.1.0` on the monorepo directly.

- [ ] **Step 5: Report handoff steps to the operator** (do not perform them). Read `skills/releasing-a-bundle/SKILL.md` first; the release is operator-driven:
  1. Create the mirror repo (first release only): `gh repo create chknd1nner/pi-reviewing-large-documents --public --description "Pi package: pi-reviewing-large-documents"`.
  2. From the monorepo root on a clean `main` in sync with origin, run `scripts/release-bundle.sh pi-reviewing-large-documents v0.1.0` (add `--dry-run` first to preview). This bumps the package version, updates its `CHANGELOG.md`, commits `release(pi-reviewing-large-documents): v0.1.0`, tags the monorepo `pi-reviewing-large-documents-v0.1.0`, and pushes the mirror with tag `v0.1.0`.
  3. Add `"git:github.com/chknd1nner/pi-reviewing-large-documents@v0.1.0"` to consuming projects' `.pi/settings.json`.
  4. Next piece of work: validation spec/plan (fixture documents with planted defects per the design spec's "Skill validation" section).

---

## Dependency and Review Lanes

- Task 1 → Task 2 → Tasks 3 and 4 (either order, both consume SKILL.md vocabulary) → Task 5.
- Single review lane; the deliverables are documents, so reviewers should check content against the design spec, not just structure.

## Self-Review Results

**Spec coverage:** Goals/architecture/loop → SKILL.md (Task 2). Worker report contract + plan flavor → plan-lens.md (Task 3). Spec flavor + specialists → spec-lens.md (Tasks 3–4). Frontmatter → Task 2 step 1 (matches spec verbatim). Guardrails → SKILL.md Guardrails section. Layout/packaging → Task 1. "Skill validation" spec section → explicitly deferred by operator decision, recorded in Global Constraints and README Status. No other spec section is unimplemented.

**Placeholder scan:** the only TBD/TODO strings in this plan are inside the lens checklists and the Task 5 grep (they instruct detection of placeholders, not placeholders themselves). All `{SLOT}` tokens are template slots by design, documented as such in the lenses.

**Type/signature consistency:** SKILL.md references `references/plan-lens.md`/`references/spec-lens.md`; Tasks 3–4 create exactly those paths (checked mechanically in Task 5 step 2). Report skeleton (Verdicts/Findings/ledger/Foreign pulls/Verification log) is identical across lenses except the ledger flavor, and the verification mandate is byte-identical (checked mechanically in Task 4 step 2).
