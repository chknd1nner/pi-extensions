# FamilyOS Telegram Design Review

Review of `2026-04-30-familyos-telegram-design.md`. Cross-checked against Pi's installed docs (`docs/pi/docs/sdk.md`, `docs/pi/docs/extensions.md`, `docs/pi/docs/sessions.md`, `docs/pi/docs/compaction.md`).

Overall the design is in good shape: the channel-agnostic core, the user-scoped session model, the security posture (no `bash`, no raw built-ins, default-deny capability profiles, control-plane vs. execution-plane separation), and the per-user serialized operation queue are all the right calls. The items below are decisions worth nailing down before the implementation plan is written, plus a few small corrections.

Citation paths are relative to the project root. The Pi docs path is a symlink to the installed `@mariozechner/pi-coding-agent` package.

## Pi SDK alignment

### 1. Tool override mechanism — clarify the loading model

The spec's "FamilyOS-owned overridden implementation" wording is correct: Pi explicitly supports overriding built-ins by registering a same-named tool from an extension.

> Extensions can override built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) by registering a tool with the same name. — `docs/pi/docs/extensions.md:1790`

There's a worked example at `examples/extensions/tool-override.ts`, and renderer inheritance is resolved per slot so wrappers don't have to reimplement the UI.

What the spec still needs to commit to is *which loading style* FamilyOS uses, because two approaches are possible:

- **Selective load + opt out of unwanted built-ins.** Use the SDK equivalent of `--no-builtin-tools` and register only the guarded tools the active agent's capability profile permits.
- **Override everything + gate at execute-time.** Always register guarded versions of all built-ins, including a deny-all `bash`, and let each tool's `execute()` consult the active agent's capability profile.

Recommend the **selective load** style. It's a stronger guarantee for the spec's "no `bash` in MVP" stance — bash literally isn't loaded into the runtime — and it keeps the model's tool list honest about what's actually available to that agent.

Citation: `docs/pi/docs/extensions.md:1790`–`1807`, `docs/pi/docs/extensions.md:1797` (`--no-builtin-tools`).

### 2. Tool prompt metadata is not inherited on override

Pi explicitly states overrides do not inherit `promptSnippet` or `promptGuidelines` from the built-in:

> **Prompt metadata:** `promptSnippet` and `promptGuidelines` are not inherited from the built-in tool. If your override should keep those prompt instructions, define them on the override explicitly. — `docs/pi/docs/extensions.md:1807`

Add a section to the spec stating that each guarded tool override **must re-author** its `promptSnippet` and `promptGuidelines`, otherwise the model receives no usage instructions for those tools and behaves erratically. This is per-tool work; it should be called out so the planner sizes it correctly.

### 3. Persona is a system-prompt override, not a per-turn user message

Confirmed direction: SOUL.md content becomes the agent's system prompt via `ResourceLoader.systemPromptOverride()` (or equivalent), **not** an injected user message.

The spec should also state that the system prompt is composed of:

1. SOUL.md content (persona)
2. The re-authored `promptGuidelines` for every guarded tool the agent has been granted

Both pieces are stable across turns within a single agent, so they form a cacheable prefix.

### 4. Per-user runtime lifecycle is undefined

The spec says runtimes are "lazily created" but doesn't say when they go away or how settings/agent changes are applied. Decide:

- creation: lazy on first chat from a registered user (already implied)
- lifetime: lifetime of the bot process; no idle eviction in MVP
- agent switch in the same session: rebuild via Pi's session-replacement APIs as needed; don't try to hot-patch
- settings change: requires bot restart in MVP

State this explicitly so the planner doesn't invent eviction logic.

### 5. Pi session storage lives under `agentDir`, not the FamilyOS tree

Pi writes session JSONL files under `~/.pi/agent/sessions/<encoded-cwd>/` (`docs/pi/docs/sessions.md`). Because each FamilyOS user has `cwd = users/<slug>/home/`, sessions are naturally scoped per user — but they live under the shared `agentDir`, not under `users/<slug>/`. Add one sentence to the Filesystem Layout section so the planner doesn't try to relocate them.

## Telegram UX decisions

### 6. `/tree` — render an ASCII tree, don't flatten

The spec leaves `/tree` flattening hand-wavy. Telegram supports monospace via code blocks and Pi already has tree-rendering logic — flattening throws away the structure that makes `/tree` distinct from `/resume`.

Recommended UX:

- Render an ASCII tree in the message body inside a monospace code block. Each selectable entry is prefixed with a per-page index `[1]`, `[2]`, etc.
- Inline keyboard rows below: numbered buttons matching the indices, a filter row mirroring Pi's filter modes (`All / No-tools / User-only / Labeled`), and `Prev / Next / Cancel`.
- The number-to-entry-id mapping is held server-side under the flow token — not stuffed into `callback_data`. This keeps callback payloads short and immune to entry-id shape changes.
- After the user selects an entry, replace the keyboard with `Restore full context / Branch with summary / Cancel`, mirroring the Pi semantics already in the spec.

