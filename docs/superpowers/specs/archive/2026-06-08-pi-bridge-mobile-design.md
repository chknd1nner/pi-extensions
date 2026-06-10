# Pi Bridge & Pi Mobile — Design Spec

**Date:** 2026-06-08
**Status:** Design approved, ready for implementation planning
**Scope:** v1 MVP (LAN-only). v2 BYO-relay deferred to a future spec.

---

## 1. Overview

A native Mac menubar app and accompanying iOS app that let a single user converse with Pi sessions on their Mac from their phone, with a ChatGPT-mobile-style chat experience rather than a "mobile VSCode".

The core scenario: *"Lying in bed, wanting to talk to my Mac in the next room without getting up."*

**Three components:**

| Component | Tech | Role |
|---|---|---|
| **Pi Mobile** | SwiftUI, iOS 17+ | The chat app. All mobile UX. |
| **Pi Bridge.app** | SwiftUI, macOS 14+, menubar (`LSUIElement`) | Status + control surface. Owns the daemon's lifecycle and the pairing UI. Tiny — a shell over the daemon. |
| **pi-bridge-daemon** | Node | The brain. mDNS responder, WSS server, project/session enumerator, RPC supervisor, event multiplexer. Spawned and supervised by `Pi Bridge.app`. |

Pi itself is **unchanged**. We talk to its existing `pi --mode rpc` interface — spawning one RPC child per actively-attached session, with the correct cwd and `--session <path>` so the project's `.pi/` extensions, skills, prompts, MCP servers, and settings load exactly as they would in a terminal.

## 2. Inspirations & non-goals

**Inspired by:**
- **Codex desktop app** — for the consumer-chat feel and the "no current project? auto-fold a date-named folder" pattern.
- **ChatGPT mobile** — for the chat-first interaction model and recents-driven navigation.
- **Paseo** — for proving the underlying architecture works (Bonjour discovery, ephemeral keypair handshake) while also providing several anti-patterns to avoid (Tailscale dependency, forever-secret QR, no allowlist).

**Non-goals:**
- Multi-agent support (Claude Code, OpenCode, Codex). **Pi only.**
- Mobile code editing or file management (create / delete / rename / move). Read-only file viewing with select-to-quote.
- "Mobile IDE" features (terminal, diff editing, git operations, build/run).
- Web client. Native iOS only for v1.
- Android. Future, not v1.

## 3. Mobile UX

### 3.1 Information architecture

```
Home (landing)
├── Composer  → sending creates new chat in current project
├── Project pill  → tap → bottom sheet Project Picker
└── Hamburger (top-left)  → Left flyout

Project Picker (bottom sheet)
└── List grouped by paired Mac, "Don't use a project" per Mac

Left flyout (full screen)  — chats navigation
├── Collapsible project folders (default expanded)
├── "Chats" folder (highlighted) — ad-hoc/non-project chats
├── ⋯ menu top-right (sort options + Settings cog)
└── ✎ Chat FAB bottom-right → returns home

Chat thread
├── Header: ‹ back · title · project · model · 📂 · ⋯
├── Body: transcript (progressive disclosure of tool calls)
├── Composer at bottom
└── 📂 (top-right of header) → Right flyout

Right flyout (full screen)  — files in this chat's CWD
├── Top pane: every file touched this session, newest first
└── Bottom pane: folder tree of CWD (collapsible)
        ↓ tap any file
File Viewer (modal)
├── Markdown rendered for .md; monospace for code; image preview for images
├── Text wrap ON by default
└── Select text → native iOS menu with "Reference in chat" action
```

### 3.2 Home (launch screen)

Minimalist. Large randomised greeting text centred:
- "Good evening Martin, what shall we work on?"
- "Coffee and Pi time, Martin?"
- "Martin returns!"
- "What's cookin' good lookin'?"

Below the greeting: a **current-project pill** acting as a control. Sticky to the last-used project. Tap → bottom-sheet Project Picker.

Bottom: traditional 2-row composer ("Ask Pi…"). Bottom-left `+` reveals attachments (stock iOS file/camera/photo library pickers). Bottom-right: model picker pill + send button.

Top-left: hamburger icon opens the Left flyout. **No 📂 icon on home** — files have no context until inside a chat.

Sending the composer creates a **new chat** in the currently-selected project (or in `~/Documents/Pi/YYYY-MM-DD/<slug>/` if "Don't use a project" was selected — see §7).

