# `delegate_check` automatic-turn prompt and cache findings

**Date:** 2026-07-16  
**Status:** Investigation complete; mitigation design not yet approved  
**Observed with:** Pi `@earendil-works/pi-coding-agent` 0.80.6, `@aliou/pi-processes` 0.9.4, Anthropic OAuth, local `replace-prompt`, and `pi-delegate-driven-development`

## Executive summary

The reported `400: You're out of extra usage` response is not thrown by `delegate_check`. The tool completes locally, and Anthropic rejects the **next model request**, when the parent agent attempts to interpret the tool result.

The source-level cause is a lifecycle mismatch in Pi 0.80.6:

1. Normal user prompts emit `before_agent_start`, allowing `replace-prompt` to set a per-run system-prompt override.
2. An idle custom message sent with `{ triggerTurn: true }` starts `_runAgentPrompt()` directly and does **not** emit `before_agent_start`.
3. The custom-triggered run's first provider request can inherit the previously replaced prompt from `agent.state.systemPrompt`.
4. Before the post-tool provider request, Pi refreshes the context using `_systemPromptOverride ?? _baseSystemPrompt`.
5. Because the custom-triggered run never established `_systemPromptOverride`, the post-tool request switches to the unreplaced base prompt.

In the observed environment, the replaced prompt correlates with ordinary Claude subscription usage, while the unreplaced prompt correlates with the extra-usage rejection. The mid-run prompt switch also changes the system-prefix cache key, breaking cache continuity.

`delegate_check` appears special only because it is normally the first tool called after an automatic worker-watcher completion notification. Session evidence also contains the same error immediately after `bash` and `delegate_result` tool results.

## Scope and terminology

This report distinguishes:

- **BP — base prompt:** Pi's unreplaced system prompt.
- **RP — replaced prompt:** the effective system prompt after `replace-prompt` applies its configured rules.
- **Agent run:** the complete `_runAgentPrompt()` lifecycle, potentially containing several provider turns and tool executions.
- **Provider turn:** one request to Anthropic and one assistant response.
- **Custom-triggered run:** an agent run started by `sendCustomMessage(..., { triggerTurn: true })` while Pi is idle.

A tool result does not normally start a separate agent run. It causes another provider turn inside the same run.

## User-visible observations

The investigation began from these observations:

1. Ordinary prompts consume visible Claude subscription quota while `replace-prompt` is active.
2. After an automatic watcher completion, the model successfully calls `delegate_check`.
3. Pi then displays `400: You're out of extra usage` instead of interpreting the result.
4. The rejected assistant entries report zero usage, consistent with rejection before generation.
5. Manually entering `continue` shortly afterward works and again consumes subscription quota.

The short recovery interval argues against ordinary quota replenishment. Across the scanned local session history:

- 51 assistant errors matched `You're out of extra usage`.
- 50 had a later user prompt followed by a successful assistant response before another user prompt.
- In the fastest example, the user prompt followed the error after 1.484 seconds and a successful response followed after 3.787 seconds.
- 13 recoveries completed within 30 seconds of the error; 30 completed within 120 seconds.

The immediate session predecessor of the 51 matching errors was:

| Preceding message | Matching errors |
|---|---:|
| `delegate_check` tool result | 42 |
| `bash` tool result | 6 |
| `delegate_result` tool result | 3 |

These counts establish that the symptom is not exclusive to `delegate_check`.

> The session scan is local empirical evidence, not a controlled experiment. Counts include all matching stored sessions available during the investigation.

## Existing failing sequence

### High-level sequence

```text
Normal user turn
      │
      ▼
before_agent_start
      │
      ▼
replace-prompt: BP → RP
      │
      ▼
Provider requests use RP / Cache A
      │
      ▼
run ends
      │
      ├─ _systemPromptOverride cleared
      └─ agent.state.systemPrompt still contains RP
                  │
                  ▼
        Watcher process completes
                  │
                  ▼
       custom message + triggerTurn
                  │
                  ▼
    before_agent_start is SKIPPED
                  │
                  ▼
       First request inherits RP
       Cache A / subscription usage
                  │
                  ▼
         model calls delegate_check
                  │
                  ▼
       delegate_check runs locally
                  │
                  ▼
       Pi prepares post-tool turn
                  │
                  ▼
 override undefined → fall back to BP
                  │
                  ▼
        Request uses BP / Cache B
                  │
                  ▼
       Anthropic: extra-usage 400
```

