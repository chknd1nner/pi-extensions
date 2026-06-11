# Changelog

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