### 3.3 Project picker (bottom sheet)

Slides up over a dimmed home. Sectioned by paired Mac (line dividers between Macs). Each Mac section contains:

1. "＋ Don't use a project" at top of that Mac's section.
2. List of CWDs that have Pi sessions, sorted by most-recently-used.

Current selection is ticked.

### 3.4 Left flyout (chats navigation)

Full-screen takeover from the left.

- **Folders are projects.** Collapsible, default expanded. Tap to collapse.
- One special **"Chats"** folder, visually distinct (warm tint), holds all non-project ad-hoc chats.
- **Project vs ad-hoc classification**: a session belongs to the "Chats" folder if its CWD matches the configured `<adhocRoot>/YYYY-MM-DD/<slug>/` pattern (see §6); otherwise its CWD is treated as a project.
- **Endlessly scrolling**, dynamically loads next page when scrolled to bottom.
- **⋯ menu top-right** → sort options (Project / Chronological / Chats first) and a Settings cog below them. Settings opens a modal page with `×` to dismiss.
- **✎ Chat FAB bottom-right** → collapses flyout, returns to home.

### 3.5 Chat thread

**Header:** `‹ back  |  title (chat slug or first-prompt-derived)  ·  subtitle: project · model  |  📂 files  |  ⋯ more`