### State transition table

| Stage | `_systemPromptOverride` | `agent.state.systemPrompt` or request context | Effective outgoing prompt |
|---|---|---|---|
| Normal prompt after `before_agent_start` | RP | RP | RP |
| Normal run finishes | `undefined` | RP remains in state | No request |
| Idle custom-triggered run begins | `undefined` | First snapshot reads RP | RP |
| Model calls a tool | `undefined` | Tool executes locally | No request |
| Pi prepares next provider turn | `undefined` | `_systemPromptOverride ?? _baseSystemPrompt` | BP |
| Post-tool request | `undefined` | BP | BP, then rejection |

### Detailed sequence diagram

```mermaid
sequenceDiagram
    participant U as User
    participant RPX as replace-prompt
    participant PI as Pi AgentSession
    participant PROC as pi-processes
    participant D as delegate_check
    participant A as Anthropic

    U->>PI: Normal user prompt
    PI->>RPX: before_agent_start(BP)
    RPX-->>PI: RP
    PI->>A: Provider request with RP
    A-->>PI: Assistant response
    Note over PI: Run settles; override cleared,<br/>state may still contain RP

    PROC->>PI: Custom process update, triggerTurn=true
    Note over PI: sendCustomMessage calls<br/>_runAgentPrompt directly;<br/>before_agent_start is skipped
    PI->>A: First automatic request inherits RP
    A-->>PI: tool_use(delegate_check)
    PI->>D: execute(task_id)
    D-->>PI: Local worker summary
    Note over PI: prepareNextTurn chooses<br/>undefined override ?? BP = BP
    PI->>A: Post-tool request with BP
    A-->>PI: 400 extra-usage error

    U->>PI: "continue"
    PI->>RPX: before_agent_start(BP)
    RPX-->>PI: RP
    PI->>A: Request with RP
    A-->>PI: Successful response/tool call
```

## Source-code evidence

### 1. Process completion uses a custom trigger

`@aliou/pi-processes` 0.9.4 determines whether a process completion should wake the agent and calls:

```ts
safeSendMessage(
  pi,
  {
    customType: MESSAGE_TYPE_PROCESS_UPDATE,
    content: message,
    display: true,
    details,
  },
  { triggerTurn: triggerAgentTurn },
);
```

Reference:

- `~/.pi/agent/npm/node_modules/@aliou/pi-processes/src/hooks/process-end.ts:25-67`

This behavior is valid usage of Pi's extension API. The relevant lifecycle asymmetry occurs inside Pi after it receives the message.

### 2. Idle custom-triggered runs bypass `before_agent_start`

Pi 0.80.6 documents and implements three custom-message cases. In the idle `triggerTurn` branch, it directly invokes `_runAgentPrompt(appMessage)`:

```js
else if (options?.triggerTurn) {
    await this._runAgentPrompt(appMessage);
}
```

There is no `emitBeforeAgentStart(...)` call in this path.

Reference:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1040-1071`

### 3. Normal user prompts do emit `before_agent_start`

The normal `prompt()` path calls:

```js
const result = await this._extensionRunner.emitBeforeAgentStart(
    expandedText,
    currentImages,
    this._baseSystemPrompt,
    this._baseSystemPromptOptions,
);
```

It then stores an extension-provided prompt in both `_systemPromptOverride` and `agent.state.systemPrompt`.

Reference:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:776-898`
- In particular: `:864-887`

### 4. `replace-prompt` depends on `before_agent_start`

The local extension registers only a `before_agent_start` handler for prompt replacement. When rules change the prompt, it returns `{ systemPrompt: result.systemPrompt }`.

Reference:

- `packages/replace-prompt/index.ts:23-71`

Consequently, any new agent-run path that skips `before_agent_start` also skips the extension's normal replacement mechanism.

### 5. The first custom request snapshots `agent.state.systemPrompt`

The agent core begins a prompt run using `createContextSnapshot()`, which reads the current state:

```js
createContextSnapshot() {
    return {
        systemPrompt: this._state.systemPrompt,
        messages: this._state.messages.slice(),
        tools: this._state.tools.slice(),
    };
}
```

Reference:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent.js:219-300`
- In particular: `:263-276`

Pi clears `_systemPromptOverride` when `_runAgentPrompt()` finishes, but that `finally` block does not restore `agent.state.systemPrompt`:

```js
finally {
    this._systemPromptOverride = undefined;
    // ...
}
```

Reference:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:728-741`

Together, these behaviors explain how the first custom-triggered request can inherit RP even though the per-run override is already undefined.

### 6. Post-tool turns explicitly refresh to the base prompt when no override exists

Pi installs a next-turn refresh that chooses:

```js
context: {
    ...previousContext,
    systemPrompt: this._systemPromptOverride ?? this._baseSystemPrompt,
    tools: this.agent.state.tools.slice(),
}
```

Reference:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:235-253`

This is the exact RP-to-BP transition in the failing custom-triggered run.

### 7. `delegate_check` is local

`delegate_check`:

- looks up a worker in the local manager;
- reads progress and accumulated usage;
- calculates elapsed time and context percentage;
- formats text and details;
- returns a tool result.

It does not call Anthropic or start a separate provider request.

Reference:

- `packages/pi-delegate-driven-development/extensions/delegate/index.ts:646-706`

The provider request happens afterward because the agent loop needs an assistant response that interprets the tool result.

### 8. Anthropic OAuth serializes the effective prompt into a cached system block

For OAuth, Pi's Anthropic adapter constructs `params.system` with:

1. a Claude Code identity block; and
2. a block containing `context.systemPrompt`.

Both may carry `cache_control`. The provider payload hook runs after these parameters are built and before `client.messages.create(...)`.

References:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:330-354`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:671-705`

## Why `delegate_result` works after manual `continue`

Typing `continue` starts a normal user-prompt run:

```text
manual "continue"
        │
        ▼
AgentSession.prompt()
        │
        ▼
before_agent_start runs
        │
        ▼
replace-prompt sets override = RP
        │
        ▼
model calls delegate_result
        │
        ▼
tool returns result
        │
        ▼
next-turn refresh evaluates RP ?? BP = RP
        │
        ▼
post-tool request keeps RP and succeeds
```

`_systemPromptOverride` remains active for the entire `_runAgentPrompt()` operation, including all provider turns and tool results. It is cleared only after the run settles.

Therefore, the deciding factor is the **origin of the agent run**, not the tool name:

| Agent-run origin | `before_agent_start` runs? | Post-tool prompt | Expected observed behavior |
|---|---:|---|---|
| Normal user prompt | Yes | RP | Works |
| Manual `continue` | Yes | RP | Works |
| Idle custom message with `triggerTurn: true` | No | Falls from stale RP to BP | Fails after first tool |

If `delegate_result`, `bash`, `read`, or another ordinary tool is the first tool in the broken custom-triggered run, its post-tool request is exposed to the same transition. If the model answers the custom notification without using a tool, there is no post-tool provider request, so the transition may remain hidden.

## Prompt-cache effect

A stable run should extend one prefix:

```text
Request 1
┌─────────────────────────────────────────┐
│ RP │ history │ process notification     │
└──────────────── Cache A ────────────────┘

Request 2
┌────────────────────────────────────────────────────────────┐
│ RP │ history │ process notification │ tool call │ result   │
└──────────────── same Cache A prefix ───────────────────────┘
```

The failing run changes the first variable component of the cached system prefix:

```text
Request 1
┌─────────────────────────────────────────┐
│ RP │ history │ process notification     │
└──────────────── Cache A ────────────────┘

