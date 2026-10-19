# Claude Code inter-session messaging: implementation research

Provenance: produced by a delegated research worker for the `pi-agent-mesh` design work. See `docs/superpowers/specs/2026-10-19-agent-mesh-design.md`.

Research date: 2026-10-19 (local clock). Feature name in official docs: **cross-session messaging** (page title "Message your other Claude Code sessions"). Tools: `ListAgents`, `SendMessage`. Slash commands: `/list-agents` (alias `/peers`).

Source tags used below: **[OFFICIAL]** Anthropic docs or official changelog · **[ISSUE]** GitHub issue text (user reports, not Anthropic statements) · **[REDDIT]** search-result snippet only (Reddit pages would not load) · **[BLOG]** third-party blog · **[3P-RE]** third-party reverse engineering of the npm bundle, not Anthropic docs. Numbered sources are listed at the end.

---

## Executive summary

1. Shipped in **v2.1.224 on 2026-08-07** (official changelog). Default-on, no opt-in flag or experimental label. Requirements: v2.1.224 on macOS/Linux/WSL2, Windows later (see §1).
2. Same-machine transport: each session binds a **per-PID Unix domain socket** (user reports show `/tmp/cc-socks/<pid>.sock`; the docs describe a per-user fallback dir). Windows uses a named pipe. Cross-machine and cloud messages go through Anthropic servers via Remote Control.
3. Discovery is by **session name**. Names come from `/rename`, `--name`, or a generated default. Peers are listed from live sockets plus a per-PID JSON file under `~/.claude/sessions/` (user-reported, not in the docs).
4. **No durable mailbox on the same machine.** Messages are held only in the receiving process. A session that is not running cannot be addressed, and nothing documented spools messages for it.
5. Delivery: a busy receiver reads the message **between tool calls** (never mid-tool). An idle receiver gets a **new turn** started automatically. Inbound policy (accept/hold/refuse) depends on each session's permission-mode class.
6. Model-facing API: `ListAgents()` and `SendMessage({to, message, summary?, notify_when_idle?})`. The same `SendMessage` tool also serves subagents and agent-team teammates.
7. Safety model: a message is "information, never authority." Limits: ~1 MiB per message, burst and loop throttles, 50-message accepted queue, 100 held. Off switches: deny rules, `crossSessionInbound: refuse`, `isolatePeerMachines`.
8. User reports: heavy interest at launch, then recurring complaints about silent drops, name collisions, token burn from chatty sessions, Windows/Desktop breakage, and renames not surviving resume.
9. Most surprising detail: auto-generated names end in a **1-byte random suffix** (`<dir>-<2 hex>`), and the uniqueness check is skipped for default names. Two sessions can share a name, and a send to that name **succeeds silently** and reports "sent" (issue #91054, user decompile, not verified by me).
10. UNCONFIRMED: whether `SendMessage` wakes a stopped background session, the relay-loop threshold, and the exact registry schema.

---

## 1. What it is and when it shipped

**Official name:** "cross-session messaging" (docs and "what's new"). The tools are `SendMessage` and `ListAgents`. [OFFICIAL 1, 2]

**Changelog entry (official):**
- **2.1.224, "August 7, 2026":** "Added cross-session `SendMessage`: Claude Code sessions can now message each other, on any of your machines, with `ListAgents` to discover them (macOS and Linux)." Same release added `crossSessionInbound` and `dialogExpiry` settings. [OFFICIAL 3, 4]
- Precursor, 2.1.222 (Aug 4, 2026): messages sent to other agent sessions via `SendMessage` are evaluated by the permission classifier before dispatch. [OFFICIAL 3, 4]
- Pre-existing `SendMessage` for in-session agents: the changelog already mentions "inter-agent messaging" in 2.1.212. [OFFICIAL 4]
- Agent teams started as a research preview in 2.1.32, gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. [OFFICIAL 4]

**Post-launch version steps (official changelog unless noted):**

| Version | Date | Change |
|---|---|---|
| 2.1.224 | Aug 7 | Launch, macOS/Linux, same-machine + Remote Control |
| 2.1.225 | Aug 8 | Start new conversations with Remote Control peers by name (previously reply-only) |
| 2.1.228 | Aug 11 | Fixed first session after install sometimes lacking an inbox |
| 2.1.232 | Aug 13 [3P] | `@` mention of sessions; unique-name variants; `/config` rows; socket-dir hardening |
| 2.1.234 | — | Docs give this as the native-Windows floor (see below) |
| 2.1.235 | — | Refuses oversize messages up front |
| 2.1.236 | Aug 19 | `notify_when_idle` added |
| 2.1.238 | ~Aug 20 [3P] | Refused/dropped sends are reported to the sender |
| 2.1.239 | ~Aug 21 [3P] | Windows support announced in changelog; `ListAgents` shows own name and teammates |
| 2.1.243 | — | Inbox closes connections with no complete line within 30 s |
| 2.1.248 | Aug 27 | Same-machine messaging on Bedrock, Vertex, Foundry, and with telemetry disabled |

[OFFICIAL 3, 4]. Dates marked [3P] come from a third-party changelog mirror (core-directive), not the official file.

**Availability (official docs):** macOS, Linux, and WSL2 need v2.1.224. Native Windows needs v2.1.234 per the docs. The changelog announces Windows in v2.1.239, so treat 2.1.239 as the safe floor. Cloud and Remote Control peers need a claude.ai sign-in; API-key and Bedrock users cannot reach them. [OFFICIAL 1, 4]

**Stability:** No "experimental" or "preview" label in the docs. The docs say "When a session meets the requirements, messaging is on with nothing to enable." The changelog shows a steady stream of fixes after launch, so GA-by-default but young. [OFFICIAL 1, 4]

**Discrepancy:** Docs say the Windows floor is 2.1.234. Changelog announces Windows in 2.1.239. [OFFICIAL 1, 4]

**Unofficial pre-launch gating:** a third-party changelog note on 2.1.224 claims `ListAgents` was behind a server-side flag and never ran on Windows at that point. That was not in the official changelog and is superseded by the official docs. [3P-RE 34, 35]

---

## 2. Addressing and naming

**Naming (official):** Set a name with `claude -n/--name <name>` at startup or `/rename <name>` during a session. If unset, Claude Code generates one. The docs describe a "default display name" built from the working directory name. [OFFICIAL 1, 10]

**Uniqueness (official changelog, 2.1.232):** "Interactive sessions on one machine now keep unique names: starting or renaming a session to a name another live session already uses gives it a `name-word-word` variant and tells you." [OFFICIAL 4]

**Conflict with the docs:** Issue #91054 quotes docs text saying the dedup "doesn't check AI-generated titles or default display names." That sentence is **not** in the Oct 19 copy of the docs I fetched (searched for "AI-generated", "unique", "already uses", "default display"). Either the paragraph was removed or the issue quoted an earlier version. Treat the exemption as reported, not confirmed for the current docs. [ISSUE 14, OFFICIAL 1]

**Generated-name format (user decompile, not verified by me):** Issue #91054 says the derived name is `<slug(basename(cwd))>-<suffix>`. The suffix is `randomBytes(1).toString("hex")` (256 values) unless gate `tengu_session_stable_address` is on, in which case it is a hash of the session ID. The derived name skips the uniqueness check. Reporters observed collisions with ~20 sessions in one folder. [ISSUE 14]

**Address forms the model is told about (tool description, third-party capture of v2.1.291):**
- Bare name, e.g. `"worker"`: delivers if it exactly matches one live session.
- `"worker [3fa9c1]"`: name plus ref, only when a listing or error shows one. A ref you did not just read "will not resolve."
- `"main"`: background subagents only, meaning the main conversation.
- A background agent's `agentId`. [3P-RE 32]

**Undocumented address forms that the binary accepts:** `uds:<socket-path>` and `bridge:<session-id>`. Issue #90538 reproduces a `SendMessage` to `uds:/tmp/cc-socks/<pid>.sock` that succeeded. The same issue quotes the model-facing description saying "there is no separate address syntax." The `/status` Peer address row shows the `uds:` form officially. [ISSUE 13, OFFICIAL 1]

**Registry / directory of live sessions:**
- Official docs: no registry file is documented. They say a session "appears only when it binds an inbox socket." `/list-agents` is the official view. [OFFICIAL 1]
- User reports (consistent across three issues and a Reddit post): each interactive session writes `~/.claude/sessions/<pid>.json` with fields `pid`, `cwd`, `name`, `messagingSocketPath`, `procStart`, `peerProtocol`, `status`, `nameSource`. [ISSUE 14, 15, 16][REDDIT 25]
- `claude agents --json` is documented as printing sessions as a JSON array, and a Reddit comment says it lists live sessions with name, cwd, and status. [OFFICIAL 9][REDDIT 26]

**Can you address a session that is not running?**
- Same machine: **no**, as far as documented. Only sessions that bind a socket appear. [OFFICIAL 1]
- Subagents and teammates are different: "names keep working after an agent completes (a send resumes it from its transcript)." That rule is in the tool description for in-session agents, not for independent sessions. [3P-RE 32]
- Remote Control and cloud sessions: listed only while this session is connected to Remote Control. [OFFICIAL 1]
- Whether a `SendMessage` to a name of a stopped background session auto-resumes it: **UNCONFIRMED.** The agent-view docs say a reply or `claude attach` resumes a stopped session, but say nothing about messages. [OFFICIAL 9]

---

## 3. Transport and storage

**Same machine (official):** a per-session socket. Unix domain socket on macOS/Linux/WSL2, named pipe on native Windows. Messages never pass through Anthropic servers. [OFFICIAL 1]

**Socket path and perms:**
- Path form: `/tmp/cc-socks/<pid>.sock`. Source: user reports and one blog. [ISSUE 13][REDDIT 25][BLOG 30]
- Fallback: a private per-user directory `/tmp/cc-socks-<uid>` when the default directory is unusable (2.1.248). [OFFICIAL 1, 4]
- Owner-only: docs say "Claude Code restricts the socket to your operating-system user." Blake Crosley observed `srw-------` on the socket and `drwx------` on the directory. [OFFICIAL 1][BLOG 30]
- Hardening: refuses a pre-planted symlink or another user's directory (2.1.232); refuses to deliver through a symlinked target (error reference). [OFFICIAL 4, 7]
- Inbox closes any connection that sends no complete line within 30 s (2.1.243). [OFFICIAL 4]

**Auth token (official):** Each session exports `CLAUDE_CODE_MESSAGING_SOCKET` (path) and `CLAUDE_CODE_MESSAGING_TOKEN` (2.1.228+) to hooks and Bash subprocesses. A script can send `{"type":"auth","token":"<token>"}` as the first line. The line is optional on macOS/Linux and **required** on native Windows. [OFFICIAL 1, 6]

**Wire format:** Undocumented officially. The only detailed description is a third-party analysis of v2.1.215, which predates launch. It describes newline-delimited JSON user events wrapped as `<cross-session-message from="uds:..." from-name="...">`, sent with a five-second send timeout. Socket close counts as delivery. Treat as **pre-release, unverified for current builds.** [3P-RE 31] The receive-side wrapper is confirmed by issue #86629's transcript excerpt. [ISSUE 15]

**Durable storage on disk, by component:**

| Path | Contents | Source |
|---|---|---|
| `/tmp/cc-socks/<pid>.sock` (or `/tmp/cc-socks-<uid>/`) | Per-session inbox socket | OFFICIAL 1 (behavior), ISSUE 13 (path) |
| `~/.claude/sessions/<pid>.json` | Session registry entry | ISSUE 14, REDDIT 25 (not in docs) |
| `~/.claude/projects/<project>/<session-id>.jsonl` | Transcript, one JSON object per line | OFFICIAL 10 |
| `~/.claude/jobs/<id>/state.json` | Background session state | OFFICIAL 9 |
| `~/.claude/daemon/roster.json` | Supervisor's list of background sessions | OFFICIAL 9 |
| `~/.claude/daemon.log` | Supervisor log | OFFICIAL 9 |
| `~/.claude/teams/<team>/inboxes/<agent>.json` | Agent-team mailbox, one JSON array per recipient plus `.lock` | 3P-RE 31 (pre-release), not in official docs |

**Durability when the recipient is down:**
- Same machine: no spool is documented. Once a session exits, its socket goes away and the send has nowhere to land. Accepted-but-unread messages are held in memory: up to 50. Held messages (awaiting approval) are capped at 100 and the oldest is dropped. [OFFICIAL 1] Inference: nothing survives a process exit.
- Remote Control: messages to an `offline` session "arrive only after that session's machine reconnects," so the relay queues them server-side. [OFFICIAL 1]
- A Remote Control message that arrives during Claude Code's exit "stays queued for the session's next run" (2.1.228). [OFFICIAL 4]

---

## 4. Process model and lifecycle

**Process types (official):**
- **Interactive terminal session:** tied to the terminal; ends when it closes unless sent to the background. [OFFICIAL 9]
- **Background session** (`claude --bg`, agent view): managed by a **supervisor** daemon. Each session is its own Claude Code process under it. [OFFICIAL 9]
- **`claude -p` (headless):** binds a socket and appears in listings. **Bare mode** does not bind a socket and is unreachable. [OFFICIAL 1]

**Idle policy for background sessions (official):** A session that is finished or waiting for input, and unattached for about an hour, is stopped by the supervisor to free resources. The conversation stays on disk and resumes on attach or reply. Sessions still working, paused on a dialog, or pinned (`Ctrl+T`) keep running. Past 48 hours after a machine was off, sessions show as stopped. [OFFICIAL 9]

**Resume:** `claude --resume <session-id|name>`, `--continue`, `/resume`. A resumed session is a new process, so it gets a new pid and a new socket. [OFFICIAL 10] Inference: a resumed session is addressable again after it re-binds, but messages sent while it was down are gone.

**Renames across resume:** User reports say `/rename` names are not reliably restored on resume (#91054, citing #26240, #47197, #25090, #23610, #26134, and #95807). The official docs do not address this. [ISSUE 14]

**Concurrency:**
- Message delivery needs no shared mutable file: each process owns its own socket and registry file, named by pid. [OFFICIAL 1, ISSUE 14]
- Shared writes do exist: transcripts, the supervisor roster, and the registry. Changelog fixes show the team has hit races there: "`claude agents` ... opening a stopped session that you already resumed in another terminal no longer starts a second process on that conversation" (2.1.248), and `/rename` now warns when the registry update fails (2.1.247). [OFFICIAL 4]
- The lock mechanism for transcripts is **UNCONFIRMED.**
- Agent-team mailboxes (pre-release analysis only) use a per-inbox lock file with atomic rewrite. [3P-RE 31]

**Presence and stale detection:**
- Official: presence is a bound socket. [OFFICIAL 1]
- Reports: stale sockets are real. In #91105, 37 sockets existed, 35 with live PIDs, and 2 were ~8 h orphaned. The reporter's workaround is `ps -p <pid>` plus `lsof` on the socket's pid. [ISSUE 17]
- Registry entries carry `procStart` to detect PID reuse (user-reported). [REDDIT 25]
- Roster staleness: one Linux user reports that a session started after a peer's connect handshake never appears in that peer's `ListAgents` output, even after relaunch. Single report, not reproduced by me. [ISSUE 16]
- Presence also includes a busy/idle `status` per row. The tool description says each `ListAgents` row shows whether that session is busy or idle [3P-RE 32]. A blog also lists a `shell` state [BLOG 30].

---

## 5. Delivery semantics

**Mid-turn (official):** "The receiving Claude reads the message between tool calls during an active turn, so a running tool is never interrupted." [OFFICIAL 1]

**Tool-description wording (third-party capture of v2.1.291):** "messages enqueue and drain at the receiver's next tool round." [3P-RE 32] This matches the docs. It is not a mid-request steer, and it is not a separate queued follow-up turn.

**Idle receiver (official):** "When the receiving session is idle, Claude Code starts a new turn with the message." So yes, a message can start work without user input. [OFFICIAL 1]

**Permission gating (official):** Inbound policy comes from `crossSessionInbound` (`accept` | `hold` | `refuse`). Unset, Claude Code decides per message from two permission-mode classes:
- Bypass-mode sessions form one class; all others form the other.
- A prompting receiver accepts messages from prompting senders, and holds messages from bypassing senders for approval.
- A bypassing receiver holds everything except messages from bypassing senders.
[OFFICIAL 1, 5]

**Held messages (official):** Held messages open an approval dialog in an interactive terminal, showing sender and preview. Unanswered, they expire after `dialogExpiry` (default `5m`; options `60s`, `5m`, `10m`, `never`) and are dropped. `-p` sessions cannot show the dialog, so held messages expire. [OFFICIAL 1, 5]

**Can the user see it?** Yes. A dim one-line preview "`› Message from @api-worker: ...`" stays in the transcript. `Ctrl+O` expands it. `--verbose` shows the full text. Claude reads the full text either way. [OFFICIAL 1]

**Can the user interrupt it?** The docs do not describe interrupting a delivered message or cancelling a send. Denying a held message is the only documented user action. **UNCONFIRMED** whether Esc or similar stops a turn that a peer message started.

**Commands in messages:** A `/compact` in a message is plain text and is never executed. [OFFICIAL 1]

**Mentions:** An `@path` or `@server:resource` in a message is not expanded on the receiving side. Claude can still open the path with its own tools, subject to that session's permissions. [OFFICIAL 1, 3P-RE 32]

**Failure and loop behavior (official):**
- Sender-side refusals (before anything leaves): oversize (~1,048,576 chars), burst to one session ("30 were sent recently"), refused reply target. [OFFICIAL 7]
- Receiver-side: rate-limits repeats per sender, drops identical repeats in a short window, and queues at most 50 accepted messages. A relay chain is "cut" when it passes the recipient too many times or grows too long. The exact numbers are not documented. [OFFICIAL 1, 7]
- Pre-2.1.238, dropped messages were reported as sent. [OFFICIAL 7]

**Documented bugs in delivery:**
- **#86629** (desktop app, Windows, v2.1.227-2.1.229): messages rendered in the target UI but never reached the model. Reporters blamed a `requestIdleCallback` queue. Closed as duplicate of #86571. This path is the Desktop app's MCP tool `mcp__ccd_session_mgmt__send_message`, not CLI `SendMessage`. [ISSUE 15]
- **#90417** (Linux, Remote Control): messages reported sent never arrived; one echoed back to its own sender with the sender's name. Open. [ISSUE 18]
- **#91105** (macOS): `SendMessage` returned `{"success":true, msg_id}` for a roster address that routed nowhere. Open. [ISSUE 17]

---

## 6. Tools and API surface

**`ListAgents`** (also `ListPeers` alias per a third-party capture):
- Official description: "Lists the agents Claude can message with `SendMessage`: subagents in the session, agent team teammates, your other local Claude Code sessions, and, while this session is connected to Remote Control, your cloud sessions and Remote Control sessions on other machines." [OFFICIAL 8]
- Parameters: none documented officially. A third-party capture of v2.1.301 reports zero parameters, none required. [3P-RE 34] **Treat as UNCONFIRMED.**
- Row format: `name [ref]`, labeled by kind. Own name shown on the first line of `/list-agents` (2.1.239). [OFFICIAL 1, 4]

**`SendMessage`:** Parameters from the third-party capture of v2.1.291, which matches the docs on the points they cover. Schema has `additionalProperties: false`. [3P-RE 32]

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | Name from `ListAgents`, optional ` [ref]`, `main` (background subagents only), or a background agent's `agentId`. Pattern: no newlines, max 300 chars. |
| `message` | string | yes | Plain text. Recipient's human sees only the first line in the preview. |
| `summary` | string | no | 5-10 word label for the sender's own transcript row. **Not transmitted.** Truncated to 200 chars instead of rejected (2.1.222). |
| `notify_when_idle` | boolean | no | Same machine only. Main conversation only. One-shot. Lives 12 h. Omit `message` for a pure subscription. |

[OFFICIAL 1, 4, 3P-RE 32]

**Result semantics:** The current tool description says "A successful send means the message reached that session, not that its Claude read it." [3P-RE 32] The official docs describe receiver-side outcomes (delivered, held, refused) and do not say a successful send implies the recipient read it. [OFFICIAL 1]

**Slash commands:** `/list-agents` and `/peers`. [OFFICIAL 1]

**Mention-to-address:** Typing `@` in the prompt opens typeahead for live sessions (2.1.232). `@"release notes"` quotes names with spaces. [OFFICIAL 1]

**Block or allow:**
- Deny the tools: permission deny rules naming bare `SendMessage` and `ListAgents`. Denying `SendMessage` also removes subagent and teammate messaging, since they share the tool. [OFFICIAL 1]
- Inbound: `crossSessionInbound: refuse`. Also `/config` row "Messages from your other sessions." [OFFICIAL 1, 5]
- Outbound to other machines: `isolatePeerMachines: true` requires approval per message, even in bypass mode. [OFFICIAL 5]
- **Per-peer allow or block list: not documented.** UNCONFIRMED.

---

## 7. Permissions and safety

**Core rule (official):** "A message from another session never counts as your consent, so it can't answer a pending permission prompt on your behalf." Claude is told never to change permission settings, `CLAUDE.md`, or other configuration because another session asked. [OFFICIAL 1]

**Permission boundaries stay per session.** Claude is instructed never to ask another session to do something its own session was denied, or that its own permission settings would block. Receiving-side prompts still fire. [OFFICIAL 1]

**Classifier gating:** Since 2.1.222, in auto mode, the permission classifier reviews `SendMessage` before dispatch. [OFFICIAL 4]

**Local trust boundary:** Socket perms restrict delivery to the same OS user. [OFFICIAL 1] Own-child hooks and scripts are verified by process evidence or by the auth token. Unverifiable senders are treated as asserting no permission class, so bypass-mode receivers hold them. [OFFICIAL 1]

**Sandbox:** Sandboxed commands reach the socket only if the sandbox's Unix-socket settings allow it: `sandbox.network.allowUnixSockets` and `sandbox.network.allowAllUnixSockets`. [OFFICIAL 1] A blog reports that on Linux/WSL2 only `allowAllUnixSockets: true` opens it, because the seccomp filter cannot inspect paths. [BLOG 30, not verified against the sandbox docs]

**Cross-machine trust:** Requires a claude.ai sign-in and Remote Control. Organizations can disable with managed-settings deny rules plus `crossSessionInbound: refuse`. [OFFICIAL 1, 5]

**Rate limits and loop control:** Covered in §5. Specific thresholds are not documented, except the 1 MiB size cap, the 50-message queue, the 100-message hold, the 12 h notify lifetime, and the 5 min default dialog expiry. [OFFICIAL 1, 5, 7]

**Cost:** Delivered messages count toward usage like typed prompts. [OFFICIAL 1] Users complain that chatty sessions burn tokens (see §8).

**Known safety-relevant bugs:** #91105 (silent success for a non-routing address), #90417 (messages echoed to sender), and #91054 (ambiguous name delivers silently to one of two sessions). [ISSUE 14, 17, 18]

---

## 8. How users actually use it

**Adoption and launch reaction [REDDIT snippets, dates from the post headers]:**
- Aug 8-9, 2026: two launch threads, 390 and 448 points. r/ClaudeAI 1vio0w9 and r/ClaudeCode 1vjjhjh. [REDDIT 21, 22]
- Aug 9: the launch post's own text says "It sends a summary (not your history or files), and the other session picks it up mid-task." [REDDIT 21]
- Aug 19: a user reports a session on its own initiative messaging another session during concurrent Android and Sentry work. [REDDIT 27]
- Aug 25: "my sessions started talking to each other." A session found `SendMessage` on its own, and the behavior spread through a shared knowledge base. [REDDIT 28]
- Sept 29: "Now I can just name one of the sessions and tell the other..." Planning-consensus workflow between two agents. [REDDIT 23]

**Undocumented-feature discovery:** Issue #93035 was filed (Sept 9) because a user found the feature "by accident, months into using the tool." They ran a daily wrap-up across five sessions. The filer closed it the next day after finding the docs page. [ISSUE 12]

**Naming in natural language (official examples):** "Ask the session running in my other terminal...", "Explain what we just did to the session working on the payments API...", and "Let @api-worker know the schema migration finished." [OFFICIAL 1]

**What breaks, by user reports:**
- **Name collisions:** With ~20 sessions in one folder, generated names collide and sends land on the wrong session silently (#91054). Also reported after reload: 8 of 10 sessions came back with fresh derived names (#91054 comment). [ISSUE 14]
- **Ambiguous targets:** "ListAgents doesn't tell you which repo a session is in, which makes SendMessage a guessing game." Same-directory sessions look identical in listings. [REDDIT 26]
- **Stale or wrong addresses:** Roster-supplied suffixes stop matching the live address while `uds:` still routes. [ISSUE 17]
- **Token burn and unsolicited chatter:** "agents can talk between open clis and will trigger all stale sessions and destroy your usage" (r/ClaudeCode, Sept 20, 160 points, 88 comments). A reply: "messages ... asks your other sessions if they touched its files to waste tokens." [REDDIT 24, 23]
- **Platform gaps:** Windows broke for some Desktop users from 2.1.227 (#86629). Containers, sandbox, and WSL/Windows splits block reach. Bedrock, Vertex, Foundry, and telemetry-off were excluded until 2.1.248. [ISSUE 15, OFFICIAL 1]
- **Headless fleets:** A user running `claude -p` workers finds held messages die at the expiry deadline, so messages to such workers are "a dead message." [BLOG 38]
- **Feature asks:** a session-ID address that does not depend on names (#85160, referenced in #91105). A webhook to wake an idle session (#31854). [ISSUE 17, 20]
- **Workarounds in the wild:** A user-built relay across accounts using a channel API, which the author says official messaging cannot do. [REDDIT 29]

**Blog and hands-on reports [BLOG]:**
- Blake Crosley's writeup (verified Aug 25 on v2.1.246) is the most detailed third-party walkthrough. [BLOG 30]
- A Japanese hands-on from Aug 9 covers `ListAgents`/`SendMessage`, inbox socket, and Bedrock limits. [BLOG 37]
- A Medium hands-on and a Kevin's Blog test describe the workflow and the "message is not history" limit. [BLOG, snippets only]

---

## 9. Gaps: what it does not do

- **No durable offline delivery on the same machine.** A session that is down has no mailbox. [OFFICIAL 1, inference]
- **No delivery or read acknowledgement.** The sender gets "queued/accepted," not "read." The docs and the tool description say so. [OFFICIAL 1, 3P-RE 32]
- **No broadcast.** The v2.1.215 analysis says `to: "*"` is rejected (3P-RE 31). Official docs say nothing about multicast, so **treat as unsupported.**
- **No documented ID-based addressing.** Names are the address. Undocumented `uds:` works but the model is told it does not exist (#90538). [ISSUE 13]
- **No file or context transfer.** Text only. "A message is text one Claude writes..." [OFFICIAL 1]
- **No cross-account messaging outside Remote Control.** The docs describe only your own sessions. [OFFICIAL 1, REDDIT 29]
- **No documented per-peer block/allow list.** [OFFICIAL 1, 5]
- **No documented way to wake a stopped session by name.** [OFFICIAL 9, UNCONFIRMED]
- **Renames not durable across resume** (user reports). [ISSUE 14]
- **Windows and Desktop parity lag.** The Desktop app uses a different MCP path and has had silent drops. [ISSUE 15, 16]
- **Stale listings and sockets.** No official cleanup described. [ISSUE 17]
- **Silent failure modes.** The docs now name most of them, but #90417 and #91054 show cases where success is reported and the message goes elsewhere. [OFFICIAL 7, ISSUE 14, 18]

---

## Discrepancies and caveats

1. **Windows floor:** docs say 2.1.234; changelog announces Windows in 2.1.239. [OFFICIAL 1, 4]
2. **Dedup exemption:** quoted in #91054 but absent from the Oct 19 docs I fetched. [ISSUE 14, OFFICIAL 1]
3. **"Privacy variables silently disable it":** a third-party analysis says four privacy environment variables silently disable messaging. The official docs say same-machine messaging works with feature-flag fetching off on v2.1.248+, and changelog 2.1.248 says it was added for telemetry-disabled sessions. So the claim holds only for pre-2.1.248 builds. [BLOG 30, OFFICIAL 1, 4, 6]
4. **`isolatePeerMachines`:** a pre-release analysis says it is not consulted for plain-text `SendMessage`. The current docs say it requires approval for messages to other machines. Docs win. [3P-RE 31, OFFICIAL 5]
5. **Third-party 2.1.91 "peer session messaging" entry:** a mirror lists a 2.1.91 changelog entry for peer-session messages. The official changelog has no such entry in 2.1.91, so **do not treat as launch history.** [3P-RE, changelogs.core-directive.com]
6. **Pre-release internals:** the v2.1.215 analysis (3P-RE 31) predates launch and says peer-session providers were stubbed. Use it for shape, not for current behavior.

---

## Sources

| # | URL | Type | Date / access | Notes |
|---|---|---|---|---|
| 1 | https://code.claude.com/docs/en/cross-session-messaging | OFFICIAL docs | undated; fetched 2026-10-19 | Primary reference. Read in full. |
| 2 | https://code.claude.com/docs/en/whats-new/2026-w32 | OFFICIAL docs (what's new) | Aug 3-7, 2026 | Launch digest. |
| 3 | https://code.claude.com/docs/en/changelog | OFFICIAL changelog (web) | fetched 2026-10-19 | Dated entries; used for 2.1.222-2.1.248 dates. |
| 4 | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | OFFICIAL changelog (repo) | fetched 2026-10-19; top entry 2.1.303 | Used for version-by-version messaging entries. |
| 5 | https://code.claude.com/docs/en/settings-reference | OFFICIAL docs | fetched 2026-10-19 | `crossSessionInbound`, `dialogExpiry`, `isolatePeerMachines`. |
| 6 | https://code.claude.com/docs/en/env-vars | OFFICIAL docs | fetched 2026-10-19 | `CLAUDE_CODE_MESSAGING_*`, feature-flag fetching. |
| 7 | https://code.claude.com/docs/en/errors | OFFICIAL docs | fetched 2026-10-19 | Refusal and drop messages. |
| 8 | https://code.claude.com/docs/en/tools-reference | OFFICIAL docs | fetched 2026-10-19 | `ListAgents`, `SendMessage` rows. |
| 9 | https://code.claude.com/docs/en/agent-view | OFFICIAL docs | fetched 2026-10-19 | Supervisor, state paths, idle policy. |
| 10 | https://code.claude.com/docs/en/sessions | OFFICIAL docs | fetched 2026-10-19 | Naming, resume, transcript paths. |
| 11 | https://code.claude.com/docs/en/agent-teams | OFFICIAL docs | snippet only | Agent teams context. |
| 12 | https://github.com/anthropics/claude-code/issues/93035 | ISSUE (user report) | created 2026-09-09, closed 2026-09-10 | Undocumented-feature report, later closed as documented. |
| 13 | https://github.com/anthropics/claude-code/issues/90538 | ISSUE (user report) | created 2026-08-29; open | `uds:` address vs tool description. |
| 14 | https://github.com/anthropics/claude-code/issues/91054 | ISSUE (user report) | created 2026-08-31; open | Name collisions, derived-name decompile. |
| 15 | https://github.com/anthropics/claude-code/issues/86629 | ISSUE (user report) | created 2026-08-14; closed duplicate 2026-08-20 | Desktop delivery regression, transcript evidence. |
| 16 | https://github.com/anthropics/claude-code/issues/90481 | ISSUE (user report) | created 2026-08-28; open | Tool disabled after update; roster-staleness report. |
| 17 | https://github.com/anthropics/claude-code/issues/91105 | ISSUE (user report) | created 2026-09-01; open | Silent success for non-routing address; orphaned sockets. |
| 18 | https://github.com/anthropics/claude-code/issues/90417 | ISSUE (user report) | created 2026-08-28; open | Remote Control delivery and echo. |
| 19 | https://github.com/anthropics/claude-code/issues/56930 | ISSUE (user report) | May 2026; closed not planned | Background agents needing a ping; snippet only. |
| 20 | https://github.com/anthropics/claude-code/issues/31854 | ISSUE (feature request) | snippet only | Webhook to wake an idle session. |
| 21 | https://www.reddit.com/r/ClaudeCode/comments/1vjjhjh/new_in_claude_code_your_sessions_can_now_message/ | REDDIT | Aug 9, 2026; 448 pts | Snippet only. |
| 22 | https://www.reddit.com/r/ClaudeAI/comments/1vio0w9/claude_code_your_sessions_can_now_message_each/ | REDDIT | Aug 8, 2026; 390 pts | Snippet only. |
| 23 | https://www.reddit.com/r/ClaudeAI/comments/1wtdyot/claude_code_can_message_easily_between_sessions/ | REDDIT | Sep 29, 2026; 219 pts | Snippet only. |
| 24 | https://www.reddit.com/r/ClaudeCode/comments/1wlgfpw/anthropic_has_done_it_again_dont_keep_many_clis/ | REDDIT | Sep 20, 2026; 160 pts | Snippet only. Token-burn complaint. |
| 25 | https://www.reddit.com/r/ClaudeAI/comments/1wmnqyu/claude_codes_crosssession_messaging_is_a_json/ | REDDIT | Sep 21, 2026; 33 pts | Registry JSON and socket write-up. Snippet only. |
| 26 | https://www.reddit.com/r/ClaudeCode/comments/1wiizyc/listagents_doesnt_tell_you_which_repo_a_session/ | REDDIT | ~Sep 2026 (comment dated Sep 18) | Snippet only. |
| 27 | https://www.reddit.com/r/ClaudeAI/comments/1vsczag/observation_claude_code_utilizing_autonomous/ | REDDIT | Aug 19, 2026 | Snippet only. |
| 28 | https://www.reddit.com/r/ClaudeCode/comments/1vxpswc/my_sessions_started_talking_to_each_other/ | REDDIT | Aug 25, 2026 | Snippet only. |
| 29 | https://www.reddit.com/r/mcp/comments/1vna2ne/relaying_messages_between_2_claude_code_sessions/ | REDDIT | undated | Snippet only. Cross-account relay workaround. |
| 30 | https://blakecrosley.com/blog/claude-code-cross-session-messaging | BLOG | "re-verified Aug 25, 2026" | Read in full. Detailed socket and trust-model walkthrough. |
| 31 | https://claude-code.genisisiq.com/06-agents-automation/agent-messaging/ | 3P-RE (analysis) | analyzes v2.1.215 (pre-launch) | Read in full. Use for shape only. |
| 32 | https://changelogs.core-directive.com/prompts/2.1.291/tools/SendMessage | 3P-RE (prompt capture) | v2.1.291, Oct 6, 2026 | Read in full. `SendMessage` description and schema. |
| 33 | https://changelogs.core-directive.com/reference/tool/sendmessage | 3P-RE (version ledger) | fetched 2026-10-19 | Build presence ledger. |
| 34 | https://changelogs.core-directive.com/prompts/2.1.301/tools/ListAgents | 3P-RE (prompt capture) | v2.1.301, Oct 15, 2026 | Snippet only, parameter count. |
| 35 | https://changelogs.core-directive.com/v/2.1.224/e/new-listagents-tool-for-finding-other-sessions-you-can-messa | 3P-RE (changelog mirror) | Aug 7, 2026 | Snippet only. Gating claim. |
| 36 | https://cc.bruniaux.com/guide/workflows/cross-session-messaging/ | BLOG (guide) | undated | Snippet only. |
| 37 | https://dev.classmethod.jp/articles/claude-code-cross-session-messaging/ | BLOG (JP hands-on) | ~Aug 9, 2026 | Snippet only. |
| 38 | https://picklog.cc/blog/claude-code-cross-session-messaging | BLOG | undated | Snippet only. Headless fleet complaint. |
| 39 | https://github.com/yilunzhang/claude-code-inter-session | THIRD-PARTY tool | undated | Snippet only. Unofficial WebSocket bus, not Anthropic. |
| 40 | https://github.com/claude-code-best/claude-code (ListPeersTool) | THIRD-PARTY fork source | undated | Snippet only. Not official. |
| 41 | Web search for X/Twitter posts (queries containing "x.com") | X | — | No X posts surfaced in results. **UNCONFIRMED: no X sources found.** |

Searches run (distinct queries, 2026-10-19): 18 web searches, plus targeted fetches of official docs, the changelog, GitHub issues, Reddit JSON (blocked), and old.reddit (blocked).
