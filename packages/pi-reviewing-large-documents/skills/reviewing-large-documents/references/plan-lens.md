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
