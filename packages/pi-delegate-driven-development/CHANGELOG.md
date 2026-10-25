# Changelog

## v0.4.3 - 2026-10-25

- **Root cause fix for watchers that wait on a status that can never be emitted.** The worker status vocabulary (`running | completed | failed | aborted`) lived only in a TypeScript type, and the only prose statement of the full set in the whole package was one README line. The status file is bare text with no schema, so orchestrators writing a watcher had to guess — and the workflow supplies near-miss words: tickets use `done` and `blocked`, which can never appear in a status file, and `DELEGATE_WATCH_TIMEOUT` looks like a status but is never written to the file (the file still reads `running` when a watcher gives up). A watcher waiting for any of those hangs until something else kills it. The vocabulary is now stated in the `delegate_start` result message, in the `delegate_start` tool guidelines, in the README, and in the skill.
- **Deleted `skills/delegate-driven-development/references/wait.sh`.** The skill told orchestrators to run it while the README told consumers to use `details.watch.command`: two watchers with different output (`wait.sh` emitted no `task_id`, so an alert could not be attributed across concurrent workers), different exit codes (1 vs 124), and different parsers of the same file (whole-content match vs first line). Only the generated watcher is test-pinned, so drift was one-sided and silent. The skill now points at `details.watch.command` and says plainly not to hand-write a watcher.
- **`delegate_check.last_activity_seconds_ago` no longer resets at settle.** The idle-clock guard excluded `agent_end` but not `agent_settled`, which is now the terminal event, so a completed worker's idle time was measured from settle instead of from its last real output. Terminal events are now a set of both.
- **Documented what that field actually measures: process liveness, not visible output.** Retry and compaction bookkeeping count as activity on purpose, so a worker π is retrying or compacting reads as alive. README and the skill both say a small value means the process is talking, not that it is producing text.
- **Removed the `finished` flag and `isFinished()` from the progress accumulator.** It was set on the first low-level run, had zero production callers, and its name invites exactly the question it could no longer answer. Its test pinned the pre-v0.4.0 contract, so anyone fixing it would have been told they broke a passing test. Terminal state has one home: the finalize guard plus `WorkerManager` status.
- **Skill adds a three-vocabulary note** separating worker process status, ticket status, and the worker's own `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` / `VERDICT: PASS|FAIL` report, and noting that `delegate_abort` writes `aborted`, never `cancelled`.
- Tests: 6 new cases across the two changes, mutation-verified. Restoring the old idle-clock guard fails 1 test, excluding only `agent_settled` fails 2, and making compaction not count as activity fails 1.

## v0.4.2 - 2026-10-25

- Automatic compaction is now visible in the progress log. π emits `compaction_start`, `compaction_end`, and `summarization_retry_scheduled` on the RPC event stream and the extension was discarding all three, so a worker that hit its context limit went silent for the entire summarization call — a model call that can run for a minute or more. That silence looks identical to a hung worker and invited `delegate_abort` at exactly the moment the worker was most likely to recover.
- New markers: `[COMPACT overflow: summarizing context]` / `[COMPACT threshold: summarizing context]` when it starts, `[COMPACT done: 150000 → 32000 tokens]` (plus `, resuming interrupted turn` when π replays the interrupted turn) when it succeeds, `[COMPACT failed: <reason>]` when recovery fails, `[COMPACT aborted]` when it was cancelled, and `[COMPACT retry 1/3 in 2000ms: <error>]` when the summarization request itself is retried.
- The trigger is named on purpose: `overflow` means the worker hit its context limit and π is recovering; `threshold` means π compacted proactively between runs and the worker was never in trouble.
- Skill and README updated so the orchestrator reads these markers instead of guessing what a silent gap means.
- Tests: 8 new lifecycle cases, mutation-verified — suppressing compaction markers entirely fails 8 tests, dropping the start case fails 3, ignoring `willRetry` fails 2, dropping the aborted and summarization-retry cases fail 1 each.

## v0.4.1 - 2026-10-25

- A prompt rejected before acceptance (unknown model, missing credentials, expired auth), or consumed by an extension command without starting a run, now fails immediately with the reason π reported on the wire, instead of sitting `running` until its timeout and reporting only "Timed out".
- `agent_settled` arriving without a preceding `agent_end` now reports `failed` ("worker settled without completing an agent run") rather than an empty `completed`.
- Events arriving after settle are ignored, and the progress log no longer reopens its file after close. A run started by a worker extension's `agent_settled` handler could previously overwrite a completed worker's reported output.
- Failure reasons are collapsed to a single line and capped at 500 characters, so a provider HTML error page cannot flood the orchestrator's context. A failure with neither a model message nor stderr now states that explicitly.
- Corrected retry markers: `[RETRY succeeded on retry N]` and `[RETRY gave up after N retries: <error>]`. π's `attempt` counts retries rather than total attempts, and `success: false` also covers non-retryable and cancelled retries, which are not "exhausted".
- Worker crashes (`onExit`) and transport errors now share the finalize path, so they emit a `[FAILED]` progress marker like every other failure.
- Skill fixes: the `process` tool parameters it documented (`alertOnSuccess`, `alertOnFailure`, `logWatches`) do not exist — corrected to `notify`. Added guidance for handling delegate-level `failed`/`aborted`, for telling a retrying or compacting worker apart from a stuck one, and for sizing worker timeouts with headroom.
- Tests: the v0.4.0 lifecycle tests did not distinguish the settle fix from the original bug — mutation testing confirmed a `pendingOutcome ??=` regression passed all 181. Added 11 cases; the mutants are now killed. Also fixed a mock leak where `vi.clearAllMocks()` left `getStderr` implementations set across tests.

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