Pi's filter modes for reference: `default, no-tools, user-only, labeled-only, all` (`docs/pi/docs/sessions.md`, "Tree Controls"). Defaulting the Telegram view to `user-only` is reasonable since most `/tree` usage is "go back to that earlier prompt".

### 7. Activity rendering — typing indicator with one carve-out

Replace the `Thinking…` / `Reading files…` / `Searching workspace…` / `Compacting session…` text notes with Telegram's native typing indicator (`sendChatAction("typing")`).

Two implementation notes the spec should capture:

- **Typing auto-clears after ~5 seconds.** For long turns the bot must re-send `sendChatAction("typing")` on a timer (every ~4s) until the turn ends. Drive this off Pi's event stream: start the timer at `agent_start` / `turn_start`, clear it at `agent_end`.
- **Typing collapses all activity states into one signal.** That's fine for normal chat, but `/compact` is user-initiated and can be slow. Carve out one exception: `/compact` shows a single status message ("Compacting session…") which is edited to "Compacted." on success or to an error string on failure, in addition to the typing indicator.

Drop the other named activity strings.

### 8. Reply length and parse mode

Telegram caps messages at 4096 characters. The spec doesn't address splitting or formatting. Add a paragraph committing to:

- Replies longer than 4096 chars are split at safe boundaries (paragraph or line breaks; never mid-code-block).
- Parse mode: pick one (`MarkdownV2` or `HTML`). Recommend `HTML` — it's less footgun-prone than `MarkdownV2`'s escape rules.
- Code blocks in replies are preserved across splits.

### 9. Attachment scope for MVP

"Images may be forwarded … when appropriate" is too fuzzy for the planner. Commit to:

- text messages: always
- images: forwarded inline as Pi `ImageContent` for the current turn, also persisted to `home/Inbox/`
- generic documents (pdf, txt, md, etc.): persisted to `home/Inbox/`, not forwarded to Pi inline; agent reads via guarded `read` if its capability profile allows
- voice notes, video, stickers, animations: deferred (acknowledge politely, don't crash)

### 10. Cancellation

The Pi SDK exposes `session.abort()`. The spec doesn't define a way for users to stop a long-running turn. Recommend adding `/cancel` for MVP — it's one slash command and one event hook, and without it users will be stuck staring at typing dots. If deferring, say so explicitly.

### 11. Group chats

The spec says "handle private messages". Add an explicit "non-private chats (groups, channels, supergroups) are silently ignored in MVP". This forestalls the planner inventing group-aware behavior.

## Security and identity

### 12. Unregistered users — no work performed

Make explicit: for unregistered Telegram IDs, FamilyOS performs **no** runtime work beyond the `/whoami` and onboarding-message responses. In particular:

- attachments are not downloaded
- no user home is scaffolded
- no Pi runtime is created
- no session file is opened

Currently this is implied but not stated, and "don't download a 50MB upload before refusing" is the kind of thing planners need spelled out.

### 13. Admin authority is out-of-band

The spec says registration is "admin-managed" without defining who admin is. Commit to: **admin = whoever has shell access to the host filesystem**. There are no admin-only Telegram commands in MVP; user creation is exclusively a `users/<slug>/user.json` edit by the host operator. This avoids inventing an admin-identity model for MVP.

### 14. Single-process assumption

State files (`state.json`, audit log), per-user serialized queues, and runtime caches all assume one bot process. Add an explicit "FamilyOS assumes a single bot process; multi-process operation is out of scope for MVP". This is load-bearing — multi-process would require file locking, queue coordination, and state-file fencing that the design doesn't currently include.

### 15. State file durability

`state.json` is read/written on every active-session or active-agent change. Crash-mid-write would corrupt it. Commit to atomic writes: write to `state.json.tmp` and `rename()` over the target. One sentence is enough.

### 16. Audit log concurrency

`logs/audit.jsonl` is shared. Commit to: single writer per process, line-buffered append (POSIX `O_APPEND` is atomic for line-sized writes), no rotation in MVP. Operators rotate manually if needed.

## Schemas and bootstrap

### 17. `agent.json` needs a concrete example

Capability fields are described in prose but not formalized. The planner needs a concrete shape, e.g.:

```json
{
  "id": "default",
  "displayName": "FamilyOS Assistant",
  "model": { "provider": "anthropic", "id": "claude-sonnet-4-6" },
  "capabilities": {
    "tools": ["read", "grep", "find", "ls"],
    "readRoots": ["Inbox", "Workspace", "Exports"],
    "writeRoots": ["Workspace", "Exports"]
  }
}
```

Specify:

- `tools` is a closed enum drawn from Pi's built-in tool names plus any FamilyOS-defined tools; unknown values cause a load-time error
- `bash` in `tools` is rejected with a load-time error (MVP guarantee)
- empty `tools` means "chat-only agent, no file access"
- roots are paths relative to the user home

### 18. Default agent must be shipped

`config/familyos.json` references a default agent. The MVP must ship a baseline `agents/default/SOUL.md` and `agents/default/agent.json`, otherwise the system can't boot for a fresh install. Commit to a stock default persona.

### 19. Bot token via env var

Configure the Telegram bot token via the `TELEGRAM_BOT_TOKEN` environment variable. Fail to start with a clear error if it's missing.

Reasoning:

- doesn't end up in git, screenshots, or backups by accident
- trivially settable from a launchd/systemd unit, a `.env` file, or a one-off `export`
- aligns with how Pi already handles secrets (`~/.pi/agent/auth.json` lives outside the repo)

If file-based config is ever required, add a fallback to `config/secrets.json` (gitignored) — but for MVP, env var only is cleaner.

### 20. `thinkingLevel` is unaddressed

Pi's models support a `thinkingLevel` (`off, minimal, low, medium, high, xhigh` — `docs/pi/docs/sdk.md`, model section). The spec's `/model` flow doesn't mention it. Either:

- add `thinkingLevel` to the `/model` flow alongside model selection, or
- explicitly defer it ("MVP uses each model's default thinking level; per-session thinking control is out of scope")

Pick one in the spec.

### 21. First-run scaffold contents

When a user first chats and `home/.pi/settings.json` plus `home/.familyos/settings.json` are scaffolded, what do they contain? Recommend empty `{}` files — it makes the merge semantics trivially correct and gives the user something to edit. State this explicitly.

## Handoff prompt for `/agent` continue-current-session

Decision: the handoff text is positioned **after** the cached system prompt + tool defs, not prepended to the system prompt. This preserves KV cache stability for the persona prompt and tool definitions, which are the largest stable prefix.

### Placement

Two viable placements; recommend (a):

a. **Non-cached suffix block in the system content array.** When using `cache_control` on the API request, mark the persona SOUL.md + tool guidelines as the cached prefix and append the handoff as an additional `system` content block without `cache_control`. Pi exposes `before_provider_request` for payload mutation:

   > `before_provider_request` — fired after the provider-specific payload is built, right before the request is sent. Returning any other value replaces the payload for later handlers and for the actual request. — `docs/pi/docs/extensions.md:584`

   The FamilyOS extension intercepts the next outgoing request after `/agent` continue, appends the handoff block, and clears its one-shot flag so subsequent requests omit it.

b. **Synthetic message at the head of the conversation history.** Insert a single user-role message at the top of the messages array containing the handoff text wrapped in `<system-handoff>` tags or similar. Less clean — the model sees instruction-shaped text disguised as user content, which is exactly what the spec's wording about "do not send as a user message" was trying to avoid.

The implementation plan should commit to (a) and identify the `before_provider_request` (or equivalent) hook as the seam.

### Lifecycle

- The handoff fires **once**, on the next `prompt()` after `/agent` continue-current-session.
- After that turn, the handoff is dropped and the system prompt reverts to `<SOUL.md> + <tool guidelines>` only.
- On `/agent` start-fresh-session and `/agent` branch-with-summary, no handoff is needed — the new session starts clean with the new persona's prompt.

### Text

Keep the text in code or under `agents/_system/handoff.md`, not inside any specific agent's SOUL.md (it's cross-cutting plumbing, not persona content):

