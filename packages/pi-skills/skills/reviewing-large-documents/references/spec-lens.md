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
