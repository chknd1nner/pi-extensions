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

- handle private messages, attachments, slash commands, and callback queries
- expose Telegram-native flows for `/new`, `/resume`, `/tree`, `/compact`, `/model`, `/agent`, and `/whoami`
- render lightweight activity updates such as `Thinking…` and `Reading files…`
- return the final assistant reply as the primary visible output

The Telegram adapter knows about Telegram identities and Telegram UI constraints, but it does not own session or security policy.

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

The runtime layer uses Pi session APIs and runtime replacement APIs so `/new`, `/resume`, and tree navigation behave like Pi semantics, not ad hoc chat resets.

### Layer 4: FamilyOS-owned Pi extension

Each active user runtime loads a FamilyOS-owned Pi extension that is responsible for:

- injecting the active agent's persona and `SOUL.md` before each turn
- injecting explicit handoff instructions when `/agent` continues in the same session
- overriding any tools exposed to the model so security policy is enforced in code, not only in prompts
- observing turn, tool, and compaction events so the Telegram adapter can render short activity summaries

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

If an unregistered user sends any message other than `/whoami`, FamilyOS does not create a home, session, or runtime.

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

### User home scaffolding

FamilyOS lazily creates these directories when a registered user first uses the system:

- `home/Inbox/`
- `home/Workspace/`
- `home/Exports/`
- `home/.familyos/`
- `home/.pi/`

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

### Agent replacement rules

Agent lookup order:

1. user-local `home/.familyos/agents/<agentId>/`
2. root `agents/<agentId>/`

User-local agent bundles replace same-named root agents completely.

### Capability profile

Each agent declares a capability profile. MVP-relevant fields are:

- which guarded tools are available, if any
- allowed read roots
- allowed write roots
- whether manual file tools are absent entirely

`bash` is not a valid capability in MVP.

## Session Model

### One active runtime per user

FamilyOS keeps one active Pi runtime/session context per registered user.

The runtime is created lazily and uses the user's `home/` as the Pi `cwd`.

Persistent user state in `state.json` includes at least:

- active session file path
- active agent ID

If a stored session path is missing or invalid, FamilyOS falls back to the most recent session for that user's `cwd`, and if none exists, creates a new session. If a stored agent ID is missing or invalid, FamilyOS falls back to the configured default agent.

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
- Telegram UIs are implemented with slash commands, inline buttons, and paginated selectors
- there is no expandable trace UI in MVP

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
2. FamilyOS reads the current session tree
3. Telegram shows a flattened, paginated selector of candidate branch points with timestamp and preview text
4. user selects a point
5. FamilyOS offers two actions:
   - `Restore full context`
   - `Branch with summary`
6. on restore, the active session moves to that branch point
7. on summary, FamilyOS performs the Pi-style summarized branch flow so the previous path is reduced to a summary handoff

The Telegram UI is not a literal tree drawing, but the semantics match Pi's branching model.

### `/compact`

Flow:

1. user runs `/compact`
2. bot offers:
   - `Compact now`
   - `Compact with custom instruction`
3. if the user chooses custom instruction, the bot asks for one free-form summarization instruction
4. FamilyOS triggers Pi compaction on the current session
5. bot confirms completion or reports failure

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
   - `Branch with summary, then hand off`
5. if continuing in the same session, the next turn gets an injected handoff instruction telling the new persona to take over naturally while treating prior assistant messages as conversation context rather than its own prior authored output
6. if starting fresh, FamilyOS creates a new session, switches the active agent, and continues normally
7. if branching with summary, FamilyOS performs the summarized branch flow first, then switches agent and injects the handoff instruction

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

Agents never receive raw Pi built-in tools directly.

If an agent has `read`, `write`, `edit`, `grep`, `find`, or `ls`, it receives a FamilyOS-owned overridden implementation with explicit policy checks.

This is the key security abstraction for long-term hardening.

### No `bash` in MVP

`bash` is completely omitted from MVP.

No shipped agent and no user-local custom agent can enable `bash` in MVP behavior. The FamilyOS capability resolver rejects it.

This keeps the initial attack surface focused on chat experience, agents, and Pi session-tree workflows rather than shell security.

### Control plane vs execution plane

FamilyOS separates:

1. control-plane state
2. agent-executable workspace state

Control-plane state includes:

- Telegram bot token
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

- tool override implementations
- path policy enforcement
- exclusion of `bash`
- keeping service secrets outside all agent-visible roots

## Attachment Handling

### Storage

All Telegram attachments are downloaded into the user's home, normally under `home/Inbox/`.

### Current-turn delivery

- images may be forwarded to Pi as image content for the current turn when appropriate
- all attachments remain available afterward as persisted files in the user's workspace

### Later access

If an agent has guarded file tools, it may access those persisted files only through the same path policy described above.

## Activity Rendering in Telegram

Telegram rendering stays intentionally simple in MVP.

Visible behavior:

- the assistant's natural-language reply is the main output
- short activity notes may appear while the turn runs, such as:
  - `Thinking…`
  - `Reading files…`
  - `Searching workspace…`
  - `Compacting session…`

Not included in MVP:

- expandable tool panels
- expandable thinking blocks
- raw tool output dumps by default
- Telegram Mini App trace views

This keeps the Telegram experience consumer-friendly while still making background work visible.

## Runtime Safety and Concurrency

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

If a reply is still running, FamilyOS tells the user to wait until the current turn completes.

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

The audit log is for operator observability and incident review, not user-facing rendering.

## Implementation Notes

### Pi SDK usage

FamilyOS uses the Pi SDK directly in-process.

Key Pi capabilities the design relies on:

- `createAgentSessionRuntime()` for active session replacement
- `SessionManager.list()` and related session APIs for `/resume`
- session tree and branching APIs for `/tree`
- built-in compaction support for auto and manual compaction
- extension hooks for system-prompt injection and tool overriding

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
- workspace root policy and protected-path checks
- flow token generation and expiry
- `/resume` item formatting
- `/tree` item formatting
- `/agent` handoff prompt construction
- `/model` choice handling

### Integration tests

Use temporary directories plus real Pi SDK APIs where practical.

Scenarios:

- registered user gets a lazily scaffolded home
- unregistered user gets no home and no session
- two users do not see each other's sessions
- each user's `cwd` is their own home
- guarded file tools can access `Inbox`, `Workspace`, and `Exports`
- guarded file tools cannot access `.pi`, `.familyos`, sibling homes, or root config
- `/new`, `/resume`, `/tree`, `/compact`, `/model`, and `/agent` flows work end to end
- no runtime path exposes `bash`

### Manual acceptance tests

Before implementation is considered ready:

- one registered user can chat with the default assistant normally
- one unregistered user only gets onboarding plus `/whoami`
- `/whoami` returns Telegram ID and mapped FamilyOS user when registered
- attachments persist into the correct user home
- `/new`, `/resume`, `/tree`, `/compact`, `/model`, and `/agent` feel natural in Telegram
- session-tree behavior remains faithful to Pi semantics
- no agent can execute `bash`

## Out of Scope but Enabled by This Design

This architecture intentionally leaves room for future work without redesigning the core model:

- additional channel adapters such as WhatsApp or iMessage
- user-specific custom agents in `home/.familyos/agents/`
- user-local config composition in `.pi/` and `.familyos/`
- stronger sandbox backends later if non-bash execution capabilities are added
- richer trace inspection through a Telegram Mini App
- memory systems that preserve the illusion of continuity across compacted sessions
