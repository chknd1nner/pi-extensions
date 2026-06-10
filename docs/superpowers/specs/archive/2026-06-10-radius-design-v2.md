# Radius — Design Spec (v2)

**Date:** 2026-06-10
**Status:** Revised after design review; ready for implementation planning
**Supersedes:** `2026-06-08-pi-bridge-mobile-design.md` (v1) and the review at `2026-06-08-pi-bridge-mobile-design-review.md`
**Scope:** v1 MVP (LAN-only). Radius Relay (v2 — BYO cloud relay) deferred to a future spec.

---

## 0. Naming

**Product family:**

| Surface | Name | Notes |
|---|---|---|
| Product (umbrella) | **Radius** | "Extending Pi's reach." Pi-adjacent metaphor. |
| iOS app | **Radius for iOS** | What the user installs on their phone. Bundle id placeholder: `app.radius.mobile`. |
| macOS menubar app | **Radius for Mac** | Menubar-only (`LSUIElement`). Bundle id placeholder: `app.radius.menubar`. |
| Local daemon binary | `radius-daemon` | Spawned by Radius for Mac. Node program. User may see it in Activity Monitor. |
| Future desktop chat client | **Radius Desktop** | Out of scope for v1; mentioned in §6 concurrency vision. |
| Future cloud relay binary | **Radius Relay** | Deferred; sketched in §9. |
| mDNS service type | `_radius._tcp` | User-visible in network admin tools. |
| Paste-link / universal link domain | `https://radius.app/` | Placeholder — confirm registration before ship. |
| macOS App Support directory | `~/Library/Application Support/Radius/` | Holds identity, allowlist, daemon PID lock. |
| Default ad-hoc chats folder | `~/Documents/Radius/YYYY-MM-DD/<slug>/` | Configurable via Mac settings. |

Pi itself is unchanged. We refer to the existing `pi --mode rpc` interface by its Pi name.

---

## 1. Overview

A pair of native apps that let one person converse with Pi (the coding agent) running on their Mac from their iPhone — with a ChatGPT-style mobile experience rather than a mobile IDE.

The core scenario: *"Lying in bed, wanting to talk to my Mac in the next room without getting up."*

**Three components for v1:**

| Component | Tech | Role |
|---|---|---|
| **Radius for iOS** | SwiftUI, iOS 17+ | The chat app. All mobile UX. |
| **Radius for Mac** | SwiftUI, macOS 14+, menubar (`LSUIElement`) | Status + control surface. Owns the daemon's lifecycle and the pairing UI. Tiny — a shell over the daemon. |
| **`radius-daemon`** | Node | The brain. mDNS responder, WebSocket server, pairing handshake, project/session enumerator, Pi-RPC supervisor, event multiplexer. Spawned and supervised by Radius for Mac. |

Pi itself is **unchanged**. The daemon talks to Pi's existing `pi --mode rpc` interface — spawning one short-lived RPC child per active mobile prompt, with the correct cwd and `--session <path>` so the project's `.pi/` extensions, skills, prompts, MCP servers, and settings load exactly as they would in a terminal.

---

## 2. Inspirations & non-goals

**Inspired by:**
- **Codex desktop app** — consumer-chat feel and the "no project? auto-fold a date-named workspace" pattern.
- **ChatGPT mobile** — chat-first interaction model and recents-driven navigation.
- **Paseo** — proved the underlying architecture works (Bonjour discovery, pairing-key + E2EE on top of plain WebSocket). Several decisions we explicitly diverge from: Paseo's permanent-secret QR, no allowlist, multi-agent abstraction, "Mobile VSCode" feel.

**Non-goals (v1):**
- Multi-agent support (Claude / Codex / OpenCode). **Pi only.**
- Mobile code editing or file management (create / delete / rename / move). Read-only file viewing with select-to-quote.
- "Mobile IDE" features (terminal, diff editing, git ops, build/run).
- Web client / PWA. Native iOS only — LAN connectivity from mobile browsers is genuinely awkward (mixed-content rules + no public CA for `.local` + no mDNS in browsers).
- Android. Future, not v1.
- Background push notifications. v1 is LAN-only and stays clean of cloud infra.
- App Store distribution. Sideload / TestFlight for v1; App Store only if the product proves itself.

---

## 3. Mobile UX (Radius for iOS)

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

