# FamilyOS Telegram Design Spec

Channel-agnostic FamilyOS core with a Telegram MVP adapter that wraps the Pi SDK for a home server. The system gives family members a consumer-style chat experience by default, while still exposing Pi-style context management for power users: new session, resume, session tree branching, compaction, model switching, and agent handoff.

## Goals

- Ship a Telegram-first MVP that feels like chatting with a helpful digital assistant, not a developer tool.
- Keep the architecture channel-agnostic so Telegram is only the first adapter.
- Use the Pi SDK directly in-process rather than shelling out to the CLI or RPC mode.
- Preserve Pi's session tree semantics as a first-class power-user feature.
- Isolate each family member's sessions and workspace while sharing Pi auth, models, and most global settings.
- Make security foundational: no raw built-in tools exposed to agents, default-deny capability model, and no `bash` in MVP.
- Support filesystem-defined custom agents with `SOUL.md` and per-agent capability configuration.

## Non-Goals for MVP

- Multiple Telegram bots, one per agent.
- Telegram Mini App / Web App UI.
- Expandable tool traces or expandable thinking panels in Telegram.
- Automatic memory, background housekeeping, or agent-specific persistent memory injection.
- In-chat admin onboarding flows.
- Any `bash` capability.

## Product Model

### One bot, one default persona, power-user agent switching

FamilyOS runs as a single Telegram bot.

For ordinary users, the bot presents a default FamilyOS assistant persona, analogous to a digital assistant like Jarvis. Power users can explicitly switch persona with `/agent`, but the normal chat experience does not require agent awareness.

### One active session per user

Each registered user has exactly:

- one active Pi session
- one active agent persona

Normal chat messages always go to the current active Pi session with the current active agent persona.

Sessions are user-scoped, not agent-scoped. Switching agent does not silently reconnect to an older agent-specific session. A power user chooses whether to continue the current session, start fresh, or branch and summarize before handing off.

### Telegram history is not Pi session history

Starting a new Pi session does not erase Telegram chat history. Telegram remains an append-only chat transcript unless messages are explicitly deleted by the application, which the MVP does not do.

## Architecture

### Layer 1: Telegram adapter

A `grammY` bot receives Telegram updates and translates them into FamilyOS operations.

Responsibilities:

- handle private 1:1 messages, slash commands, callback queries, and supported attachments
- ignore non-private chats entirely in MVP: groups, supergroups, and channels are silently ignored
- allow `/whoami` for everyone, but route all other work only after registration succeeds
- expose Telegram-native flows for `/new`, `/resume`, `/tree`, `/compact`, `/model`, `/agent`, `/cancel`, and `/whoami`
- drive normal-turn activity via Telegram's typing indicator and return the final assistant reply as the primary visible output

The Telegram adapter knows about Telegram identities and Telegram UI constraints, but it does not own session, tool policy, or security enforcement.

### Layer 2: FamilyOS core

The FamilyOS core is channel-agnostic. It owns the application model and exposes operations such as:

- resolve user
- ensure user home
- send chat message
- save attachment
- start new session
- resume session
- navigate session tree
- compact session
- switch model
- switch agent
- cancel the current turn

This layer is designed so a future WhatsApp or iMessage adapter can reuse it without changing the Pi integration or filesystem layout.

### Layer 3: Pi integration layer

FamilyOS uses the Pi SDK in-process.

Shared across all users:

- shared Pi `agentDir`
- shared `AuthStorage`
- shared `ModelRegistry`
- shared global Pi settings

Isolated per FamilyOS user:

- active runtime/session pointer
- active agent persona
- user home directory used as Pi `cwd`
- user-local Pi settings merged from `<home>/.pi/settings.json`

The runtime layer uses Pi session APIs and runtime replacement APIs so `/new`, `/resume`, `/tree`, and `/cancel` behave like Pi semantics, not ad hoc chat resets.

At runtime creation, FamilyOS uses the SDK equivalent of `--no-builtin-tools` and selectively registers only the guarded tools permitted by the active agent's capability profile. This is stronger than loading every built-in and denying at execute-time because the model only sees tools that are actually available. In MVP, `bash` is never loaded into any runtime.

Runtime lifecycle is explicit in MVP:

