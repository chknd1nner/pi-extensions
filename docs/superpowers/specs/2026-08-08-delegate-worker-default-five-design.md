# Delegate Worker Default Five — Design

**Date:** 2026-08-08
**Status:** Approved for written-spec review
**Target release:** `pi-delegate-driven-development` v0.3.2

## Goal

Raise the delegate extension's default concurrent-worker limit from two to five while retaining the existing `DELEGATE_MAX_WORKERS` environment-variable override. Document the behavior and publish it as patch release v0.3.2.

First-class JSON configuration is explicitly deferred.

## Behavior

`delegate_start` will allow up to five simultaneously running workers when `DELEGATE_MAX_WORKERS` is unset, empty, invalid, or not a positive integer. When the environment variable contains a positive integer, that value continues to override the default.

The concurrency check and worker lifecycle remain unchanged. Completed, failed, and aborted workers do not count toward the active limit.

## Changes

- Change the `WorkerManager` fallback supplied by the delegate extension from `2` to `5`.
- Change the `delegate_start` prompt guidance to state that the default is five.
- Document `DELEGATE_MAX_WORKERS`, its positive-integer requirement, and fallback behavior in the bundle README.
- Update all README installation examples to v0.3.2.
- Remove the stale duplicate placeholder v0.3.1 entry from the changelog.
- Add or update focused test coverage for the five-worker default while preserving coverage of the environment-variable override.

No tool names, parameter schemas, worker protocol, or configuration-file formats will change.

## Validation

Before release:

1. Run `npm test -w pi-delegate-driven-development`.
2. Run `npm run typecheck -w pi-delegate-driven-development`.
3. Confirm the README accurately matches the package manifest and contains no stale install versions.
4. Confirm the changed bundle contains no unresolved placeholders or TODOs.

## Release

1. Commit the implementation and documentation changes on `main` and push them to `origin/main` so the release script's clean-and-synchronized precondition is satisfied.
2. Run `scripts/release-bundle.sh pi-delegate-driven-development v0.3.2` with a completed changelog entry.
3. Allow annotated unsigned tags because no signing key is configured and unsigned release tags were approved.
4. Let the release script publish the subtree to `chknd1nner/pi-delegate-driven-development`, create the mirror `v0.3.2` tag, and push the monorepo release commit and `pi-delegate-driven-development-v0.3.2` tag.

## Post-release Verification

Install `git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.2` project-locally in a throwaway directory. Verify that the cache contains the released commit and that a fresh approved non-interactive Pi session reports the `delegate_start` default concurrency guidance as five.

Report the mirror and tag URLs, the install spec, and the post-release verification evidence.