Back button always returns to home (not to the left flyout — the flyout isn't in the navigation stack).

**Transcript** uses **progressive disclosure** for tool activity:
- **Tool calls render as inline pills**: `ran` `read` `edited` `created` etc. (verbs in blue, text only — no glyphs). Truncated target + meta in subtle text (`+12 −3`, `✓ 14 passed`). Tap to expand to full command/output.
- **Thinking blocks** render as a faint `▶ 💭 thinking` pill. Tap → expand, the `▶` rotates to `▼`.
- **Active tool** (the one currently running) tinted blue with a pulse animation.

User messages = right-aligned blue bubbles. Assistant text = left-aligned plain text.

### 3.6 Streaming, queueing, abort

During streaming, the composer shows **stop (■, black) + send (↑, blue) side-by-side** in that order, right of the model pill. Tap order = `[model] [stop] [send]` — thumb reach optimised for the most-used action (send) with stop deliberately interposed.

**Send button behaviour during streaming:**

- **Tap (default) = `steer`** — message queued, delivered after the current assistant turn finishes its tool calls, before the next LLM call. The message appears at the bottom of the transcript as a **dashed blue bubble** with a `queued · steer` badge. When the agent attends to it, the bubble morphs into a solid blue user-message bubble in place.
- **Long-press = fly-out menu** appears above the send button with two options, colour-coded:
  - **Steer** (blue dot, default action restated)
  - **Follow up** (amber dot) — `follow_up` semantics: queued, delivered only when the agent fully stops. Appears in transcript as a dashed amber bubble with `queued · follow up` badge.
- The user must deliberately tap a row in the fly-out to confirm — not a hover/release.
- A tiny amber dot on the send button hints at the long-press option.

**Stop button (■) = `abort`** the current operation.

**Note on Pi's actual semantics:** Pi has no mid-tool interrupt. `steer` is the smallest queueing granularity (turn-boundary). For mid-tool interruption, the user must stop + send.

### 3.7 Extension UI dialogs

When a Pi extension issues a UI request (`select` / `confirm` / `input` / `editor`):

- **Foreground**: a **modal bottom sheet** slides up over the transcript and **blocks interaction** until answered. Modal because it must not scroll out of view while tool calls continue underneath.
- **Background**: a **push notification** is delivered to the phone (APNS via the daemon — or via a small future relay component). User tapping the notification deep-links into the chat with the modal sheet pre-open.

The four request types map to standard iOS controls:

| Pi request | iOS treatment |
|---|---|
| `select` | List of option rows, single tap = chosen |
| `confirm` | Two large buttons (e.g. Allow / Block) |
| `input` | Single-line `UITextField` + Submit button |
| `editor` | Multi-line `UITextView` + Submit + Cancel |

Timeouts from the agent side are honoured — sheet auto-dismisses with `cancelled: true` if expired.

### 3.8 Right flyout (files)

Tap **📂** in the chat thread header. Full-screen flyout slides in from the right.

**Top pane** — "Recent · N":
- Lists every file touched this chat session, newest mtime first.
- Each row: icon, filename (truncated), meta (`edited · 2 min ago · +12 −3` or `created · just now`), small badge (`new` / `edit`).
- Subtle colour coding on the icon background: edited (amber), created (green), read (grey).

**Bottom pane** — "All files":
- Folder tree of the chat's CWD. Same visual style as the left flyout's project folders. Tap a folder to expand/collapse.
- Tap a file to open the viewer.
- **Read-only.** No create / delete / rename / move.

Close `×` top-left returns to the chat.

### 3.9 File viewer (modal)

Full-screen modal pushed when a file is tapped from anywhere (right flyout, or by tapping a tool pill in the chat transcript — both routes converge on the same viewer).

- **Header**: `× close  |  filename  |  project path subtitle  |  ↗ share`. Share = standard iOS share sheet (Mail, Messages, Files, etc.).
- **Body**:
  - `.md` → rendered Markdown.
  - Code (`.ts`, `.py`, etc.) → monospace, syntax-highlighted, line numbers.
  - Images → image preview.
  - Other → "Can't preview this file type" + share button.
- **Text wrap is ON by default** (no horizontal scrolling).
- **Diff view** is deferred to a v2 add-on (will appear as a tab toggle in the header toolbar).

**Select-to-quote**:
- User drags finger to select text.
- Native iOS selection handles + standard menu appears: `Copy  |  Reference in chat  |  Look Up`.
- Tap **Reference in chat** → modal closes, composer in the underlying chat now contains the selected text wrapped in a `> ` Markdown blockquote, cursor positioned just below ready to type.

### 3.10 Composer

Same on home and chat thread:

- 2-row text field placeholder: "Ask Pi…"
- Bottom-left: `+` → stock iOS pickers (camera, photo library, files).
- Bottom-right: model picker pill + send button.
- **Model picker pill** tap → bottom sheet listing available models for the session, current model ticked. Selecting changes the model for the next send onward (calls Pi RPC `set_model`).
- During streaming: `+ | model | stop | send` with stop/send side-by-side as described in §3.6.

Attachments preview as small cards above the text field before send.

### 3.11 Settings (mobile)

Reached via the ⋯ menu in the Left flyout. Modal page with `×` to dismiss.

For v1, just three things:

1. **Appearance** — Dark mode: Auto (system) / On / Off.
2. **Paired Macs** — list of paired Macs with name + fingerprint + paired date. Tap a row → detail view with "Unpair" (red, with confirm).
3. **About** — version, license.

**Explicitly NOT in mobile settings**: ad-hoc chat folder location (that's a Mac-side concern), server port, mDNS service name — all live in the Mac menubar's Settings.

## 4. Mac UX

### 4.1 Menubar popover (custom, not NSMenu)

Tray icon = small `π` badge with a green dot when running, grey when stopped, no badge when app is closed. Click → popover drops from the icon with a top arrow.

**Header section:**
- Pi-badge icon (left)
- "Pi Bridge" title + status sub-line (`● Running · port 7423`)
- **Start/stop toggle** (iPhone-style green switch) — flips the daemon on/off. Toggle off ≠ quit; the app stays in the tray, daemon stops.

**Stats section (when running):**
- Three tiles: `devices · chats today · tokens` (or similar at-a-glance numbers).

**Paired devices section:**
- Per device: green/grey dot, name ("Martin's iPhone"), tiny activity hint (`streaming "Fix the auth flow…"` / `idle · 12m`).

**Actions row:**
- Primary: `+ Pair device` → expands the popover content in-place to show the pairing QR (no separate window).
- Secondary: `⚙ Settings` → opens the Mac-side settings window (see §4.3).

**Footer row:**
- `Open Pi…` / `Logs` / `Quit` (right-aligned).

### 4.2 Pairing flow (in-popover)

See full design in §5.2; from the user's perspective:

1. Click `+ Pair device` in the popover.
2. Popover content shifts to show: pairing QR (large, centred) + below it: a truncated, tap-to-copy pairing URL + countdown timer (`Expires in 4:23 · burns on first use`).
3. User scans QR on iPhone (or pastes the link if scan fails).
4. Phone confirms the Mac name & fingerprint, names the new device, taps Pair.
5. Mac popover shows: ✓ Paired "Martin's iPhone".

No accept/reject prompt on Mac — the act of clicking "+ Pair device" is consent.

### 4.3 Mac Settings (preferences window)

Standard macOS preferences window. Sections:

- **General**: launch at login, show in Dock (off by default — menubar-only).
- **Server**: port (default 7423), mDNS service name (default `<hostname>`), regenerate identity keypair (with strong red warning — this unpairs all devices).
- **Sessions**: location of ad-hoc chats folder (default `~/Documents/Pi/`, the daemon appends `YYYY-MM-DD/<slug>/` automatically).
- **Devices**: paired devices list, per-device unpair / rename.
- **About**: version, license, build info.

## 5. Architecture

### 5.1 Transport: LAN-only, Bonjour-discovered, NaCl-encrypted WSS

**Discovery**: daemon registers a Bonjour service `_pi-bridge._tcp` on the LAN, broadcasting `host:port` and the Mac's pretty name. iOS uses `NWBrowser` to discover; user picks a Mac during pairing.

**Transport**: WebSocket Secure on the Bonjour-advertised port. The WSS itself is plain (self-signed TLS used only to satisfy iOS's URLSession defaults, **not** for auth). All payloads above the WS layer are encrypted using NaCl box (Curve25519 key agreement + XSalsa20-Poly1305 AEAD), so the WS cert is effectively irrelevant for security.

**Why NaCl over mutual TLS**: iOS Keychain + self-signed client certs is famously painful; NaCl box is 30 lines per side, deterministic, no cert lifecycle. Matches Paseo's choice for the same reason.

**Why LAN-only for v1**: the primary scenario ("lying in bed, Mac next room") works on LAN. No backend infrastructure, no domain, no account model, no ongoing ops. WAN access is the v2 BYO-relay story (§8).

### 5.2 Pairing protocol

**Identity model:**
- Mac: one persistent Curve25519 device keypair, stored in `~/Library/Application Support/Pi Bridge/identity.json`. **Not** in macOS Keychain (deliberate — avoids Keychain-ACL pain).
- Phone: one persistent Curve25519 device keypair, stored in iOS Keychain (Keychain is friendlier on iOS than on macOS).
- Daemon stores a JSON allowlist: `[{ devicePub, deviceName, pairedAt }, …]`.

**QR / paste-link payload** — URL with fragment to enable iOS universal-link app-open:

```
https://pi-bridge.app/#pair=<base64url(json)>
```

Where `json` is:

```json
{
  "v": 1,
  "name": "Martin's MacBook Pro",
  "host": "martins-macbook-pro.local:7423",
  "srv": "<base64url Curve25519 pubkey, 32 bytes>",
  "fp": "<hex SHA-256 of srv>",
  "tok": "<base64url 256-bit one-time pairing token>",
  "exp": <unix timestamp, ~5 min from now>,
  "relay": null
}
```

`relay` is null in v1; populated in v2.

**Handshake:**

1. Phone parses the URL fragment, validates `fp == SHA-256(srv)` and `exp > now`. Aborts on mismatch.
2. Phone resolves `host` (Bonjour first, DNS fallback) and opens a plain WSS connection.
3. Phone generates an ephemeral Curve25519 keypair for this handshake.
4. Phone sends `hello` encrypted with `box(ephSk, srv)`: `{ ephPub, tok, devicePub, deviceName }`.
5. Daemon decrypts, verifies `tok` is unconsumed and `exp > now`. Adds `{ devicePub, deviceName, pairedAt: now }` to its allowlist. Marks `tok` consumed. Replies `welcome` encrypted with the shared box key.
6. Phone stores `{ srv, host, devicePub, deviceSk }` in iOS Keychain.

**Subsequent connections:**
- No QR. Phone generates a fresh ephemeral keypair per session, sends a signed handshake authenticating as `devicePub` over NaCl box. Daemon checks `devicePub ∈ allowlist`, accepts.

**Why one-time + expiring token** (despite Paseo not having one): a leaked QR shouldn't be a permanent compromise. Five minutes is enough to scan in the same room; long enough not to feel rushed.

### 5.3 Session attach model

**Daemon responsibilities:**
- **mDNS responder**: advertises `_pi-bridge._tcp` while server is on.
- **WSS server**: accepts paired devices, terminates NaCl, multiplexes per-session streams.
- **Project / session enumeration**: scans `~/.pi/agent/sessions/` to list projects (CWDs) and their sessions. Watches that directory tree (not individual JSONLs) so newly-created sessions appear in mobile listings without restart. **This watch is for listing only — it does not drive any per-session live-update logic.**
- **RPC supervisor**: when a phone sends a `prompt` to a session, daemon spawns `pi --mode rpc --session <jsonl-path>` with the project's CWD. RPC child is short-lived — exits naturally after the prompt completes.
- **Event multiplexer**: broadcasts RPC events to all phones currently viewing that session (writer + any followers — see §5.4).
- **JSONL tailer**: on phone reattach to an existing session, walks the JSONL from the phone's last-known entry ID and ships the delta.

**Daemon does NOT:**
- Hold an RPC child alive when nobody's writing. Tailing is JSONL-on-disk only.
- Watch JSONLs continuously for external writers (see §5.4).
- Coordinate with Mac TUI in any way.

**PID lock**: daemon writes `~/Library/Application Support/Pi Bridge/daemon.pid`. Refuses to start if a fresh PID is already running. Prevents split-brain.

### 5.4 Concurrency (deliberately minimal)

**Pi has no native session concurrency protection.** Researchers' verdict (see references): `SessionManager` does plain `appendFileSync` and `openSync(..., "w")`, no `flock`, no file watching, no claim file. Concurrent writers race. Paseo also doesn't try to coordinate — their explicit position is *"behavior depends on the provider/runtime."*

**Pi Bridge's stance:** mirror Paseo's pragmatism. We control the mobile app; we make the mobile app **gracefully catch up to the JSONL head whenever the phone returns to foreground**. JSONL on disk is the source of truth.

**Catch-up flow:**
- Phone tracks `lastEntryId` (8-char hex from Pi's session entries).
- On foreground return or chat reopen, phone sends `{ type: "open_session", path, lastEntryId }`.
- Daemon walks the JSONL from disk, finds `lastEntryId`, ships every entry after it as a single batch.
- Phone fast-scrolls them in, then re-renders the current visible branch.
- Tree changes (`/tree` / `/fork` / `/clone` / compaction) ship a new `leafEntryId`; phone updates the branch view.

**Multi-device semantics** (e.g. iPhone + iPad on same Mac):
- **Single in-flight Bridge RPC per session.** Daemon refuses a second `prompt` against a session already mid-stream with `{ error: "session_busy", retryAfterMs }`. Phone shows a transient toast: *“Session is responding to another device — try again in a moment.”*
- **Event fan-out to all viewers**: any phone currently viewing the session gets the same RPC event stream. The viewing device that *didn't* send still sees the writer's prompt land and the response stream in live — it just can't itself send until the stream completes.
- **No "writer/follower" UI** in v1. No takeover button. No view-only banner. Aligns with the "99% single-user" expectation; complexity moved to v2 only if real friction emerges.

**Mac TUI co-editing case** (TUI and phone want the same session): explicitly **out of scope for coordination**. User is expected to know not to do both at once. The phone's catch-up-on-focus behaviour ensures mobile-side never operates on stale state. The user takes responsibility for closing/restarting TUI as needed.

### 5.5 System diagram

```
┌─ iPhone ────────────────────┐         ┌─ Mac ───────────────────────────────────────┐
│                             │         │                                             │
│   Pi Mobile  (SwiftUI)      │         │   Pi Bridge.app   (SwiftUI menubar)         │
│   • mDNS browse  (NWBrowser)│         │   • popover · pairing · device list         │
│   • NaCl box over WSS       │  WSS    │   • owns daemon lifecycle                   │
│   • Keychain: device keys   │←——————→│                                             │
│                             │ NaCl box│   pi-bridge-daemon  (Node)                  │
│                             │         │   • mDNS responder · WSS server             │
│                             │         │   • session enum · RPC supervisor           │
│                             │         │   • event multiplexer · JSONL tail          │
│                             │         │           ↓ stdio (per active session)      │
│                             │         │       pi --mode rpc                         │
│                             │         │       (loads ./.pi/ extensions, MCP, etc.)  │
│                             │         │           ↓ reads/writes                    │
│                             │         │       ~/.pi/agent/sessions/…jsonl           │
└─────────────────────────────┘         └─────────────────────────────────────────────┘
```

## 6. Auto-foldered ad-hoc chats workspace

When a user sends from home with **"Don't use a project"** selected, the daemon:

1. Takes the first user message (truncated to the first ~6 meaningful words, stop-words removed, lowercased, hyphens for spaces — Codex-style).
2. Builds path: `<adhocRoot>/YYYY-MM-DD/<slug>/` where `<adhocRoot>` is configurable (Mac Settings → Sessions; default `~/Documents/Pi/`).
3. **Creates the folder immediately** (the slug can't wait for a model-named-chat post-hoc — the CWD has to exist before Pi spawns).
4. Spawns `pi --mode rpc --session <new session jsonl>` with the new folder as CWD.
5. Pi sees the empty folder; any file operations Pi performs land there.

Naming collisions: append `-2`, `-3`, etc.

This folder is treated identically to a project CWD throughout the mobile UX. The Files flyout works on it. Whether to keep these folders forever is the user's call (Finder cleanup; no in-app delete in v1).

## 7. Out of scope for v1

| Item | Notes |
|---|---|
| WAN / off-LAN access | Deferred to v2 BYO-relay. |
| Android client | Future. |
| Web client | Future, possibly never. |
| Mobile file editing | Deliberate — share to iOS Files for external editors. |
| File create / delete / rename / move from mobile | Deliberate — ask the agent. |
| Diff view in mobile file viewer | v2 add-on. |
| In-app delete of ad-hoc chat folders | Use Finder. |
| Multi-Mac discovery in a single mobile app | Architecturally supported (project picker is sectioned by Mac); single-Mac pairing is the v1 default flow but multiple is allowed. |
| Push notifications via APNS | Required for backgrounded extension UI dialogs. Either via Apple Push Notification service (requires a small relay-like component) or via local notifications when the app is in the foreground only (degraded UX). Decision deferred to implementation planning. |

## 8. v2 BYO-relay (sketch, deferred)

Single decentralised relay model: the user runs their own relay (Fly.io / Railway / VPS / Cloudflare Tunnel) — we ship a small `pi-bridge-relay` binary they deploy. Configured via Mac Settings → Server → Relay URL.

**Why BYO not centralised:**
- No trust burden on the project maintainer ("can we read your bytes?" doesn't apply).
- No ongoing ops cost for the project.
- Strong privacy story: relay only forwards ciphertext (NaCl box is end-to-end).
- Open-source friendly.

**Implementation outline:**
- Mac daemon holds an outbound persistent WSS to the relay (`role: server`).
- Phone tries LAN first via Bonjour; falls back to relay WSS (`role: client`) using the same allowlist keypairs.
- Pairing QR adds a `relay: { url, srvRelay }` field.
- Relay is a ~couple-hundred-line Node app: route by `serverId`, forward opaque ciphertext. No crypto.

Not blocking v1 ship.

## 9. Implementation decomposition

This spec is one cohesive design but **three sequential implementation projects**:

1. **`pi-bridge-daemon`** (Node) — the protocol authority. Implementation order: mDNS responder → WSS + NaCl handshake → pairing flow → session enumeration → RPC supervisor → event multiplexer → JSONL tail/catchup. **Build first** — everything else depends on the protocol.
2. **`pi-bridge.app`** (SwiftUI menubar) — once the daemon protocol is stable, this is mostly UI: tray icon, popover, pairing screen, paired devices list, Mac Settings window. Spawns and supervises the daemon.
3. **`pi-mobile`** (SwiftUI iOS) — once paired Mac functionality is testable end-to-end, build the iOS app: home, project picker, left flyout, chat thread, streaming controls, extension dialog sheets, right flyout, file viewer, select-to-quote, mobile Settings.

Each gets its own implementation plan after this design is approved.

## 10. References

**Pi internals**
- Pi documentation: `~/.pi/agent/extensions/node_modules/@earendil-works/pi-coding-agent/docs/` — particularly `rpc.md`, `sessions.md`, `session-format.md`.

**Research reports** (all under `docs/superpowers/research/`)
- [`2026-06-08-pi-native-session-concurrency-findings.md`](../research/2026-06-08-pi-native-session-concurrency-findings.md) — Pi has zero session locking; evidence-backed from `SessionManager` source.
- [`2026-06-08-paseo-session-concurrency-findings.md`](../research/2026-06-08-paseo-session-concurrency-findings.md) — Paseo's concurrency stance (single subscription + fan-out, no session locks, deliberate non-coordination with external TUI).
- [`2026-06-08-paseo-qr-pairing-findings.md`](../research/2026-06-08-paseo-qr-pairing-findings.md) — Paseo's QR pairing flow (Curve25519, forever-secret QR, no allowlist, paste-link fallback) and what we borrow vs. reject.

**External**
- Paseo repo (read-only inspiration): https://github.com/getpaseo/paseo
- Brainstorm visual mockups: `.superpowers/brainstorm/` (gitignored).