```
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

## Summary of amendments requested

1. Reword tool-override paragraph to match Pi's actual mechanism; commit to selective-load style; rule out `bash` at load time.
2. Add explicit requirement to re-author `promptSnippet` and `promptGuidelines` for every guarded tool override.
3. State that the system prompt is composed of SOUL.md plus tool guidelines, both cacheable.
4. Define per-user runtime lifecycle: lazy create, no eviction, lifetime = bot process.
5. Note that Pi sessions live under `agentDir`, not under the FamilyOS tree.
6. Replace the flattened `/tree` UX with the ASCII-tree-in-monospace + numeric callback-button design; default filter to `user-only`.
7. Replace named activity strings with Telegram's typing indicator (with re-ping timer); keep a single status message only for `/compact`.
8. Specify reply splitting and parse mode (recommend HTML).
9. Lock down attachment scope: text + images + generic documents; voice/video/stickers deferred.
10. Decide on `/cancel` for MVP (recommend yes).
11. State that non-private Telegram chats are silently ignored.
12. State that unregistered users trigger no work — no download, no scaffold, no runtime.
13. Define admin as out-of-band shell access; no admin Telegram commands in MVP.
14. State the single-process assumption.
15. Atomic-write `state.json` via tmp + rename.
16. Audit log: single writer per process, line-buffered append, no MVP rotation.
17. Provide a concrete `agent.json` example and reject unknown / `bash` capabilities at load.
18. Ship a default `agents/default/` bundle.
19. Bot token via `TELEGRAM_BOT_TOKEN` env var; fail to start if missing.
20. Decide whether `thinkingLevel` is exposed in `/model` or explicitly deferred.
21. Specify first-run scaffold contents (empty `{}` for both settings files).
22. Capture the handoff prompt placement (post-cache, via `before_provider_request`), one-shot lifecycle, and the text above.