- runtimes are created lazily on the first successful message from a registered user
- runtimes live for the lifetime of the bot process
- there is no idle eviction in MVP
- agent changes that alter the system prompt or available tools rebuild the runtime/session as needed rather than hot-patching a live runtime
- changes to shared settings or root config require a bot restart in MVP

### Layer 4: FamilyOS-owned Pi extension

Each active user runtime loads a FamilyOS-owned Pi extension that is responsible for:

- installing the active agent's `SOUL.md` as the runtime's system-prompt override, not as a user message
- composing the stable cacheable system-prompt prefix from:
  - the active agent's `SOUL.md`
  - the re-authored `promptGuidelines` for every guarded tool the active agent has been granted
- registering same-name guarded overrides for any built-in tools the active agent receives
- explicitly re-authoring `promptSnippet` and `promptGuidelines` on every guarded tool override, because Pi does not inherit those fields from the built-in tool definition
- appending a one-shot handoff block via `before_provider_request` after the cached system-prompt/tool prefix when `/agent` continues in the same session
- observing turn, tool, and compaction events so the Telegram adapter can render typing indicators and command-specific status updates

The extension exists so prompt composition, tool control, and session-aware behavior stay attached to Pi's lifecycle hooks.

## Identity and Onboarding

### Canonical FamilyOS user identity

Telegram IDs are not used as filesystem identity.

Each person has a canonical FamilyOS user slug such as:

- `martin`
- `alice`
- `mum`

This slug is the durable identity across all channels and becomes the user's root folder name.

### User manifest

Each user has a manifest at `users/<slug>/user.json`.

Example:

```json
{
  "id": "martin",
  "displayName": "Martin",
  "channels": {
    "telegram": {
      "userIds": ["123456789"]
    }
  }
}
```

A single FamilyOS user may later link multiple channel identities without renaming the home directory.

### Registration model

Registration is manual and admin-managed in MVP.

In MVP, "admin" means the host operator with shell access to the FamilyOS server filesystem. There are no admin-only Telegram commands; user creation and channel linking happen entirely out of band.

Workflow:

1. the admin creates `users/<slug>/user.json`
2. the admin links the user's Telegram ID in that manifest
3. FamilyOS lazily scaffolds the rest of the home structure on first successful use

The Pi SDK does not own FamilyOS onboarding. Pi helps once a valid `cwd` exists, but user registration, identity linking, and user-home scaffolding belong to FamilyOS.

### `/whoami`

`/whoami` is always allowed, even for unregistered users.

Behavior:

- always return the caller's Telegram numeric ID
- if the user is registered, also return the mapped FamilyOS user slug

Example outputs:

- `Telegram ID: 123456789`
- `Telegram ID: 123456789\nFamilyOS user: martin`

### Unregistered user behavior

If an unregistered user sends any message other than `/whoami`, FamilyOS performs no runtime work beyond generating the stock onboarding reply.

In particular, for unregistered users FamilyOS does not:

- download attachments
- scaffold a home directory
- create a Pi runtime
- open or create a Pi session file

Instead it replies with a stock onboarding message:

> You're not registered with FamilyOS yet. Use `/whoami` to get your Telegram ID, then send it to the admin.

## Filesystem Layout

```text
familyos/
  agents/
    default/
      SOUL.md
      agent.json
    sam/
      SOUL.md
      agent.json

  config/
    familyos.json

  logs/
    audit.jsonl

  users/
    martin/
      user.json
      state.json
      home/
        Inbox/
        Workspace/
        Exports/
        .familyos/
          settings.json
          agents/
        .pi/
          settings.json
```

### Meaning of the directories

- `agents/` holds root-level shared agents.
- `config/familyos.json` holds root FamilyOS configuration such as default agent, Telegram bot-level settings, and root defaults for mergeable FamilyOS config.
- `logs/audit.jsonl` stores structured audit events.
- `users/<slug>/user.json` links external channel identities to the canonical FamilyOS user.
- `users/<slug>/state.json` stores persistent FamilyOS user state such as active session path and active agent.
- `users/<slug>/home/` is the Pi `cwd` for that user.

Pi session JSONL files do not live under the FamilyOS tree. Pi stores them under the shared `agentDir` session store, organized by encoded `cwd`. Because each FamilyOS user has a distinct `users/<slug>/home/` `cwd`, Pi's session listing still scopes naturally per user.

### User home scaffolding

FamilyOS lazily creates these directories when a registered user first uses the system:

- `home/Inbox/`
- `home/Workspace/`
- `home/Exports/`
- `home/.familyos/`
- `home/.pi/`

FamilyOS also scaffolds these files with empty JSON objects so merge semantics work immediately and users have something concrete to edit:

- `home/.familyos/settings.json` containing `{}`
- `home/.pi/settings.json` containing `{}`

The admin does not need to create every subdirectory by hand.

### Attachments

Telegram attachments are persisted into the user's home, normally under `home/Inbox/`.

This makes uploaded material durable across turns and future sessions. The attachment path becomes part of the user's workspace state rather than a transient bot-level cache.

## Config Layering Rules

FamilyOS uses two composition rules.

### Mergeable config

Mergeable config is recursively composed, with user-local values winning on conflict.

This applies to:

- shared Pi settings plus `home/.pi/settings.json`
- shared FamilyOS config plus `home/.familyos/settings.json`
- other structured settings that are naturally composable

The intent is Pi-like semantics: a user may set one key locally without replacing an entire root config file.

### Replaceable bundles

Self-contained resources are replaced by name, not field-merged.

This applies to:

- full agent bundles in `agents/<agentId>/`
- user-local agents in `home/.familyos/agents/<agentId>/`
- `SOUL.md` and other whole prompt bundles

If a user defines `home/.familyos/agents/sam/`, that replaces the root `agents/sam/` bundle as the effective `sam` agent.

## Agent Model

### Filesystem-defined agents

Each agent is defined by a directory such as:

```text
agents/default/
  SOUL.md
  agent.json
```

`SOUL.md` contains the persona/system prompt content.

`agent.json` contains machine-readable metadata, including capability policy.

### Default agent

One root agent is marked as the default FamilyOS assistant. This is the persona ordinary users talk to unless they explicitly switch with `/agent`.

MVP ships a stock `agents/default/SOUL.md` and `agents/default/agent.json`. FamilyOS fails to start if the configured default agent bundle is missing.

### System prompt composition

An agent's `SOUL.md` becomes the runtime's system-prompt override rather than a synthetic user message.

The stable system-prompt prefix for a given active agent is composed of:

1. the active agent's `SOUL.md`
2. the re-authored `promptGuidelines` for every guarded tool granted to that agent

Both parts are stable across turns within the same agent and therefore form the cacheable prompt prefix.

### Agent replacement rules

Agent lookup order:

1. user-local `home/.familyos/agents/<agentId>/`
2. root `agents/<agentId>/`

User-local agent bundles replace same-named root agents completely.

### Capability profile

Each agent declares a capability profile in `agent.json`.

Concrete MVP example:

```json
{
  "id": "default",
  "displayName": "FamilyOS Assistant",
  "capabilities": {
    "tools": ["read", "grep", "find", "ls"],
    "readRoots": ["Inbox", "Workspace", "Exports"],
    "writeRoots": ["Workspace", "Exports"]
  }
}
```

Rules:

- `tools` is a closed enum drawn from the FamilyOS-supported tool names for MVP
- unknown tool names cause a load-time error
- `bash` in `tools` causes a load-time error in MVP
- an empty `tools` array means a chat-only agent with no file access
- `readRoots` and `writeRoots` are paths relative to the user's `home/`

## Session Model

### One active runtime per user

FamilyOS keeps one active Pi runtime/session context per registered user.

The runtime is created lazily and uses the user's `home/` as the Pi `cwd`.

Persistent user state in `state.json` includes at least:

- active session file path
- active agent ID

If a stored session path is missing or invalid, FamilyOS falls back to the most recent session for that user's `cwd`, and if none exists, creates a new session. If a stored agent ID is missing or invalid, FamilyOS falls back to the configured default agent.

`state.json` is written atomically: FamilyOS writes `state.json.tmp` and then renames it over the target path.

### Runtime lifecycle

Runtime lifecycle is explicit in MVP:

- creation is lazy on the first successful chat from a registered user
- active runtimes live for the lifetime of the bot process
- there is no idle eviction in MVP
- continuing with a different agent rebuilds the runtime/session as needed rather than hot-patching a live runtime
- changes to shared settings or root config require a bot restart in MVP

### Why `cwd = user home`

Using the user's home as the Pi `cwd` gives three benefits:

- Pi sessions are naturally scoped to that user when listed by `cwd`
- user-local Pi settings from `home/.pi/settings.json` merge naturally
- file tools can operate relative to a user-owned workspace

### Session isolation

Sessions are isolated by FamilyOS user. One user's sessions do not appear in another user's `/resume` or `/tree` flows.

### Auto compaction

Pi auto compaction remains enabled by default.

FamilyOS also exposes a manual `/compact` flow for power users who want explicit control over summarization boundaries.

## Telegram Command UX

### General rules

- normal chat messages go to the active session and active agent
- state-changing power-user commands operate only when the user's current turn is idle
- `/cancel` is the explicit exception: it is allowed while a turn is running and aborts the active Pi session turn
- Telegram UIs are implemented with slash commands, inline buttons, paginated selectors, and `<pre>`/`<code>` blocks using HTML parse mode
- there is no expandable trace UI in MVP
- FamilyOS does not expose per-session `thinkingLevel` controls in MVP; each session uses the restored or default model thinking level, and changing it explicitly is out of scope

### Reply formatting

Telegram replies use HTML parse mode.

If a reply exceeds Telegram's 4096-character limit, FamilyOS splits it at safe paragraph or line boundaries. It never splits in the middle of a code block, and it preserves code blocks across split messages.

### `/new`

Flow:

1. user runs `/new`
2. bot asks for confirmation
3. on confirm, FamilyOS creates a fresh Pi session for that user
4. the active agent remains unchanged
5. bot replies `Started a new session.`

This changes backend Pi context only. It does not delete earlier Telegram chat messages.

### `/resume`

Flow:

1. user runs `/resume`
2. FamilyOS lists sessions for that user's Pi `cwd`
3. Telegram shows a paginated session picker
4. each item shows compact metadata such as session name or first-message preview plus modified time
5. user selects one session
6. FamilyOS switches the active runtime to that session
7. bot confirms the resumed session

### `/tree`

Flow:

1. user runs `/tree`
2. FamilyOS reads the current session tree and renders the visible page as an ASCII tree inside a monospace code block
3. each visible entry is prefixed with a per-page index such as `[1]`, `[2]`, `[3]`
4. the inline keyboard includes:
   - numbered buttons matching the visible indices
   - a filter row: `All`, `No-tools`, `User-only`, `Labeled`
   - navigation buttons: `Prev`, `Next`, `Cancel`
5. the default Telegram tree filter is `user-only`
6. the mapping from numeric button to Pi entry ID is stored server-side under the flow token, not encoded into `callback_data`
7. after the user selects an entry, FamilyOS replaces the keyboard with:
   - `Restore full context`
   - `Branch with summary`
   - `Cancel`
8. on restore, the active session moves to that branch point
9. on summary, FamilyOS performs the Pi-style summarized branch flow so the previous path is reduced to a summary handoff

The Telegram UI is not a literal TUI clone, but it preserves the structural distinction that makes Pi's `/tree` different from `/resume`.

### `/compact`

Flow:

1. user runs `/compact`
2. bot offers:
   - `Compact now`
   - `Compact with custom instruction`
3. if the user chooses custom instruction, the bot asks for one free-form summarization instruction
4. FamilyOS triggers Pi compaction on the current session
5. the bot shows a single status message, `Compacting session…`, which is edited to a success or failure result when compaction finishes

### `/cancel`

Flow:

1. user runs `/cancel`
2. if a turn is currently running, FamilyOS calls `session.abort()` for that user's active runtime and stops the typing-indicator loop
3. bot replies `Cancelled current turn.`
4. if no turn is active, bot replies `Nothing is running right now.`

### `/model`

Flow:

1. user runs `/model`
2. FamilyOS lists only currently available/authenticated Pi models
3. user chooses a model
4. bot always warns:
   - `Switching models resets cache and can increase cost/usage.`
5. bot offers four choices:
   - `Switch anyway`
   - `Branch + compact, then switch`
   - `New session`
   - `Cancel`
6. FamilyOS performs the chosen action atomically:
   - `Switch anyway` changes the current session's model
   - `Branch + compact, then switch` summarizes the current session before switching model
   - `New session` creates a fresh session, then applies the selected model there

The warning is fixed and unconditional. FamilyOS does not attempt to calculate whether the new model is only potentially expensive; model switching is always treated as a consequential operation.

### `/agent`

Flow:

1. user runs `/agent`
2. bot lists available agents
3. user chooses an agent
4. bot offers:
   - `Continue current session`
   - `Start fresh session`
   - `Branch with summary, then switch agent`
5. if continuing in the same session, the next outgoing model request gets a one-shot handoff instruction appended after the cached persona/tool prefix
6. if starting fresh, FamilyOS creates a new session, switches the active agent, and continues normally; no handoff block is needed
7. if branching with summary, FamilyOS performs the summarized branch flow first, then switches agent; no handoff block is needed after the new branch state is established

The default user does not need this command. It exists for power users who want to steer persona explicitly.

### `/whoami`

Already described above. It is always allowed and doubles as the MVP onboarding helper.

## Prompt Injection and Security Model

### Threat model

MVP targets defense against malicious prompt injection and hostile content on a single host.

FamilyOS assumes an agent may be induced to attempt actions such as:

- reading secrets outside the intended workspace
- following instructions from hostile uploaded content
- modifying files outside its allowed roots
- using any exposed tool to exfiltrate or corrupt data

### Hard boundary: no raw built-in tools

FamilyOS uses Pi's native same-name tool override mechanism for built-ins, but it adopts a selective-load strategy rather than loading every built-in and denying later.

In practice:

- runtimes start from the SDK equivalent of `--no-builtin-tools`
- FamilyOS registers only the guarded tools the active agent's capability profile permits
- if a built-in name such as `read` or `edit` is exposed, it is the FamilyOS override, not the stock Pi tool

This keeps the model's tool list honest and gives the MVP's no-`bash` stance a stronger guarantee: `bash` is not merely denied, it is absent.

### Guarded tool prompt metadata

Pi does not inherit `promptSnippet` or `promptGuidelines` when a built-in tool is overridden.

Therefore every guarded tool override must explicitly define its own:

- `promptSnippet`
- `promptGuidelines`

This is required so the model receives correct usage instructions for the guarded tools it can call.

### No `bash` in MVP

`bash` is completely omitted from MVP.

No shipped agent and no user-local custom agent can enable `bash` in MVP behavior. The capability resolver rejects `bash` at agent-load time, and the runtime never loads a `bash` tool.

This keeps the initial attack surface focused on chat experience, agents, and Pi session-tree workflows rather than shell security.

### Control plane vs execution plane

FamilyOS separates:

1. control-plane state
2. agent-executable workspace state

Control-plane state includes:

- the Telegram bot token
- Pi auth and model registry data
- root FamilyOS config
- user manifests and FamilyOS state files
- user-local `.pi/` and `.familyos/` config

Agent-executable state includes only explicitly allowed workspace roots.

### Tool-visible roots

Even though `cwd = home/`, guarded tools do not expose the entire home by default.

Allowed workspace roots in MVP:

- `home/Inbox/`
- `home/Workspace/`
- `home/Exports/`

Denied by default:

- `home/.pi/`
- `home/.familyos/`
- sibling user directories
- shared root config and log directories
- any Pi auth/config outside allowed roots

### Guarded file tools

Every exposed file-oriented tool is overridden and policy-aware.

Responsibilities of the wrappers:

- resolve canonical real paths
- prevent `..` traversal escapes
- prevent symlink escapes outside allowed roots
- enforce separate allowed read roots and allowed write roots
- deny protected locations consistently across `read`, `write`, `edit`, `grep`, `find`, and `ls`

Security policy is therefore enforced in code rather than only implied by `cwd`.

### Prompts are not the security boundary

Prompt instructions such as `do not read secrets` are helpful but non-binding.

The real boundary is:

- selective guarded-tool loading
- tool override implementations
- path policy enforcement
- exclusion of `bash`
- keeping service secrets outside all agent-visible roots

## Attachment Handling

### Storage

All supported Telegram attachments are downloaded into the user's home, normally under `home/Inbox/`.

### Current-turn delivery

Attachment behavior is fixed in MVP:

- text messages: always forwarded to Pi as normal prompt text
- images: forwarded inline to Pi as image content for the current turn and also persisted to `home/Inbox/`
- generic documents such as `pdf`, `txt`, and `md`: persisted to `home/Inbox/`, but not forwarded inline; the agent reads them later through guarded file tools if its capability profile allows
- voice notes, video, stickers, and animations: acknowledged politely as unsupported in MVP and ignored after that response

### Later access

