# Replace-prompt provider fallback restoration design

**Date:** 2026-07-16  
**Status:** Approved conversational design; awaiting written-spec review  
**Package:** `packages/replace-prompt`  
**Research:** [`../research/2026-07-16-delegate-check-automatic-turn-prompt-cache-findings.md`](../research/2026-07-16-delegate-check-automatic-turn-prompt-cache-findings.md)

## Summary

Pi 0.80.6 can switch from an extension-replaced system prompt to its unreplaced base prompt between the initial model response and a post-tool continuation when an idle custom message starts an automatic agent run. That switch breaks prompt-cache continuity and, in the observed Anthropic OAuth setup, changes usage classification.

This change will harden `replace-prompt` without modifying Pi, `pi-processes`, or delegate tooling. The extension will remember each successful raw prompt transformation, learn the unique structural location where Pi serialized the replaced prompt in the next provider payload, and inspect only that location on subsequent requests. If Pi restores the original source prompt there, the extension will substitute the exact previously computed replacement.

The design remains provider agnostic. It neither recognizes provider names nor encodes payload field names.

## Goals

1. Preserve the exact replaced system prompt across automatic post-tool provider turns.
2. Preserve cache-prefix continuity when Pi falls back to its base system prompt.
3. Keep arbitrary literal and regex replacement rules, including non-idempotent rules.
4. Keep model-, cwd-, prompt-, and environment-conditional rules isolated to the context in which they were evaluated.
5. Avoid provider-specific payload adapters.
6. Avoid rewriting user messages, tool results, or unrelated payload strings.
7. Fail open when the extension cannot prove that a replacement is safe.
8. Keep normal `before_agent_start` replacement behavior unchanged.

## Non-goals

1. Fix Pi's custom-turn lifecycle inside Pi itself.
2. Modify `pi-processes`, delegate tools, or delegate workflow guidance.
3. Interpret provider cache accounting or guarantee a quota reduction for providers that do not support prompt caching.
4. Support arbitrary composition with other `before_agent_start` system-prompt mutators.
5. Recover a provider payload whose serializer does not contain the replaced prompt as an exact string leaf.
6. Persist transformation state across Pi processes.

## Assumption and documented limitation

This design assumes `replace-prompt` is the only effective extension that mutates the system prompt through `before_agent_start`.

Under that assumption:

- the exact `event.systemPrompt` received by `replace-prompt` is Pi's fallback prompt;
- the exact transformed string returned by `replace-prompt` is Pi's final extension-modified prompt;
- Pi's broken post-tool fallback restores the recorded source string.

Extension ordering matters only when another extension also mutates the system prompt:

- an earlier mutator can make `event.systemPrompt` differ from Pi's private base prompt;
- a later mutator can make the final prompt differ from the result returned by `replace-prompt`.

The package documentation will state this limitation. The provider hook will fail open rather than guessing when its recorded path or strings do not match.

`SYSTEM.md` and `APPEND_SYSTEM.md` are not extension mutations. Pi incorporates applicable global or trusted project files into `_baseSystemPrompt` before invoking `before_agent_start`, and uses the same `_baseSystemPrompt` for its post-tool fallback. Their contents are therefore included in the exact recorded source comparator.

## Existing behavior

Normal user prompts follow this path:

```text
Pi base prompt (BP)
        │
        ▼
before_agent_start
        │
        ▼
replace-prompt applies rules once
        │
        ▼
replaced prompt (RP)
        │
        ▼
all provider turns retain RP
```

An idle custom message with `triggerTurn: true` bypasses `before_agent_start`. Its first provider request can inherit stale RP from `agent.state.systemPrompt`, but Pi's next-turn refresh uses:

```ts
_systemPromptOverride ?? _baseSystemPrompt
```

Because the custom-triggered run established no override, its post-tool request falls back to BP:

```text
custom-triggered request 1: RP
        │
        ▼
tool call and result
        │
        ▼
custom-triggered request 2: BP
```