Request 2
┌────────────────────────────────────────────────────────────┐
│ BP │ history │ process notification │ tool call │ result   │
└──────────────── Cache B / different prefix ────────────────┘
```

Because the system prompt precedes the conversation, the RP-to-BP change prevents the second request from extending the first request's effective cached prefix. If the request is rejected before execution, no new generation usage is recorded; if accepted in another billing state, it would follow the BP cache lineage rather than the current RP lineage.

## What is proven and what remains inferred

### Established from source and session data

- `delegate_check` returns successfully before the error.
- The matching errors occur on assistant requests immediately following tool results.
- The error is not exclusive to `delegate_check`.
- Idle custom `triggerTurn` bypasses `before_agent_start` in Pi 0.80.6.
- Normal user prompts run `before_agent_start`.
- `replace-prompt` currently applies replacements through that event.
- The first custom request snapshots the existing state prompt.
- Post-tool context refresh falls back to BP when the override is undefined.
- Manual prompts re-establish the override for the complete run.
- A changed system prompt creates a different provider cache prefix.

### Strongly supported but not directly observed inside Anthropic

- Anthropic's backend classification changes because the effective system prompt changes from RP to BP.
- RP is the feature responsible for subscription-quota classification in this environment.

Those conclusions are supported by the user's Claude usage dashboard, the immediate manual recovery, zero-token rejections, and the source-level prompt transition. Anthropic's internal classifier is not observable, so the exact backend rule should not be stated as independently proven.

### Optional definitive confirmation

A temporary `before_provider_request` diagnostic could record only safe metadata for consecutive requests:

- a cryptographic hash of the serialized system blocks;
- whether the configured replacement rule has been applied;
- the preceding conversation role (`user` or `toolResult`);
- response status from `after_provider_response`.

It should not log prompt contents. The expected failing trace is:

```text
automatic request 1: system hash RP, replacement present, response 200
post-tool request 2: system hash BP, replacement absent, response 400
manual continue:      system hash RP, replacement present, response 200
```

## Extension-only mitigation candidates for subsequent brainstorming

No third-party source modification is strictly required.

### Candidate A: outgoing enforcement in `replace-prompt`

Pi documents `before_provider_request` as running after provider serialization and before transmission. An extension can return a replacement payload. A defensive handler could ensure the provider-facing system text has the configured replacement on every request, including custom-triggered and post-tool requests.

Potential advantages:

- fixes all automatic-turn origins, not just delegate workflows;
- directly enforces the provider-facing invariant;
- can preserve Anthropic system block order and `cache_control` metadata;
- requires no changes to Pi or `pi-processes`.

Questions for design:

- whether `before_agent_start` remains primary with provider-level enforcement as a safety net;
- how to make arbitrary replacement rules idempotent;
- how to support provider-specific payload shapes safely;
- extension ordering if another extension modifies the payload later;
- what diagnostics and tests demonstrate cache stability without logging sensitive prompts.

### Candidate B: delegate-owned completion wake-up

The delegate extension could send completion through `pi.sendUserMessage(...)`, which follows the normal `prompt()` path and emits `before_agent_start`. This would require replacing or suppressing the current process-watcher wake-up and correctly handling completion while the parent agent is already streaming.

Potential disadvantages:

- fixes delegate workflows only;
- adds notification and concurrency responsibility to the delegate extension;
- risks duplicate wake-ups unless watcher behavior changes;
- is more invasive than provider-level enforcement.

### Candidate C: terminate after `delegate_check`

Stopping the agent after the tool result and waiting for a human prompt avoids the failing post-tool request, but breaks automatic orchestration. It is a symptom workaround, not a substantive fix.

The leading extension-only direction for brainstorming is Candidate A. This report does not approve or specify its implementation.

## Desired invariant

Any eventual solution should enforce:

> Once an agent run begins, every provider request in that run must use the same effective replaced system prompt, including the initial request, every tool-result continuation, queued follow-ups, and retries.

At the provider boundary, the stronger form is:

> No applicable provider request may leave Pi with an unreplaced system prompt.

## Primary references

Repository files:

- `packages/replace-prompt/index.ts:23-71`
- `packages/pi-delegate-driven-development/extensions/delegate/index.ts:646-706`
- `packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-check.test.ts`
- `packages/pi-delegate-driven-development/README.md`
- `docs/pi/docs/extensions.md:513-548, 670-693`

Installed dependency files inspected:

- Pi 0.80.6: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:235-253, 728-741, 776-898, 1040-1071, 1085-1114`
- Pi agent core 0.80.6: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent.js:219-300`
- Pi Anthropic adapter 0.80.6: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:330-354, 671-705`
- `pi-processes` 0.9.4: `~/.pi/agent/npm/node_modules/@aliou/pi-processes/src/hooks/process-end.ts:25-67`