If an agent has guarded file tools, it may access persisted attachments only through the same path policy described above.

## Activity Rendering in Telegram

Telegram rendering stays intentionally simple in MVP.

Normal turns use Telegram's native typing indicator rather than explicit activity text such as `Thinking…` or `Reading files…`.

Implementation rules:

- FamilyOS sends `sendChatAction("typing")` when a turn starts
- because Telegram clears the typing indicator after a few seconds, FamilyOS re-sends it on a timer, roughly every 4 seconds, until the turn ends
- the typing loop is driven from Pi turn/agent lifecycle events and is cleared on `agent_end` or `session.abort()`

One carve-out exists for `/compact`: in addition to the typing indicator, FamilyOS shows a single status message, `Compacting session…`, then edits that message to `Compacted.` or to a failure string.

Not included in MVP:

- expandable tool panels
- expandable thinking blocks
- raw tool output dumps by default
- Telegram Mini App trace views

This keeps the Telegram experience consumer-friendly while still making background work visible.

## Runtime Safety and Concurrency

### Single-process assumption

FamilyOS assumes a single bot process in MVP.

Per-user runtime caches, serialized queues, `state.json`, and the shared audit log all rely on that assumption. Multi-process coordination, locking, and fencing are out of scope for MVP.

### Per-user serialized operation queue

Each FamilyOS user has a serialized operation queue.

This prevents races between:

- a normal chat message
- a callback-driven `/model` or `/agent` flow
- runtime replacement operations such as `/new` or `/resume`

Different users may still operate concurrently.

### Idle-only state changes

These commands require the current user turn to be idle:

- `/new`
- `/resume`
- `/tree`
- `/compact`
- `/model`
- `/agent`

If a reply is still running, FamilyOS tells the user to wait until the current turn completes. `/cancel` remains available while a turn is active.

### Atomic state replacement

If a state-changing operation fails midway, FamilyOS retains the previous active state.

New session, resumed session, model switch, and agent switch only become active after the underlying Pi operation succeeds.

## Error Handling

### Stale menus

Interactive Telegram flows use short-lived flow tokens.

If a user clicks an expired button, FamilyOS responds:

> That menu has expired. Please run the command again.

Expired menus never mutate session, model, or agent state.

### Missing resources

If a referenced session, agent, or model no longer exists, FamilyOS:

- informs the user with a short clear message
- leaves the prior active state unchanged

### Attachment failures

If an attachment cannot be downloaded or persisted, only that message fails. FamilyOS does not corrupt the user's runtime or session state.

### Compaction failures

If manual compaction fails, FamilyOS reports the failure and keeps the current session unchanged.

### Tool denials

Denied file operations are surfaced as safe tool failures inside Pi context and are also written to audit logs. Telegram remains simple and does not dump raw denial traces unless the assistant chooses to explain the limitation in natural language.

## Observability and Audit

FamilyOS writes a structured JSONL audit log at `logs/audit.jsonl`.

Events worth recording in MVP:

- channel identity resolution
- unregistered access attempts
- session creation, resume, and tree navigation
- model switches
- agent switches
- manual compaction requests
- high-level tool calls
- denied tool/path operations
- security policy violations

Audit log behavior is explicit in MVP:

- one writer per bot process
- line-buffered append to `logs/audit.jsonl` opened in append mode
- no log rotation in MVP; operators rotate it manually if needed

The audit log is for operator observability and incident review, not user-facing rendering.

## Implementation Notes

### Pi SDK usage

FamilyOS uses the Pi SDK directly in-process.

Key Pi capabilities the design relies on:

- `createAgentSessionRuntime()` for active session replacement
- `SessionManager.list()` and related session APIs for `/resume`
- session tree and branching APIs for `/tree`
- built-in compaction support for auto and manual compaction
- `DefaultResourceLoader.systemPromptOverride()` or equivalent system-prompt composition for `SOUL.md`
- extension hooks such as `before_provider_request` for one-shot handoff injection and same-name tool overriding for guarded built-ins

### Bootstrap requirements

FamilyOS reads the Telegram bot token from the `TELEGRAM_BOT_TOKEN` environment variable.

If `TELEGRAM_BOT_TOKEN` is missing, FamilyOS fails to start with a clear startup error.

### Handoff prompt implementation