The second request starts a different prompt-cache lineage.

## Proposed behavior

### Phase 1: compute and remember the transformation

The existing `before_agent_start` handler will continue loading, merging, and applying all configured rules exactly once.

When rules change the prompt, it will remember:

```ts
type PromptTransformation = {
  source: string;
  result: string;
  cwd: string;
  modelKey: string;
  environmentFingerprint: string;
  promptPath?: PromptPath;
};

type PromptPath = Array<string | number>;
```

Where:

- `source` is the exact, unnormalized `event.systemPrompt` supplied by Pi;
- `result` is the exact `result.systemPrompt` returned to Pi;
- `cwd`, `modelKey`, and `environmentFingerprint` identify the supported rule-condition context;
- `promptPath` is initially absent and will be learned from the serialized provider payload.

The handler must record the original event string rather than a normalized intermediate. This preserves exact matching for source prompts containing CRLF or trailing newlines. The existing rule engine may normalize its output as it does today; the recorded result is exactly the string returned to Pi.

If a later `before_agent_start` invocation produces no change, fails to load applicable rules, or is skipped by all conditions, the extension will clear the remembered transformation rather than retain stale state.

### Phase 2: learn the serialized prompt path

The extension will register `before_provider_request`.

When a current transformation has no `promptPath`, the handler will:

1. verify that cwd, model, and environment still match the recorded condition context;
2. recursively inspect payload values, not object keys;
3. collect every structural path whose string value exactly equals `result`;
4. record the path only when exactly one match exists;
5. leave the payload unchanged.

Example discoveries include:

```ts
["system", 1, "text"]
["instructions"]
["systemInstruction"]
["messages", 0, "content"]
["input", 0, "content"]
```

These are examples, not encoded adapters. The extension discovers the actual path from the payload.

Discovery outcomes:

| Exact RP occurrences | Behavior |
|---:|---|
| 0 | Fail open; do not learn a path |
| 1 | Record that path; do not alter the payload |
| 2 or more | Treat as ambiguous; fail open and do not learn a path |

The uniqueness requirement prevents the extension from guessing if, for example, a user message also contains the entire RP during discovery.

### Phase 3: inspect only the learned path

After path discovery, subsequent provider requests do not scan the payload. The handler resolves only the recorded path.

```text
Value at learned path is RP
    → normal request; no-op

Value at learned path is BP
    → replace exact BP with exact RP

Path is missing or value is anything else
    → fail open; no-op
```

This confines repair to the location previously proven to contain the replaced system prompt. User messages, tool results, tool descriptions, and unrelated payload fields are not searched during repair.

The replacement will use copy-on-write structural updates so unrelated payload objects and metadata remain unchanged. It will never rewrite object keys.

## End-to-end sequence

```text
Normal before_agent_start
        │
        ├─ source = exact BP
        ├─ result = rules(BP) = exact RP
        └─ promptPath = unknown
                    │
                    ▼
Normal provider request
        │
        ├─ scan once for exact RP
        ├─ find unique path P
        ├─ remember P
        └─ payload unchanged
                    │
                    ▼
Later automatic custom-triggered request
        │
        ├─ inspect only P
        ├─ value at P is RP
        └─ payload unchanged
                    │
                    ▼
Tool call and result
        │
        ▼
Pi constructs continuation using BP
        │
        ▼
before_provider_request
        │
        ├─ inspect only P
        ├─ value at P is exact BP
        └─ copy-on-write substitution BP → RP
                    │
                    ▼
Provider receives the same RP cache prefix
```

## Context isolation for conditional rules

Supported rule conditions receive:

```ts
type ConditionContext = {
  model?: string;
  cwd: string;
  systemPrompt: string;
  originalSystemPrompt: string;
  env: NodeJS.ProcessEnv;
};
```

The transformation record accounts for every supported conditional input:

- exact `source` covers `originalSystemPrompt`;
- exact `result` captures sequential rule effects on `systemPrompt`;
- `modelKey` isolates model-conditional rules;
- `cwd` isolates project and cwd conditions;
- `environmentFingerprint` detects changes to environment-based conditions.

`modelKey` will include provider, API family, and model ID when available, even though the current public rule context exposes only model ID. This conservative isolation prevents reuse across distinct provider configurations with coincidentally identical model IDs.

The environment fingerprint will be a SHA-256 digest of sorted environment key/value entries. Environment names and values will not be logged or persisted. A changed fingerprint causes a safe no-op until the next normal `before_agent_start` computes a fresh transformation.

Condition functions can technically read external state through JavaScript closures. Such state is outside the documented `ConditionContext` contract and cannot be tracked by this mechanism.

## State lifetime and invalidation

The extension will retain only the latest transformation record. Pi's parent session processes provider turns serially, and each normal agent start refreshes the record.

The record will be cleared when:

1. `before_agent_start` produces no changed prompt;
2. applicable configuration cannot be loaded;
3. all rules are absent, disabled, unmatched, or skipped;
4. a session starts, resumes, forks, or otherwise emits a fresh `session_start` lifecycle event.

The provider hook will not mutate or clear the record merely because a request does not match. A temporary context mismatch or changed payload shape fails open. The next normal `before_agent_start` remains responsible for refreshing state.

## Exact matching and serialization

`before_provider_request` receives a JavaScript payload before HTTP JSON encoding. Newline characters are therefore ordinary string characters, not JSON escape sequences. Existing rule processing normalizes transformed prompt line endings; the record stores:

- the source exactly as Pi supplied it;
- the result exactly as returned to Pi.

Ordinary Unicode, LF, CRLF source strings, trailing newlines, and multiline prompts will be covered by tests. If a provider serializer changes a prompt so it no longer appears as an exact result string, discovery finds zero paths and fails open.

## Helper boundaries

Implementation should keep provider-payload handling independent from rule processing.

A focused helper should provide operations equivalent to:

```ts
findExactStringPaths(payload: unknown, expected: string): PromptPath[];
getValueAtPath(payload: unknown, path: PromptPath): unknown;
replaceValueAtPath(payload: unknown, path: PromptPath, expected: string, replacement: string): {
  value: unknown;
  changed: boolean;
};
```

Requirements:

- support arrays and plain objects;
- inspect values but not object keys;
- preserve array indices in paths;
- return no match for primitives, `null`, functions, and unsupported object types;
- avoid mutating the original payload;
- clone only changed branches during replacement;
- fail safely on invalid or stale paths.

Provider request payloads are JSON-like and should be acyclic. The search helper should nevertheless avoid unbounded recursion on repeated object references, for example with a `WeakSet`.

A separate helper may produce stable model and environment fingerprints if that keeps `index.ts` focused. The implementation plan will choose file boundaries without changing the behavior specified here.

## Logging and observability

Existing optional file logging remains authoritative for rule application.

When logging is enabled, the provider hook will append:

- one informational event when a unique prompt path is learned;
- one informational event each time a fallback prompt is restored;
- one warning per transformation when discovery finds zero or multiple RP locations;
- one warning per transformation when a learned path is stale or invalid.

Warnings are deduplicated within a transformation so an unfamiliar payload does not generate repetitive logs. Logs must not contain:

- BP or RP contents;
- environment names or values;
- serialized payload contents;
- credentials or provider headers.

Normal requests whose learned path still contains RP are expected no-ops and should not produce repetitive log entries.

## Failure behavior

The provider hook is fail-open by design:

| Condition | Behavior |
|---|---|
| No transformation record | Return no replacement |
| Context identity mismatch | Return no replacement |
| RP absent during discovery | Return no replacement |
| RP appears multiple times | Return no replacement |
| Learned path missing or invalid | Return no replacement |
| Learned value is neither BP nor RP | Return no replacement |
| Learned value is RP | Return no replacement |
| Learned value is BP | Return copy-on-write payload containing RP |

