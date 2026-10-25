# Changelog

## v0.4.0 - 2026-10-25

- Bug fix: delegate workers are finalized when π reports `agent_settled` instead of at the first `agent_end`. The previous behaviour closed the worker's stdin after one low-level run, which killed workers on transient provider and network errors before π's automatic retry could fire.
- Failed workers now report a reason: the assistant `errorMessage`, falling back to the tail of the worker's stderr, surfaced through `delegate_check` and `delegate_result`.
- The progress log records automatic retry activity (`[RETRY 1/3 in 2000ms: 529 overloaded]`, `[RETRY resolved after 2 attempts]`, `[RETRY exhausted after 3 attempts: <error>]`) and the failure reason (`[FAILED] <error>`), so a retrying worker is distinguishable from a hung one.
- Closes chknd1nner/pi-extensions#6.

## v0.3.2 - 2026-08-08

- Raise the default delegate worker concurrency limit from two to five.
- Document and strictly validate the `DELEGATE_MAX_WORKERS` positive-integer override.

## v0.3.1 - 2026-07-24

- Bug fix: normalize tool names to lowercase in delegate_start to handle
  LLMs passing capital-case names like "Read", "Edit", "Write" in the
  tools or denied_tools allowlists.

## v0.3.0 - 2026-06-11

- Add `delegate_pack` tool: compile ordered files (plus optional note) into a frozen, named context pack under `.pi/delegate/<date>/packs/<name>.jsonl`
- Add `context_pack` parameter to `delegate_start`: workers receive the pack as an identical message prefix (name resolved newest-date-first, or explicit path); composes with `inherit_context` (anchor first, pack appended)
- Add `system_prompt_file` parameter to `delegate_start`: role prompt files are read at spawn time and forwarded as the worker system prompt (mutually exclusive with `system_prompt`)
- `buildSessionSnapshot` now accepts a nullable session manager and appends re-identified pack entries
- delegate-driven-development skill: orchestrate via context packs + `system_prompt_file` instead of anchor-first choreography; new cache-discipline and resume guidance
- Role templates (implementer/reviewer/fixer) rewritten in system-prompt voice with no `{{…}}` placeholders

## v0.2.0 - 2026-06-11

- Add relative delegate progress/status artifact paths to `delegate_start` results.
- Add a self-contained status-file wait recipe via `details.watch.command`.
- Update delegate guidance and docs to prefer composable waiting over tight `delegate_check` polling.

## v0.1.0 - 2026-06-08

- Initial release.
- delegate extension: delegate_start, delegate_check, delegate_steer, delegate_abort, delegate_anchor, delegate_result.
- session extension: session_entries.
- tickets extension: ticket_shard, ticket_list, ticket_show, ticket_move, ticket_set, ticket_next, ticket_get.
- delegate-driven-development skill bundled.