Bottom: traditional 2-row composer ("Ask Pi…"). Bottom-left `+` reveals attachments — **images only for v1** (camera, photo library; matches Pi RPC's native attachment support). Bottom-right: model picker pill + send button.

Top-left: hamburger icon opens the Left flyout. **No 📂 icon on home** — files have no context until inside a chat.

Sending the composer creates a **new chat** in the currently-selected project (or in `~/Documents/Radius/YYYY-MM-DD/<slug>/` if "Don't use a project" was selected — see §7).

### 3.3 Project picker (bottom sheet)

Slides up over a dimmed home. Sectioned by paired Mac (line dividers between Macs). Each Mac section contains:

1. "＋ Don't use a project" at top of that Mac's section.
2. List of CWDs that have Pi sessions, sorted by most-recently-used.

Current selection is ticked. When only one Mac is paired, the Mac header is suppressed.

### 3.4 Left flyout (chats navigation)

Full-screen takeover from the left.

- **Folders are projects.** Collapsible, default expanded.
- One special **"Chats"** folder (warm tint) holds all non-project ad-hoc chats — sessions whose CWD matches the configured ad-hoc-root pattern (see §7).
- **Infinite scroll**, dynamically loads next page when scrolled to bottom.
- **⋯ menu top-right** → sort options (Project / Chronological / Chats first) and a Settings cog.
- **✎ Chat FAB bottom-right** → collapses flyout, returns to home.

### 3.5 Chat thread

**Header:** `‹ back  |  title  ·  subtitle: project · model  |  📂 files  |  ⋯ more`

Back button always returns to home.

**Transcript** uses **progressive disclosure** for tool activity:
- **Tool calls render as inline pills**: `ran` `read` `edited` `created` etc. (verbs in blue, text only — no glyphs). Tap to expand to full command/output.
- **Thinking blocks** render as a single expandable element. Rotation indicator on the toggle (`▶` collapsed → `▼` expanded). Note: this rotation indicator is the **only** glyph that appears with text — everything else is text-only verbs.
- **Active tool** (currently streaming) tinted blue with a subtle pulse.

User messages = right-aligned blue bubbles. Assistant text = left-aligned plain text. Stream tokens render incrementally with a cursor caret at the live tail.

### 3.6 Streaming controls — send, queue, abort

During streaming, the composer shows `[+] [model ▾] [stop ■] [send ↑]` left-to-right, with stop/send side-by-side on the right.

**Send button behaviour during streaming:**
- **Tap (default) = `steer`** — message queued, delivered after the current assistant turn finishes its tool calls, before the next LLM call. Appears in transcript as a **dashed blue bubble** with a `queued · steer` badge. Morphs into a solid blue user-message bubble when the agent attends to it.
- **Long-press = fly-out** with two colour-coded options:
  - **Steer** (blue) — default action restated.
  - **Follow up** (amber) — `follow_up` semantics: queued, delivered only when the agent fully stops. Dashed amber bubble with `queued · follow up` badge.
- A tiny amber dot on the send button hints at the long-press.

**Stop button (■) = `abort`** the current operation.

**Pi semantic note:** Pi exposes no mid-tool interrupt. `steer` queues at turn boundaries. For genuine mid-tool interruption, user taps stop then composes a new prompt.

### 3.7 Extension UI dialogs (foreground only for v1)

When a Pi extension issues a UI request (`select` / `confirm` / `input` / `editor`):

- **App in foreground**: modal bottom sheet slides up, **blocks interaction** until answered. Auto-dismisses with `cancelled: true` if the agent's timeout fires.
- **App backgrounded**: the request is **buffered server-side** by `radius-daemon`. When the app returns to foreground and reopens the session, the buffered request is delivered and the modal sheet appears. If the agent timed out while the phone was away, the user sees a brief banner: *"Pi asked while you were away — request expired"*.

**No push notifications in v1.** v1 has no cloud infra and APNs requires a provider server. Users must be in-app to answer extension dialogs in real time. Acceptable for the "lying in bed, focused on Pi" use case.

The four request types map to standard iOS controls:

| Pi request | iOS treatment |
|---|---|
| `select` | List of option rows, single tap = chosen |
| `confirm` | Two large buttons (e.g. Allow / Block) |
| `input` | Single-line `UITextField` + Submit button |
| `editor` | Multi-line `UITextView` + Submit + Cancel |

### 3.8 Right flyout (files)

Tap **📂** in the chat thread header. Full-screen flyout slides in from the right.

**Top pane** — "Recent · N":
- Lists every file touched this chat session, newest mtime first.
- Sourced from: (a) `read_file` / `write` / `str_replace` / `create_file` tool args observed in the session JSONL, (b) file mtimes intersected with the session CWD. Best-effort — `bash` edits that bypass the tool surface aren't tracked. The list reflects what Pi *told us* it changed, plus what we can infer from disk.
- Each row: icon, filename (truncated), meta (`edited · 2 min ago · +12 −3` or `created · just now`), badge (`new` / `edit`).

**Bottom pane** — "All files":
- Folder tree of the chat's CWD. Same visual style as the left flyout's project folders. Tap a folder to expand/collapse.
- Tap a file to open the viewer.
- **Read-only** — no create / delete / rename / move.
- **Sandboxed** to the session CWD. Symlinks pointing outside the CWD are not followed (returned as 403 with a hint).
- Max tree size: 5000 files per directory level; deeper directories paginate. Sensitive paths (`.env*`, `.git/`, `node_modules/`, anything in the user's gitignore) are dimmed but still browsable — they're the user's files.

Close `×` top-left returns to the chat.

### 3.9 File viewer (modal)

Full-screen modal pushed when a file is tapped (right flyout, or by tapping a tool pill in the chat transcript — both routes converge on the same viewer).

- **Header**: `× close  |  filename  |  project path subtitle  |  ↗ share`. Share = standard iOS share sheet (Mail, Messages, Files, etc.).
- **Body**:
  - `.md` → rendered Markdown.
  - Code (`.ts`, `.py`, `.swift`, etc.) → monospace, syntax-highlighted, line numbers.
  - Images → image preview.
  - Other → "Can't preview this file type" + share button.
  - Hard cap: 5 MB. Above that, "File too large to preview" + share.
- **Text wrap is ON by default.** No horizontal scrolling.
- **Diff view** is deferred to v1.1 (will appear as a Code/Diff tab toggle in the header toolbar).

**Select-to-quote:**
- User drags finger to select text.
- Native iOS selection handles + standard menu appear: `Copy  |  Reference in chat  |  Look Up`.
- Tap **Reference in chat** → modal closes, composer in the underlying chat now contains the selected text wrapped in a `> ` Markdown blockquote, cursor positioned just below ready to type.

### 3.10 Composer

- 2-row text field placeholder: "Ask Pi…"
- Bottom-left: `+` → camera / photo library / files picker (**images only for v1** — multipart upload of arbitrary files is deferred to align with Pi RPC's native image-attachment surface).
- Bottom-right: model picker pill + send button.
- **Model picker pill** tap → bottom sheet listing models reported by Pi via `get_available_models`, current ticked. Selecting sends `set_model` on the next prompt (not immediately — avoids spawning a Pi RPC child just to set model).
- During streaming: `[+] [model ▾] [stop ■] [send ↑]` with stop/send side-by-side as described in §3.6.

Attachments preview as small cards above the text field before send.

### 3.11 Settings (mobile)

Reached via ⋯ menu in the Left flyout. Modal page with `×` to dismiss.

For v1, three sections:

1. **Appearance** — Dark mode: Auto (system) / On / Off.
2. **Paired Macs** — list of paired Macs with name + fingerprint + paired date. Tap a row → detail with `Unpair` (red, confirmed).
3. **About** — version, license, build info.

**Explicitly NOT in mobile settings**: ad-hoc chat folder location (Mac-side), server port (Mac-side), mDNS service name (Mac-side).

---

## 4. Mac UX (Radius for Mac)

### 4.1 Menubar popover (custom, not NSMenu)

Tray icon = small `π` badge (a circled or stylised pi glyph — the product is still about Pi sessions) with a green dot when running, grey when stopped. Click → custom popover drops from the icon with a top arrow.

**Header section:**
- App icon (left)
- "Radius" title + status sub-line (`● Running · port 7423`)
- **Start/stop toggle** (iPhone-style green switch) — flips the daemon on/off. Toggle off ≠ quit; the app stays in the tray, daemon stops.

**Stats section (when running):**
- Lean by default: just `● paired devices: 1` and `● sessions reachable: 12` (no token tiles — they don't validate the product).

**Paired devices section:**
- Per device: green/grey dot, name ("Martin's iPhone"), activity hint (`streaming "Fix the auth flow…"` / `idle · 12m`).

**Actions row:**
- Primary: `+ Pair device` → expands the popover content in-place to show the pairing QR (no separate window).
- Secondary: `⚙ Settings` → opens the Mac-side preferences window (see §4.3).

**Footer row:**
- `Open Pi…` / `Logs` / `Quit` (right-aligned).

### 4.2 Pairing flow (in-popover)

Mechanics in §5.4. From the user's perspective:

1. Click `+ Pair device` in the popover.
2. Popover content shifts to show the pairing QR (large, centred) + below it: a truncated, tap-to-copy paste link + countdown timer (`Expires in 4:23 · burns on first use`).
3. User scans the QR on iPhone (or pastes the link if scan fails — universal link opens Radius for iOS directly).
4. Phone shows the Mac name, public-key fingerprint, and a "Name this device" field. User confirms.
5. Mac popover updates: *"✓ Paired Martin's iPhone."*

No accept/reject prompt on Mac — the user clicked `+ Pair device`, which constitutes consent.

### 4.3 Mac Settings (preferences window)

Standard macOS preferences window. Sections:

- **General**: launch at login, show in Dock (off by default — menubar-only).
- **Server**: port (default 7423), mDNS service name (default `Radius on <hostname>`), regenerate identity keypair (red, unpairs all devices).
- **Sessions**: location of ad-hoc chats folder (default `~/Documents/Radius/`; daemon appends `YYYY-MM-DD/<slug>/`).
- **Devices**: paired devices list — per device: rename, unpair.
- **About**: version, license, build info.

---

## 5. Architecture

### 5.1 System diagram

```
┌─ iPhone ────────────────────┐         ┌─ Mac ────────────────────────────────────────┐
│                             │         │                                              │
│   Radius for iOS  (SwiftUI) │         │   Radius for Mac  (SwiftUI menubar)          │
│   • NWBrowser → _radius._tcp│         │   • popover · pairing · device list          │
│   • plain ws:// + NaCl box  │  ws://  │   • spawns + supervises daemon               │
│   • Keychain: device keys   │←───────→│                                              │
│                             │ NaCl box│   radius-daemon  (Node)                      │
│                             │ envelope│   • mDNS responder · WebSocket server        │
│                             │         │   • pairing handshake · NaCl box endpoints   │
│                             │         │   • project / session enum                   │
│                             │         │   • Pi-RPC supervisor (LF-strict stdio)      │
│                             │         │   • event multiplexer · JSONL tail/catch-up  │
│                             │         │           ↓ spawn per active prompt          │
│                             │         │       pi --mode rpc --session <path>         │
│                             │         │       (loads project ./.pi/ extensions etc.) │
│                             │         │           ↓ reads/writes                     │
│                             │         │       ~/.pi/agent/sessions/…jsonl            │
└─────────────────────────────┘         └──────────────────────────────────────────────┘
```

### 5.2 Transport: plain WebSocket + NaCl box

**Decision: plain `ws://`, no TLS at the transport layer.** All security comes from a NaCl box envelope around every frame above the WS layer.

This matches what Paseo actually ships (see `docs/superpowers/research/2026-06-10-paseo-tls-handling-findings.md`): their daemon uses `createHTTPServer`, not HTTPS, and their mobile app has no `URLSessionDelegate` for custom trust. Self-signed `wss://` on iOS requires either a `URLSessionDelegate` trust-pinning dance or ATS exceptions — both of which the user explicitly wanted to avoid (the Keychain pain they've already lived through).

**iOS `Info.plist` additions:**

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>Radius needs to find your Mac on your local network to chat with Pi.</string>
<key>NSBonjourServices</key>
<array>
    <string>_radius._tcp</string>
</array>
```

`NSAllowsLocalNetworking` is the dedicated exception for LAN-targeted plain HTTP/WS connections — it does not weaken ATS for the public internet.

### 5.3 Discovery: Bonjour + IP candidate fallback

**Primary discovery**: `radius-daemon` registers `_radius._tcp` via mDNS while the server is on. Service TXT record carries:
- `v=1` (protocol version)
- `id=<base64url(server-pubkey-fingerprint)>` (stable server identity — survives hostname changes)
- `name=<utf8 mac display name>` (user-configurable, default `Radius on <hostname>`)

iOS uses `NWBrowser` for `_radius._tcp`, prompts the user for Local Network permission on first browse.

**Fallback paths** for networks that block mDNS (hotel WiFi with client isolation, some corp networks, VPN intersections):

1. **QR encodes IP candidates** alongside Bonjour name (see §5.4). On first pairing, phone learns up to 3 reachable IPs of the Mac. These are stored alongside the server identity in iOS Keychain.
2. **Manual IP entry**: pairing screen has "Can't find your Mac?" affordance → user types the Mac's IP. Mac's preferences window has a prominent "Show your Mac's IP" panel.
3. **Stable identity over rotating IPs**: phone always cross-references the connected daemon's `serverId` against the stored fingerprint. The Mac's hostname can change; its `serverId` does not (unless the user regenerates the keypair).

### 5.4 Pairing protocol

**Identity model:**
- **Mac**: one persistent Curve25519 device keypair `(srvPub, srvSk)`, stored in `~/Library/Application Support/Radius/identity.json` with `0600` perms. Atomic write (tmp file + rename + fsync). **Not** in macOS Keychain (deliberate — avoids Keychain-ACL friction).
- **Phone**: one persistent Curve25519 device keypair `(devicePub, deviceSk)`, stored in iOS Keychain with `kSecAttrAccessibleAfterFirstUnlock`.
- Daemon stores a JSON allowlist `~/Library/Application Support/Radius/allowlist.json`:
  ```json
  [
    { "devicePub": "<base64url 32B>", "deviceName": "Martin's iPhone", "pairedAt": 1717958400 }
  ]
  ```

**Pairing offer payload** — URL with fragment for iOS universal-link app-open:

```
https://radius.app/#pair=<base64url(json)>
```

where `json` is:

```json
{
  "v": 1,
  "name": "Martin's MacBook Pro",
  "host": "martins-macbook-pro.local",
  "port": 7423,
  "ips": ["192.168.1.42", "10.0.0.4"],
  "srvPub": "<base64url 32B>",
  "fp": "<hex SHA-256 of srvPub>",
  "tok": "<base64url 32B one-time pairing token>",
  "exp": 1717958700,
  "relay": null
}
```

- `relay` is null in v1; populated in Radius Relay (v2).
- `ips` is the deduplicated list of non-loopback IPv4/IPv6 the Mac sees on its active interfaces at QR-generation time.
- `tok` is single-use, stored daemon-side **as a hash** (SHA-256, hex), never the raw token. Consumed atomically on first successful pairing.

**Pairing handshake (corrects v1's impossible-as-written first-frame design):**

Every Radius frame on the wire is binary:

```
┌─ 1 byte: frame type ─┬─ 32 bytes: sender-pubkey ─┬─ 24 bytes: nonce ─┬─ N bytes: ciphertext ─┐
└──────────────────────┴───────────────────────────┴───────────────────┴───────────────────────┘
```

- **Frame type** distinguishes `pair_hello (0x01)`, `pair_welcome (0x02)`, `auth_hello (0x03)`, `auth_welcome (0x04)`, `app (0x05)`. The pubkey field's interpretation depends on frame type.
- **Sender pubkey** is in the clear so the receiver can compute the shared key. For `pair_hello` this is the phone's ephemeral pubkey; for `auth_hello` and `app` this is the phone's `devicePub` (or omitted/zeroed after the first frame within a session — see §5.5). For server→client frames the field is the server's pubkey.
- **Nonce** is 24 bytes, structured as `8B random session-prefix || 1B direction || 7B reserved || 8B per-direction counter (big-endian, incrementing)`. Direction = 0x00 client→server, 0x01 server→client. Counter starts at 1 (0 reserved). Wrap is fatal — renew the session.
- **Ciphertext** = `crypto_box(plaintext_json_utf8, nonce, peerPubkey, ownSecretKey)` per NaCl. Includes Poly1305 MAC.

**Pairing sequence:**

1. Phone generates ephemeral `(ephPub, ephSk)` and a fresh session-prefix.
2. Phone sends `pair_hello`:
   - sender-pubkey = `ephPub` (clear)
   - plaintext = `{ "v": 1, "tok": "<token from QR>", "devicePub": "<phone's persistent pubkey>", "deviceName": "Martin's iPhone" }`
3. Daemon computes shared key `K_ephemeral = scalarMult(srvSk, ephPub)`. Decrypts. Verifies:
   - `v == 1`
   - `tok` matches an unconsumed, unexpired entry in `pairings.pending`
   - `devicePub` is well-formed and not already in allowlist (collision → reject)
4. Daemon atomically: consumes `tok`, appends `{ devicePub, deviceName, pairedAt: now }` to allowlist, fsyncs.
5. Daemon sends `pair_welcome`:
   - sender-pubkey = `srvPub` (clear, redundant but uniform)
   - plaintext = `{ "v": 1, "serverId": "<base64url(fp(srvPub))>", "serverName": "Martin's MacBook Pro", "sessionNonceSeed": "<8B>" }`
   - encrypted with `K_ephemeral` (i.e., `box(plaintext, nonce, ephPub, srvSk)`)
6. Phone decrypts using `K_ephemeral = scalarMult(ephSk, srvPub)`. Stores `(serverId, srvPub, host, port, ips, name)` in Keychain. Discards `(ephPub, ephSk)`.

**Subsequent (re)connections — `auth_hello` / `auth_welcome`:**

The persistent shared key is `K_session = scalarMult(deviceSk, srvPub) = scalarMult(srvSk, devicePub)`. Both sides can compute it without exchanging anything new.

1. Phone connects, generates fresh session-prefix and random `clientChallenge` (32B).
2. Phone sends `auth_hello`:
   - sender-pubkey = `devicePub` (clear)
   - plaintext = `{ "v": 1, "protocolVersion": 1, "clientChallenge": "<base64url>", "sessionPrefix": "<8B>" }`
   - encrypted with `K_session`
3. Daemon decrypts. Verifies `devicePub` is in allowlist. Generates fresh `serverChallenge` (32B), records the session prefix.
4. Daemon sends `auth_welcome`:
   - plaintext = `{ "v": 1, "protocolVersion": 1, "serverChallenge": "<base64url>", "sessionId": "<uuid>", "transcriptMac": "<HMAC-SHA256(K_session, clientChallenge || serverChallenge || sessionPrefix)>" }`
   - encrypted with `K_session`
5. Phone verifies `transcriptMac`. If mismatch, abort. Otherwise the handshake is bound; all subsequent `app` frames use `K_session` with counter starting at 1.

**Replay protection:**
- Per-direction monotonic counter inside the nonce. Receiver tracks last-seen counter per direction; rejects equal or lower.
- Counter is part of the nonce, which is part of the Poly1305 AEAD — tampering or replay across sessions is detected by MAC failure.
- `tok` (pairing) is single-use, hashed at rest.
- Session is bound by `transcriptMac` — replaying a captured `auth_hello/auth_welcome` pair from a previous session would produce a mismatching MAC vs. the live challenges.

**No client cert pinning, no TLS** — we don't need either. The pubkey IS the identity.

### 5.5 WebSocket protocol envelope

Above the framing in §5.4, the **application payload** is JSON. After the handshake, every `app` frame carries one of:

#### Request (client → server)

```json
{
  "id": "<uuid>",
  "type": "request",
  "method": "open_session",
  "params": { ... }
}
```

#### Response (server → client, correlated by `id`)

Success:
```json
{ "id": "<uuid>", "type": "response", "ok": true, "result": { ... } }
```

Error:
```json
{ "id": "<uuid>", "type": "response", "ok": false, "error": { "code": "session_busy", "message": "Session is responding to another device", "retryAfterMs": 3000 } }
```

#### Event (server → client, server-initiated)

```json
{ "id": "<server-event-uuid>", "type": "event", "topic": "session_event", "sessionPath": "...", "data": { ... } }
```

#### Ping / Pong

WS-layer ping/pong handles transport liveness. App-layer heartbeats are not needed for v1.

#### Close codes

| Code | Meaning |
|---|---|
| 1000 | Normal close |
| 4001 | Auth failure (unknown devicePub, bad MAC, replay) |
| 4002 | Protocol version unsupported |
| 4003 | Frame malformed |
| 4004 | Pairing token invalid / expired / consumed |
| 4005 | Session busy (writer conflict — see §6) |
| 4900 | Daemon shutting down |

#### Limits

- Max app-payload (decrypted JSON) per frame: 1 MB.
- Max event burst per subscription: 1000 events buffered server-side; older events dropped with a `subscription_lagged` event so the phone knows to re-sync via `get_session_delta`.

### 5.6 Radius ↔ Pi RPC command mapping

Pi's RPC interface (`pi --mode rpc`) uses **newline-delimited JSON over stdio with strict LF framing**. The Pi docs explicitly warn against Node `readline` (it splits on Unicode line separators). The daemon must implement its own LF-only splitter.

| Radius method | Pi RPC counterpart | Direction | Notes |
|---|---|---|---|
| `list_projects` | (synthetic; daemon walks `~/.pi/agent/sessions/`) | C→S | Returns array of `{ cwd, displayName, sessionCount, lastTouched }`. |
| `list_sessions` | (synthetic; daemon walks JSONL files for a CWD) | C→S | Returns `{ sessions: [{ path, title, leafEntryId, lastTouched, model }] }`. |
| `open_session` | (daemon-local; **does not** spawn Pi RPC) | C→S | Server records the subscription; returns `{ leafEntryId, branchPath, model }` from JSONL. |
| `close_session` | (daemon-local) | C→S | Unsubscribes; if no other phones subscribed and no in-flight prompt, no-op. |
| `get_session_delta` | (daemon-local JSONL walk from disk) | C→S | `params: { sessionPath, sinceEntryId }` → `{ entries: [...], newLeafEntryId }`. Used on focus return. |
| `prompt` | Pi `prompt` | C→S | Spawns Pi RPC child if not already alive for this session. Streams events back via `event/topic=session_event`. |
| `steer` | Pi `steer` | C→S | Requires active Pi RPC child for the session. |
| `follow_up` | Pi `follow_up` | C→S | Same. |
| `abort` | Pi `abort` | C→S | Same. |
| `set_model` | Pi `set_model` | C→S | Lazy — daemon buffers and applies before the next `prompt` to avoid spawning a child just to set model. |
| `get_available_models` | Pi `get_available_models` | C→S | Daemon caches result for 5 minutes per project. |
| `extension_ui_response` | Pi `extension_ui_response` | C→S | Phone's reply to an extension UI request. |
| `read_file` | (daemon-local FS, sandboxed to session CWD) | C→S | Returns file bytes; max 5 MB. |
| `list_files` | (daemon-local FS, sandboxed to session CWD) | C→S | Returns directory tree paginated. |
| `revoke_device` | (daemon-local; admin from another paired device) | C→S | Optional — also via Mac UI. |
| — | Pi events forwarded as `event/topic=session_event` | S→C | Includes assistant tokens, tool calls, tool results, extension UI requests, errors. |
| — | `session_changed` event | S→C | Fires when the daemon detects external append (new entry on disk it didn't write). Phone re-fetches delta. |
| — | `devices_changed` event | S→C | Allowlist changed — phone may refresh its own view. |
| — | `subscription_lagged` event | S→C | Buffer overflow; phone must `get_session_delta`. |

**Lazy RPC child lifecycle:**
- Spawned on the first `prompt`/`steer`/`follow_up` for a session.
- Lives across the active prompt PLUS the in-flight queue.
- Exits when the queue is empty AND the most recent assistant turn fully ends AND no new `prompt` arrives within a 60-second grace window (lets `follow_up` queued bubbles get attended without respawn).
- Killed on `abort` (graceful), then respawned on next `prompt`.

### 5.7 Operational concerns

#### Daemon crash recovery
- Daemon writes a PID file at `~/Library/Application Support/Radius/daemon.pid`. On startup, if a fresh PID is present, the new daemon refuses to start. Stale PID (no live process) is overwritten.
- On crash mid-stream: phone's WS connection dies; the in-flight Pi RPC child becomes orphaned. The Mac shell (Radius for Mac) detects daemon exit via the supervisor and either auto-restarts (default) or marks the menubar status as failed (after 3 restarts in 60s, give up and surface error).
- Orphaned Pi RPC children are detected on next daemon start by scanning for `pi` processes whose parent is PID 1 with `--mode rpc` in argv. They're sent SIGTERM (graceful, lets Pi finish the JSONL append) then SIGKILL after 5s.

#### Pi RPC child crash
- Daemon notices via stdio close. Sends `event/topic=session_event, data: { type: "rpc_child_exited", code }` to all subscribers. Phone shows a banner: *"Pi exited unexpectedly. The chat is safe — tap to retry."*

#### Phone disconnects mid-stream
- Daemon keeps the Pi RPC child running (it might be doing work the user wants finished). Events buffer up to the 1000-event cap.
- Reconnect: phone sends `auth_hello` + re-`open_session` + `get_session_delta`. Receives buffered events (or `subscription_lagged` if it overran), then live stream resumes.

#### Mac sleep / wake
- Sleep: WS connections die. Bonjour service deregisters. Daemon enters quiescent state — no Pi RPC children running.
- Wake: daemon re-registers Bonjour, accepts new connections. Phone detects (network reachability change → reconnect attempt with backoff: 0s / 1s / 5s / 30s / 5min). Menubar shows transient *"Reconnecting…"* on wake.

#### Network change (IP rotation, VPN toggle)
- iOS notifies via `NWPathMonitor`. Phone re-discovers via Bonjour first, then tries stored IP candidates, then prompts user.
- `serverId` cross-check ensures the phone doesn't accidentally connect to a different Mac that happens to share an IP.

### 5.8 iOS Local Network permission UX

First time the user opens Radius for iOS (or first time they tap **Find Macs**), iOS will show the system Local Network permission prompt with our `NSLocalNetworkUsageDescription`.

**Pre-permission screen** (shown before triggering the system prompt):

```
┌─────────────────────────────────┐
│           [Radius logo]         │
│                                 │
│      Find your Mac              │
│                                 │
│  Radius uses Bonjour to find    │
│  your Mac on your home Wi-Fi.   │
│  iOS will ask permission next.  │
│                                 │
│  [ Find my Mac ]                │
│                                 │
│  Already paired? [Restore]      │
└─────────────────────────────────┘
```

**If denied**: Radius shows a clear recovery screen explaining the user must enable Local Network in Settings → Radius. No retry-prompt loop — iOS doesn't allow re-prompting.

---

## 6. Concurrency posture — single-controller

**Design philosophy**: Radius treats itself as the sole writer of any session it touches. Internally, the daemon enforces single in-flight Pi RPC per session — second device sending to the same active session sees error `4005 / session_busy` and the phone displays a transient toast.

**Pi's reality check**: Pi has no native session locking. `SessionManager` does plain `appendFileSync` and `openSync(..., "w")` with no `flock`, no external-change watcher, no claim file. (See `docs/superpowers/research/2026-06-10-pi-native-session-concurrency-findings.md` for cited evidence.) **External writers (the Mac TUI, another Pi process started directly by the user) are completely outside Radius's coordination model.**

**The shrug, framed honestly**: this is a known limitation. The product target is the user who has a TUI on their Mac that they're not actively using when they're on their phone (e.g., lying in bed). If they keep a TUI on the same session running while typing on Radius, the two writers will race and either may corrupt the JSONL's branch structure.

**The long-term vision**: a future **Radius Desktop** chat client replaces the TUI for shared sessions. When both ends are Radius-controlled, the daemon arbitrates writes across desktop + mobile via the same single-in-flight model, fully eliminating the corruption risk. v1 ships mobile + Mac shell first because that's the immediate pain point; the desktop client is a v3 problem after the mobile UX is proven and Radius Relay (v2) ships.

**Paseo precedent**: Paseo ships with the same posture — no session-level lock, single-subscription fan-out per provider session, no coordination with external writers. (Source: `docs/superpowers/research/2026-06-08-paseo-session-concurrency-findings.md`.) We are not breaking new ground in accepting this risk for v1.

**Catch-up semantics** (the part Radius does well):
- Phone tracks `lastEntryId` (8-char hex from Pi's session entry IDs).
- On foreground return or chat reopen, phone calls `get_session_delta(sessionPath, lastEntryId)`.
- Daemon walks the JSONL from disk, finds `lastEntryId`, ships every entry after it in tree order.
- If `lastEntryId` is no longer present (compaction, manual edit, file rewrite), daemon returns `{ entries: [], newLeafEntryId, fullReload: true }` and phone re-fetches the entire branch with a soft banner: *"This chat changed on the Mac — refreshed view."*
- Tree changes (`/tree` / `/fork` / `/clone` / `/compact`) ship a new `leafEntryId` and branch path. Phone re-renders accordingly.

**Multi-device fan-out within Radius** (e.g., iPhone + future iPad):
- Single in-flight Pi RPC per session enforced in daemon.
- Multiple subscribers to the same session — events fan out from the one RPC child to all.
- Second device tries to send while first is mid-stream → `session_busy` toast on the second device. No takeover UI in v1 (defer until iPad is a real product).

---

## 7. Auto-foldered ad-hoc workspaces

When a user sends from home with **"Don't use a project"** selected, the daemon:

1. Takes the first user message, derives a slug:
   - Strip Markdown, leading/trailing whitespace.
   - Unicode-normalise (NFC), then take the first ~6 meaningful tokens (alphanumeric runs).
   - Lowercase.
   - Emojis & control characters: removed entirely.
   - Non-Latin scripts: kept as-is (NFC), with a sanity cap of 60 unicode characters total.
   - Replace runs of whitespace/punctuation with single `-`.
   - Trim trailing `-`.
   - **Empty result fallback**: `chat-<5-char random>` (e.g. `chat-x7k2m`).
2. Compute base path: `<adhocRoot>/YYYY-MM-DD/<slug>` where `<adhocRoot>` is configurable (Mac Settings → Sessions; default `~/Documents/Radius/`).
3. **Atomic create**: `mkdir <basepath>`. On `EEXIST`, append `-2`, retry. Continue `-3`, `-4`, ... up to `-99`. If all collide, fall back to `<slug>-<5-char random>`.
4. Spawn `pi --mode rpc --session <new session jsonl>` with the new folder as CWD.
5. Pi sees the empty folder; any file ops Pi performs land there.

**iCloud Documents caveat**: if the user has Documents synced to iCloud, `~/Documents/Radius/` is iCloud-synced. This is **fine** — actually a feature (cross-device backup of chat workspaces). Mac Settings → Sessions briefly notes this.

**Reserved filenames** (Windows-style `CON`, `PRN`, etc.) — not relevant on macOS but the slug normalisation refuses any path that starts with `.` to avoid hidden-file confusion.

**Folder deletion while session is live**: phone receives a `session_event` with `{ type: "cwd_missing" }` and the chat thread shows a non-blocking warning banner. The Pi RPC child is allowed to continue but any new file ops will fail.

---

## 8. Out of scope for v1

| Item | Notes |
|---|---|
| WAN / off-LAN access | Deferred to Radius Relay (§9). |
| Push notifications (APNs) | Cut entirely — v1 has no cloud infra. Extension dialogs require foreground app. |
| Android client | Future. |
| Web client / PWA | Future, possibly never (LAN connectivity from mobile browsers is awkward). |
| Mobile file editing | Deliberate — share to iOS Files for external editors. |
| File create / delete / rename / move from mobile | Deliberate — ask the agent. |
| Diff view in mobile file viewer | v1.1 add-on. |
| Generic file attachments | v1 = images only (matches Pi RPC). Multipart upload of arbitrary files in v1.1+. |
| In-app delete of ad-hoc chat folders | Use Finder. |
| Multi-Mac onboarding polish | Schema-ready (project picker is sectioned by Mac); v1 optimises for single-Mac flow. |
| Background extension UI | Foreground-only in v1. Buffered server-side, delivered on next foreground. |
| App Store distribution | Sideload / TestFlight only for v1. |
| Radius Desktop chat client | v3 problem after mobile + relay prove out. |

---

## 9. v2 — Radius Relay (sketch, deferred)

Single decentralised relay model: the user runs their own relay binary (we ship `radius-relay` they deploy to Fly.io / Railway / a VPS / Cloudflare Tunnel). Configured via Mac Settings → Server → Relay URL.

**Why BYO, not centralised:**
- No trust burden on the project maintainer.
- No ongoing ops cost for the project.
- Strong privacy story: relay forwards ciphertext only (NaCl box is end-to-end).
- Open-source friendly.

**Threat model the relay is designed for**: stolen phone + ability for the legitimate user to revoke that phone's access remotely. Allowlist edits propagate from Mac → relay → all connected devices instantly. Mac stores the canonical allowlist.

**Implementation outline:**
- Mac daemon holds an outbound persistent WSS to the relay (`role: server`). Relay is real TLS (Let's Encrypt expected for self-hosters — matches Paseo's posture; Paseo issue #293 documents the iOS TLS handshake failures self-hosters hit if they botch the cert).
- Phone tries LAN first via Bonjour; falls back to relay WSS (`role: client`) using the same allowlist keypairs.
- Pairing offer adds a populated `relay: { url, fingerprint }` field.
- Relay is a few-hundred-line Node app: route ciphertext by `serverId`. No crypto. Pure forwarder.
- Revocation: when the Mac removes a `devicePub` from the allowlist, it broadcasts a `revoke` ciphertext that all relays/phones honour by tearing down active subscriptions for that device.

Not blocking v1 ship.

---

## 10. Implementation decomposition

Re-ordered from v1 based on review feedback: **don't wait until step 3 to find out that the iOS transport assumptions are wrong**. Validate the hardest unknowns early.

**Step 1: `radius-daemon` protocol spike + CLI test client.**
- mDNS responder, plain WS server, NaCl box envelope, pairing handshake.
- Pi RPC supervisor (LF-strict stdio).
- Session enumeration + JSONL tail/catchup.
- Synthetic CLI test client that does the full handshake from the command line and can `prompt` / `subscribe` / `get_session_delta`. **No Mac UI yet.** Test the protocol end-to-end against a real Pi process.

**Step 2: Radius for iOS — thin vertical slice.**
- Pair (QR scan + paste link), connect, send prompt, stream text, abort, reconnect.
- Skeletal home + project picker + chat thread. No file flyout yet. No long-press menu yet.
- **Goal: validate iOS Local Network permission UX, NaCl crypto in Swift, NWBrowser reliability, WebSocket lifecycle across backgrounding.** These are the high-risk unknowns.

**Step 3: Radius for Mac — minimal supervisor + menubar.**
- Tray icon, popover with start/stop toggle, pairing QR, paired devices list.
- Spawns and supervises `radius-daemon`.
- Mac preferences window (skeletal — General + Server + Sessions sections).
- Now the daemon has a proper home and we can ship a private TestFlight build.

**Step 4: Broaden the iOS UI.**
- Left flyout, ⋯ sort menu, settings.
- Right flyout (recent files + file tree).
- Modal file viewer with markdown rendering + select-to-quote.
- Long-press → fly-out (steer / follow-up).
- Extension UI dialog sheets.
- Streaming tool pills with progressive disclosure.

**Step 5: Polish + ship.**
- Sleep/wake reliability, network change handling, slug edge cases, error toasts, empty states.
- App icons, launch screen, first-run flow.

Each step is its own implementation plan (per the `writing-plans` skill convention).

---

## 11. Dev tooling notes

### iOS iteration loop
Per `docs/superpowers/research/2026-06-10-swiftui-iteration-loop-findings.md`:
- **Primary**: native SwiftUI with `#Preview` + `@Previewable` + `PreviewModifier` + `@Observable`. Good for component-level iteration on healthy projects. Cold preview generation can still be 10–50s on complex views; warm edits sub-second.
- **Optional escape hatch**: integrate **Inject** (`krzysztofzablocki/Inject`, v1.6.0 April 2026) early. Adds `@ObserveInjection` + `.enableInjection()` to views you iterate heavily on. State-preserving live edits at the cost of one linker flag + per-view annotation.
- **Chat viewport library**: evaluate **ChatViewportKit** / **swiftui-messaging-ui** / **ConversationKit** at iOS-slice start (Step 2). The bottom-anchored / prepend-without-jump / streaming-cursor problem is solved; don't reinvent.
- **Brainstorm mockups** (`.superpowers/brainstorm/`) remain the fastest visual-design loop — HTML browser refresh — kept in flight throughout iOS development.

### Mac iteration loop
- SwiftUI Previews work fine for menubar popover content (it's a single window/popover).
- Use `LSUIElement = YES` and `NSWindow` styles for the popover. Standard patterns.

### Daemon iteration loop
- Node + `tsx watch` or Bun-based watcher. Standard.

---

## 12. References

**Pi internals**
- Pi documentation: `~/.pi/agent/extensions/node_modules/@earendil-works/pi-coding-agent/docs/` — particularly `rpc.md` (LF framing!), `sessions.md`, `session-format.md`.

**Research reports** (all under `docs/superpowers/research/`)
- [`2026-06-08-pi-native-session-concurrency-findings.md`](../research/2026-06-08-pi-native-session-concurrency-findings.md) — Pi has zero session locking; evidence-backed from `SessionManager` source.
- [`2026-06-08-paseo-session-concurrency-findings.md`](../research/2026-06-08-paseo-session-concurrency-findings.md) — Paseo's concurrency stance (single subscription + fan-out, no session locks, deliberate non-coordination).
- [`2026-06-08-paseo-qr-pairing-findings.md`](../research/2026-06-08-paseo-qr-pairing-findings.md) — Paseo's QR pairing flow.
- [`2026-06-10-paseo-tls-handling-findings.md`](../research/2026-06-10-paseo-tls-handling-findings.md) — Paseo uses plain `ws://` + E2EE; validates Radius's transport choice.
- [`2026-06-10-swiftui-iteration-loop-findings.md`](../research/2026-06-10-swiftui-iteration-loop-findings.md) — current state of SwiftUI dev iteration in 2026.

**External**
- Paseo repo (read-only inspiration): https://github.com/getpaseo/paseo
- Inject: https://github.com/krzysztofzablocki/Inject
- Brainstorm visual mockups: `.superpowers/brainstorm/` (gitignored).

---

## 13. Changes from v1

For diff-against-v1 readers, the substantive changes are:

1. **Product name**: Pi Bridge / Pi Mobile → **Radius** family.
2. **Transport** (§5.2): self-signed WSS → **plain `ws://` + NaCl box envelope**. Validated by Paseo's shipped choice.
3. **Crypto handshake** (§5.4): fixed v1's impossible "encrypt the ephemeral pubkey inside the first encrypted frame" bug. ephPub now in clear frame header. Added nonces with structured counters, per-direction monotonic replay protection, server challenge + transcript MAC binding for subsequent connections.
4. **WS protocol envelope** (§5.5): formalised `request / response / event / error` with correlation IDs, close codes, frame limits.
5. **Pi RPC mapping table** (§5.6): explicit 1:1 mapping; LF-strict stdio framing called out.
6. **Operational concerns** (§5.7): daemon crash recovery, Pi child crash, phone disconnect, sleep/wake, network change all spelled out.
7. **iOS Local Network permission UX** (§5.8): pre-permission screen + denied-state recovery.
8. **Bonjour fallback** (§5.3): IP candidates in QR + manual IP entry + stable serverId (= pubkey fingerprint) decoupled from hostname.
9. **Concurrency** (§6): reframed from "shrug" to **single-controller posture** with explicit long-term Radius Desktop vision. No takeover UI in v1.
10. **Push notifications**: **cut from v1** (was deferred in v1). Extension dialogs are foreground-only; buffered server-side when phone is away.
11. **Attachments** (§3.10): images only for v1.
12. **Slug derivation** (§7): Unicode normalisation, emoji removal, empty-result fallback, atomic collision handling.
13. **Decomposition** (§10): re-ordered to daemon → iOS thin slice → Mac menubar → broaden UI → polish. Validates iOS unknowns early.
14. **Dev tooling notes** (§11): Inject as optional hot-reload escape hatch; chat viewport library to evaluate.
15. **Sandbox limits** (§3.8, §5.6): file viewer / read_file capped at 5 MB; file tree sandboxed to session CWD; symlinks outside CWD refused.