The hook must not intentionally block provider requests. Unexpected errors should be allowed to follow Pi's normal extension error reporting while leaving the current payload in place.

## Testing strategy

### Prompt path helper tests

1. Finds a unique exact string in nested objects.
2. Finds paths through nested arrays and mixed array/object structures.
3. Ignores object keys equal to the expected string.
4. Returns zero matches for unrelated values and `null`.
5. Returns multiple paths when the same exact string appears more than once.
6. Does not treat substrings as matches.
7. Replaces only the requested learned path.
8. Uses copy-on-write updates and leaves unrelated branches referentially unchanged.
9. Fails open for missing, stale, or type-invalid paths.
10. Handles repeated object references without unbounded recursion.

### Extension lifecycle tests

1. Registers both `before_agent_start` and `before_provider_request` handlers.
2. Existing normal rule application remains unchanged.
3. A changed normal prompt records exact source and result strings.
4. The first provider request containing unique RP learns a path without changing the payload.
5. A later request containing RP at the learned path is unchanged.
6. A later request containing BP at the learned path is repaired to RP.
7. BP elsewhere in a user or tool message is not changed.
8. Multiple RP occurrences prevent path learning.
9. Zero RP occurrences prevent path learning.
10. Non-idempotent rules such as `foo → foobar` run only once.
11. A later unchanged `before_agent_start` clears stale transformation state.
12. A new successful transformation replaces the previous record and path.
13. Session lifecycle events clear the record.
14. Model mismatch fails open.
15. Cwd mismatch fails open.
16. Environment fingerprint mismatch fails open.
17. Model-, cwd-, and environment-conditional rules do not leak their results across contexts.
18. Cache-control and unrelated payload metadata survive repair unchanged.
19. Multiline, LF, CRLF-source, trailing-newline, and Unicode prompts compare correctly.
20. Optional logs record learning/restoration without prompt or environment contents.

### Manual regression verification

Run the delegate watcher workflow that originally reproduced the issue:

```text
process completion notification
  → automatic model turn
  → delegate_check
  → automatic post-tool model response
```

Verify:

1. the post-tool response succeeds without a manual `continue`;
2. the provider-facing system-prompt hash is identical before and after `delegate_check`;
3. no user/tool payload string outside the learned path changes;
4. provider-reported cache reads improve where the selected model exposes cache accounting;
5. Anthropic OAuth traffic remains on the observed subscription-usage path.

Provider cache accounting is observational verification, not a deterministic unit-test assertion.

## Documentation changes

Update `packages/replace-prompt/README.md` and `packages/replace-prompt/docs/usage.md` to explain:

- automatic post-tool fallback restoration;
- one-time path discovery followed by learned-path lookup;
- provider-agnostic behavior;
- exact-match and fail-open semantics;
- conditional-context isolation;
- the assumption that `replace-prompt` is the only system-prompt-mutating `before_agent_start` extension;
- cache-hit improvements depend on provider support and request characteristics.

## Acceptance criteria

1. Normal provider payloads already containing RP remain unchanged.
2. A later provider payload containing exact BP at the learned prompt path receives exact RP.
3. After discovery, the extension inspects only the learned path rather than rescanning the payload.
4. User messages, tool results, and unrelated strings outside the learned path remain unchanged, even if equal to BP.
5. Arbitrary non-idempotent rules execute only once per normal prompt transformation.
6. Conditional results do not cross model, cwd, or environment boundaries.
7. Applicable `SYSTEM.md` and `APPEND_SYSTEM.md` content participates in the exact source comparator without special handling.
8. Provider payload structures and cache metadata remain otherwise unchanged.
9. Ambiguous or unfamiliar payloads fail open.
10. The original delegate watcher reproduction proceeds automatically beyond `delegate_check`.
11. Existing replace-prompt behavior and tests remain compatible.
12. Package documentation clearly states the extension-ordering assumption and cache limitations.