For `/agent` → `Continue current session`, FamilyOS appends a one-shot handoff block after the cached persona/tool prefix rather than prepending it to the main system prompt.

Placement and lifecycle are fixed:

- the handoff is added in `before_provider_request`
- it is appended after the stable cached prefix formed by `SOUL.md` and the active guarded tool guidelines
- it fires once, on the next outgoing request only
- after that request is built and sent, the handoff flag is cleared
- `/agent` → `Start fresh session` and `/agent` → `Branch with summary, then switch agent` do not use the handoff block because those flows establish a fresh persona boundary another way

The implementation may store this text in code or in `agents/_system/handoff.md`, but the content is fixed:

```text
You are taking over an in-progress conversation from a different assistant
persona. The messages above this point in the conversation were authored by
that previous assistant, not by you.

Treat the prior turns as transcript context: read them to understand what the
user has been working on and what they want next. Do not adopt the previous
assistant's voice, commitments, stylistic choices, or stated intentions as
your own — those belong to a different persona with a different role.

Continue the conversation as yourself, in your own voice and within your own
capabilities, from this turn forward. If the previous assistant made promises
or decisions that conflict with your role, raise that openly with the user
rather than silently continuing along the prior path.
```

### Why not Pi RPC for MVP

Pi RPC is viable, but the direct SDK approach is a better fit for a long-lived multi-user FamilyOS server because it gives tighter access to session lifecycle, extension hooks, and active runtime control without the overhead of managing Pi subprocesses per user.

## Testing Strategy

### Unit tests

Test pure logic for:

- Telegram ID to FamilyOS user resolution
- `/whoami` output for registered and unregistered users
- onboarding stock message behavior
- merge semantics for mergeable config
- replacement-by-name semantics for agent bundles
- `agent.json` loading, including rejection of unknown tools and rejection of `bash`
- workspace root policy and protected-path checks
- flow token generation, paging state, and expiry
- `/resume` item formatting
- `/tree` ASCII-tree rendering, filter selection, and numeric-button mapping
- reply splitting for HTML-formatted messages longer than 4096 characters
- `/agent` handoff prompt construction and one-shot lifecycle state
- `/model` choice handling
- typing-indicator timer start/stop behavior

### Integration tests

Use temporary directories plus real Pi SDK APIs where practical.

Scenarios:

- startup fails clearly if `TELEGRAM_BOT_TOKEN` is missing
- the shipped default agent bundle is required and loaded at startup
- registered user gets a lazily scaffolded home with `{}` written to both settings files
- unregistered user gets no home and no session
- unregistered attachments are not downloaded
- non-private Telegram chats are ignored
- two users do not see each other's sessions
- each user's `cwd` is their own home
- Pi session files are created under the shared `agentDir` session store, scoped by user `cwd`
- guarded file tools can access `Inbox`, `Workspace`, and `Exports`
- guarded file tools cannot access `.pi`, `.familyos`, sibling homes, or root config
- guarded tool overrides expose re-authored prompt metadata and no runtime path exposes `bash`
- `/new`, `/resume`, `/tree`, `/compact`, `/cancel`, `/model`, and `/agent` flows work end to end
- the `/agent` continue-current-session path injects the one-shot handoff block only on the next request

### Manual acceptance tests

Before implementation is considered ready:

- one registered user can chat with the default assistant normally
- one unregistered user only gets onboarding plus `/whoami`
- `/whoami` returns Telegram ID and mapped FamilyOS user when registered
- attachments persist into the correct user home
- generic documents are saved but not forwarded inline
- unsupported media types are acknowledged politely without crashing
- long replies split cleanly in Telegram without breaking code blocks
- `/new`, `/resume`, `/tree`, `/compact`, `/cancel`, `/model`, and `/agent` feel natural in Telegram
- session-tree behavior remains faithful to Pi semantics
- typing indicators clear promptly when a turn ends or is cancelled
- no agent can execute `bash`
- groups and other non-private chats are ignored

## Out of Scope but Enabled by This Design

This architecture intentionally leaves room for future work without redesigning the core model:

- additional channel adapters such as WhatsApp or iMessage
- user-specific custom agents in `home/.familyos/agents/`
- user-local config composition in `.pi/` and `.familyos/`
- stronger sandbox backends later if non-bash execution capabilities are added
- richer trace inspection through a Telegram Mini App
- memory systems that preserve the illusion of continuity across compacted sessions
