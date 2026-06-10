# Radius — Design Spec (v3)

**Date:** 2026-06-10
**Status:** Revised after second design review; ready for MVP implementation planning
**Supersedes:** `2026-06-10-radius-design-v2.md` and the second review at `2026-06-10-radius-design-v2-review.md`
**Scope:** v1 MVP (LAN-only). Radius Relay (v2 — BYO cloud relay) deferred to a future spec.

---

## 0. Naming

**Product family:**

| Surface | Name | Notes |
|---|---|---|
| Product (umbrella) | **Radius** | "Extending Pi's reach." Pi-adjacent metaphor. |
| iOS app | **Radius for iOS** | Bundle id placeholder: `app.radius.mobile`. |
| macOS menubar app | **Radius for Mac** | Menubar-only (`LSUIElement`). Bundle id placeholder: `app.radius.menubar`. |
| Local daemon binary | `radius-daemon` | Spawned by Radius for Mac. Node program. |
| Future desktop chat client | **Radius Desktop** | Out of scope for v1; referenced in §6 concurrency vision. |
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

Pi itself is **unchanged**. The daemon talks to Pi's existing `pi --mode rpc` interface — spawning one Pi RPC child per active session per the state machine in §5.6, with the correct cwd and `--session <path>` so the project's `.pi/` extensions, skills, prompts, MCP servers, and settings load exactly as they would in a terminal.

---

## 2. Inspirations & non-goals

**Inspired by:**
- **Codex desktop app** — consumer-chat feel and the "no project? auto-fold a date-named workspace" pattern.
- **ChatGPT mobile** — chat-first interaction model and recents-driven navigation.
- **Paseo** — proved the architecture works (Bonjour discovery, pairing-key + E2EE on top of plain WebSocket). We diverge from: permanent-secret QR (we use one-time tokens), no allowlist (we have one), multi-agent abstraction (we're Pi-only), "Mobile VSCode" feel (we're consumer-chat).

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

Bottom: traditional 2-row composer ("Ask Pi…"). Bottom-left `+` reveals attachments — **images only for v1** (see §3.10). Bottom-right: model picker pill + send button.

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

**Stop button (■) = `abort`** the current operation. **Available to any subscriber**, not just the active controller (see §6.2 — emergency stop).

**Active-controller restrictions** (see §6.2): if you're not the device that started this run, `steer` / `follow_up` are disabled with a subtle banner: *"Run started on Martin's iPad — you can watch and stop, but not steer."* `abort` remains enabled (logs as "Aborted by Martin's iPhone" in the transcript).

**Pi semantic note:** Pi exposes no mid-tool interrupt. `steer` queues at turn boundaries. For genuine mid-tool interruption, user taps stop then composes a new prompt.

### 3.7 Extension UI dialogs (foreground only for v1)

When a Pi extension issues a UI request (`select` / `confirm` / `input` / `editor`):

- **App in foreground**: modal bottom sheet slides up, **blocks interaction** until answered. Auto-dismisses with `cancelled: true` if the agent's timeout fires.
- **App backgrounded**: the request stays pending in the daemon's live session state. When the app returns to foreground and reopens the session, the unified `open_session` response (see §5.6) carries the pending UI request in `liveState.pendingExtensionUiRequest`, and the modal sheet appears immediately. If the agent timed out while the phone was away, the user sees a brief banner: *"Pi asked while you were away — request expired."*

**No push notifications in v1.** v1 has no cloud infra and APNs requires a provider server. Users must be in-app to answer extension dialogs in real time. Acceptable for the "lying in bed, focused on Pi" use case — and Pi's typical default of "no/abort" when the user doesn't respond means the agent gracefully pauses rather than silently doing the wrong thing.

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
- Sourced from **Pi's actual built-in tools**:
  - `read.args.path` → marked *read*.
  - `edit.args.path` (plus `edit.details.patch` for the diff metadata) → marked *edited* (+N −M).
  - `write.args.path` → marked *created* or *overwritten*.
  - `bash` → best-effort only; not tracked unless a subsequent compaction/branch summary explicitly mentions a file.
- Each row: icon, filename (truncated), meta (`edited · 2 min ago · +12 −3` or `created · just now`), badge (`new` / `edit`).

**Bottom pane** — "All files":
- Folder tree of the chat's CWD. Same visual style as the left flyout's project folders. Tap a folder to expand/collapse.
- Tap a file to open the viewer.
- **Read-only** — no create / delete / rename / move.
- **Sandboxed** to the session CWD. Symlinks pointing outside the CWD are not followed (returned as 403 with a hint).
- Max tree size: 5000 files per directory level; deeper directories paginate. Sensitive paths (`.env*`, `.git/`, `node_modules/`, anything in the user's gitignore) are dimmed but still browsable — see §6.3 trust model for why.

Close `×` top-left returns to the chat.

### 3.9 File viewer (modal)

Full-screen modal pushed when a file is tapped (right flyout, or by tapping a tool pill in the chat transcript — both routes converge on the same viewer).

- **Header**: `× close  |  filename  |  project path subtitle  |  ↗ share`. Share = standard iOS share sheet (Mail, Messages, Files, etc.).
- **Body**:
  - `.md` → rendered Markdown.
  - Code (`.ts`, `.py`, `.swift`, etc.) → monospace, syntax-highlighted, line numbers.
  - Images → image preview.
  - Other → "Can't preview this file type" + share button.
  - **Files > 4 MB are fetched via chunked transfer** (see §5.7). Hard cap on previewable file size: **5 MB**. Above that → "File too large to preview" + share.
- **Text wrap is ON by default.** No horizontal scrolling.
- **Diff view** is deferred to v1.1 (will appear as a Code/Diff tab toggle in the header toolbar).

**Select-to-quote:**
- User drags finger to select text.
- Native iOS selection handles + standard menu appear: `Copy  |  Reference in chat  |  Look Up`.
- Tap **Reference in chat** → modal closes, composer in the underlying chat now contains the selected text wrapped in a `> ` Markdown blockquote, cursor positioned just below ready to type.

### 3.10 Composer & image attachments

- 2-row text field placeholder: "Ask Pi…"
- Bottom-left: `+` → camera / photo library picker (**images only for v1**).
- Bottom-right: model picker pill + send button.
- **Model picker pill** tap → bottom sheet listing models reported by Pi via `get_available_models`, current ticked. Selecting buffers `set_model` to be applied with the next `prompt` (not eagerly — avoids spawning a Pi RPC child just to set model). See §5.6.
- During streaming: `[+] [model ▾] [stop ■] [send ↑]` with stop/send side-by-side as described in §3.6.

Image attachment pipeline (matches consumer chat sites like ChatGPT and Claude.ai):

1. Use SwiftUI `PhotosPicker(selection:, matching: .images, preferredItemEncoding: .compatible)`. iOS automatically converts HEIC → JPEG. Native iOS screenshots come through as PNG. **HEIC, RAW, ProRAW never reach our code.**
2. On selection, run client-side **resize-to-fit** until raw bytes ≤ **2.5 MB**:
   - If `data.count <= 2.5 MB` → done.
   - Decode → `UIImage`. Compute scale `s = sqrt(2.5MB / data.count)`.
   - Resize to `(originalSize × s)` preserving aspect ratio.
   - Re-encode (JPEG quality 0.85 if source was JPEG; PNG if source was PNG).
   - If still > 2.5 MB → drop JPEG quality by 0.05, retry. Hard upper bound: 5 iterations.
   - If still > 2.5 MB after 5 iterations → error toast: *"Couldn't shrink this image enough. Try a different photo."* (Practically never triggers for normal photo-library content.)
3. The 2.5 MB raw cap leaves ~3.3 MB base64 + ~600 KB headroom for the rest of the prompt JSON inside the 4 MB app-frame cap (see §5.5).
4. **Single image per message in v1.** Multiple-image support deferred to v1.1.
5. **No original-quality opt-out in v1.** Power users who need full resolution use AirDrop / Files to the Mac directly.

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
- Lean by default: just `● paired devices: 1` and `● sessions reachable: 12`.

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
│   • plain ws://             │  ws://  │   • spawns + supervises daemon               │
│   • CryptoKit X25519/HKDF   │←───────→│                                              │
│     /ChaChaPoly             │ AEAD    │   radius-daemon  (Node)                      │
│   • Keychain: device keys   │ envelope│   • mDNS responder · WebSocket server        │
│                             │         │   • pairing handshake (node:crypto)          │
│                             │         │   • project / session enum                   │
│                             │         │   • Pi-RPC supervisor (LF-strict stdio)      │
│                             │         │   • SessionAttacher (unified open_session)   │
│                             │         │   • LiveStateStore (in-memory run snapshot)  │
│                             │         │   • event multiplexer                        │
│                             │         │           ↓ spawn per session (state machine)│
│                             │         │       pi --mode rpc --session <path>         │
│                             │         │       (loads project ./.pi/ extensions etc.) │
│                             │         │           ↓ reads/writes                     │
│                             │         │       ~/.pi/agent/sessions/…jsonl            │
└─────────────────────────────┘         └──────────────────────────────────────────────┘
```

### 5.2 Transport: plain WebSocket + AEAD envelope (CryptoKit / node:crypto)

**Decision: plain `ws://`, no TLS at the transport layer.** All security comes from a per-frame AEAD envelope above the WS layer using **X25519 + HKDF + ChaChaPoly**.

This matches what Paseo actually ships (see `docs/superpowers/research/2026-06-10-paseo-tls-handling-findings.md`): their daemon uses `createHTTPServer`, not HTTPS, and their mobile app has no `URLSessionDelegate` for custom trust. Self-signed `wss://` on iOS requires either a `URLSessionDelegate` trust-pinning dance or ATS exceptions — neither is needed for our security goals.

**Why X25519 + HKDF + ChaChaPoly instead of NaCl box (XSalsa20-Poly1305):**
- Both sides have native implementations with **zero third-party dependencies**:
  - iOS: **CryptoKit** ships `Curve25519.KeyAgreement` (X25519), `HKDF<SHA256>`, and `ChaChaPoly`.
  - Node: built-in `crypto` module ships `generateKeyPairSync('x25519')`, `diffieHellman({ ... })`, `hkdfSync`, and `createCipheriv('chacha20-poly1305')`.
- ChaChaPoly is a **proper AEAD with associated data**, letting us bind clear frame headers (frame type, sender pubkey) into the authentication tag. NaCl box has no AAD parameter.
- HKDF lets us derive **per-connection app-frame keys** from both client and server fresh nonces, preventing replay of captured client traffic — the fundamental gap in v2's NaCl-box-with-long-term-K_session design.
- Both primitives have **published RFC test vectors** (RFC 7748 X25519, RFC 5869 HKDF, RFC 8439 ChaChaPoly) — useful for interop testing across Swift and Node.

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

`NSAllowsLocalNetworking` is the dedicated ATS exception for LAN-targeted plain HTTP/WS connections — it does not weaken ATS for the public internet.

### 5.3 Discovery: Bonjour + IP candidate fallback

**Primary discovery**: `radius-daemon` registers `_radius._tcp` via mDNS while the server is on. Service TXT record carries:

| Key | Value | Notes |
|---|---|---|
| `v` | `1` | Protocol version |
| `id` | `<base64url(SHA-256(srvPub))>` (43 chars) | Stable server identity. Single canonical encoding. |
| `name` | UTF-8 display name, **byte-capped at 180 bytes** | DNS-SD per-string limit. Daemon truncates with ellipsis if longer. |

iOS uses `NWBrowser` for `_radius._tcp`, prompts the user for Local Network permission on first browse.

**Fallback paths** for networks that block mDNS (hotel WiFi with client isolation, some corp networks, VPN intersections):

1. **QR encodes IP candidates** alongside Bonjour name (see §5.4). On first pairing, phone learns up to 3 reachable IPs of the Mac. These are stored alongside the server identity in iOS Keychain.
2. **Manual IP entry**: pairing screen has "Can't find your Mac?" affordance → user types the Mac's IP. Mac's preferences window has a prominent "Show your Mac's IP" panel.
3. **Stable identity over rotating IPs**: phone always cross-references the connected daemon's `serverId` (= base64url SHA-256 of srvPub) against the stored fingerprint. The Mac's hostname can change; its `serverId` does not (unless the user regenerates the keypair).

### 5.4 Pairing protocol & cryptographic handshake

**Identity model:**
- **Mac**: one persistent X25519 keypair `(srvPub, srvSk)`, stored in `~/Library/Application Support/Radius/identity.json` with `0600` perms. Atomic write (tmp file + `rename(2)` + `fsync`). **Not** in macOS Keychain — avoids Keychain-ACL friction.
- **Phone**: one persistent X25519 keypair `(devicePub, deviceSk)`, stored in iOS Keychain with `kSecAttrAccessibleAfterFirstUnlock`.
- Daemon stores a JSON allowlist `~/Library/Application Support/Radius/allowlist.json` (also atomic + `0600`):
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
  "fp": "<colon-grouped hex render of SHA-256(srvPub) — display only>",
  "tok": "<base64url 32B one-time pairing token>",
  "exp": 1717958700,
  "relay": null
}
```

- `relay` is null in v1; populated in Radius Relay (v2).
- `ips` is the deduplicated list of non-loopback IPv4/IPv6 the Mac sees on its active interfaces at QR-generation time.
- `tok` is single-use, stored daemon-side **as a hash** (SHA-256, hex), never the raw token. Consumed atomically on first successful pairing.
- `fp` is **display-only** for human verification (e.g. on the phone post-scan). The canonical `serverId` is `base64url(SHA-256(srvPub))`, derived independently — `fp` is the same bytes rendered for eyeballs.

#### 5.4.1 Frame format

Every Radius frame on the wire is a binary WebSocket message:

```
┌─ 1B frameType ─┬─ 32B senderPub ─┬─ 12B nonce ─┬─ ciphertext+tag ─┐
└────────────────┴─────────────────┴─────────────┴──────────────────┘
```

- `frameType`:
  - `0x01` `pair_hello` — phone → daemon, pairing
  - `0x02` `pair_welcome` — daemon → phone, pairing
  - `0x03` `auth_hello` — phone → daemon, reconnect
  - `0x04` `auth_welcome` — daemon → phone, reconnect
  - `0x05` `app` — bidirectional, application messages
- `senderPub`: 32B X25519 public key. For `pair_hello`, the phone's ephemeral pubkey. For `auth_hello` and `app`, the phone's persistent `devicePub`. For server→client frames, `srvPub`. **Always in the clear** so the receiver can compute the shared key.
- `nonce`: 12 bytes. **Structure depends on frame type:**
  - **Handshake frames (`0x01`-`0x04`)**: 12 bytes of cryptographic random per frame. The nonce also acts as HKDF salt for that frame's one-time key (see §5.4.2). Replay detection: daemon maintains a bounded LRU of recently seen handshake nonces (last 256 per sender pubkey) and rejects duplicates.
  - **App frames (`0x05`)**: `4B random || 8B counter (big-endian)`. Per-direction monotonic counter starting at 0 for the connection. Receiver maintains one `lastCounter` per direction *per AEAD key* (so `K_app_c2s` and `K_app_s2c` track independently). **The counter advances only after the AEAD tag verifies** — a forged high-counter frame must not desynchronise legitimate traffic.
- `ciphertext+tag`: ChaChaPoly output = ciphertext bytes || 16B Poly1305 tag, concatenated. **AAD = `frameType || senderPub`** (33 bytes), binding the clear header into the Poly1305 tag.
- Plaintext is UTF-8 JSON.

#### 5.4.2 Key schedule

All keys are 32 bytes, derived via HKDF-SHA256 (RFC 5869).

**Handshake-frame keys are derived per-frame** using that frame's clear 12B random nonce as HKDF salt. Each handshake frame is encrypted under a one-time key. Cross-connection replay is impossible because each frame's key differs.

**App-frame keys are derived per-connection** from both fresh challenges. Within a connection, the per-direction monotonic counter guarantees nonce uniqueness under the fixed app key.

| Key | Used by | IKM | Salt | Info |
|---|---|---|---|---|
| `K_pair_c2s` | `pair_hello` only | X25519(ephSk, srvPub) | this frame's 12B nonce | `"radius-v1-pair-c2s"` |
| `K_pair_s2c` | `pair_welcome` only | X25519(ephSk, srvPub) | this frame's 12B nonce | `"radius-v1-pair-s2c"` |
| `K_auth_c2s` | `auth_hello` only | X25519(deviceSk, srvPub) | this frame's 12B nonce | `"radius-v1-auth-c2s"` |
| `K_auth_s2c` | `auth_welcome` only | X25519(deviceSk, srvPub) | this frame's 12B nonce | `"radius-v1-auth-s2c"` |
| `K_app_c2s` | `app` (client → server) | X25519(deviceSk, srvPub) | `clientChallenge \|\| serverChallenge` | `"radius-v1-app-c2s"` |
| `K_app_s2c` | `app` (server → client) | X25519(deviceSk, srvPub) | `clientChallenge \|\| serverChallenge` | `"radius-v1-app-s2c"` |

**Why this schedule defeats the two crypto bugs caught in v2 review:**
- **Bidirectional-key nonce collision (bug 1)**: every key is now one-direction-only. `K_pair_c2s` ≠ `K_pair_s2c` because their `info` strings differ; same for the auth and app pairs. No two parties ever encrypt under the same key.
- **Cross-connection server-side replay (bug 2)**: app keys depend on both `clientChallenge` and the daemon's *fresh* `serverChallenge`. A replayed `auth_hello` causes the daemon to generate a new `serverChallenge`, producing a different `K_app_c2s` than the original session — captured client app frames won't decrypt under the new key.
- **Long-term `K_premaster` reuse across `K_auth_*` connections** (would have been a third bug): handshake keys are now per-frame because each frame's clear 12B random nonce is the HKDF salt. Even though `K_premaster` is long-term, the derived `K_auth_*` is a one-time key per frame. Nonce reuse under the same key is impossible: same nonce → same key, but it's also the AEAD nonce, and the receiver's LRU rejects the duplicate before decryption.

**Implementation notes (Swift / Node interop):**
- **IKM** is always the raw 32-byte X25519 shared secret. In CryptoKit, use `SharedSecret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: <salt>, sharedInfo: <info>, outputByteCount: 32)` — this performs HKDF-Extract+Expand on the raw secret as IKM. In Node, extract raw bytes via `crypto.diffieHellman({ privateKey, publicKey })` (Buffer of 32 bytes) and pass to `crypto.hkdfSync('sha256', ikm, salt, info, 32)`.
- **Never feed a previously derived `K_*` as IKM** for another HKDF call. IKM is always the raw X25519 output.
- **X25519 sanity check (RFC 7748 §6.1, §7)**: after every `X25519(...)`, abort with `auth_failure` if the 32-byte output is all zero. Validate that every received public key is exactly 32 bytes. CryptoKit's `Curve25519.KeyAgreement.PublicKey(rawRepresentation: Data)` enforces the length; Node code must check explicitly.
- **Empty / absent salt** in HKDF defaults to `HashLen` zero bytes (RFC 5869 §3.1). We never use empty salt in v3 — every key derivation includes either a frame nonce or paired challenges as salt.

#### 5.4.3 Pairing sequence (first time)

1. Phone generates ephemeral `(ephPub, ephSk)`.
2. Phone generates fresh 12B random `nonce_h`.
3. Phone derives `K_pair_c2s = HKDF(X25519(ephSk, srvPub), salt=nonce_h, info="radius-v1-pair-c2s", L=32)`. Aborts if the X25519 result is all zero.
4. Phone sends `pair_hello` (type `0x01`, sender = `ephPub`, nonce = `nonce_h`, AAD = `0x01 || ephPub`):
   ```json
   { "v": 1, "tok": "<token from QR>", "devicePub": "<phone's persistent pubkey>", "deviceName": "Martin's iPhone" }
   ```
5. Daemon extracts `nonce_h` from the clear header, computes `K_pair_c2s` identically (aborting on all-zero X25519), decrypts. Verifies:
   - `v == 1`
   - `SHA-256(tok)` matches an unconsumed, unexpired entry in `pairings.pending`
   - `devicePub` is well-formed (exactly 32 bytes; non-zero X25519 shared secret with `srvSk`) and not already in allowlist
   - AAD authentication passes (header wasn't tampered)
   - `nonce_h` is not in the recent-nonces LRU for sender pubkey `ephPub`
6. Daemon atomically: consumes `tok`, appends `{ devicePub, deviceName, pairedAt: now }` to allowlist, fsyncs.
7. Daemon generates fresh 12B random `nonce_w`.
8. Daemon derives `K_pair_s2c = HKDF(X25519(srvSk, ephPub), salt=nonce_w, info="radius-v1-pair-s2c", L=32)`.
9. Daemon sends `pair_welcome` (type `0x02`, sender = `srvPub`, nonce = `nonce_w`, AAD = `0x02 || srvPub`):
   ```json
   { "v": 1, "serverId": "<base64url(SHA-256(srvPub))>", "serverName": "Martin's MacBook Pro" }
   ```
10. Phone decrypts under its computed `K_pair_s2c`. Stores `(serverId, srvPub, host, port, ips, name)` in iOS Keychain. Discards `(ephPub, ephSk)`.

#### 5.4.4 Reconnect sequence (subsequent connections)

1. Phone WS-connects to the daemon.
2. Phone computes `K_premaster = X25519(deviceSk, srvPub)`. Aborts if all-zero.
3. Phone generates `clientChallenge` (32B random) and fresh 12B random `nonce_ah`.
4. Phone derives `K_auth_c2s = HKDF(K_premaster, salt=nonce_ah, info="radius-v1-auth-c2s", L=32)`.
5. Phone sends `auth_hello` (type `0x03`, sender = `devicePub`, nonce = `nonce_ah`, AAD = `0x03 || devicePub`):
   ```json
   { "v": 1, "protocolVersion": 1, "clientChallenge": "<base64url 32B>" }
   ```
6. Daemon extracts `nonce_ah`, computes `K_premaster` (aborting on all-zero) and `K_auth_c2s` identically, decrypts. Verifies `devicePub ∈ allowlist`; `nonce_ah` not in recent-nonces LRU for `devicePub`.
7. Daemon generates `serverChallenge` (32B random) and fresh 12B random `nonce_aw`.
8. Daemon derives:
   - `K_auth_s2c = HKDF(K_premaster, salt=nonce_aw, info="radius-v1-auth-s2c", L=32)`
   - `K_app_c2s = HKDF(K_premaster, salt=clientChallenge || serverChallenge, info="radius-v1-app-c2s", L=32)`
   - `K_app_s2c = HKDF(K_premaster, salt=clientChallenge || serverChallenge, info="radius-v1-app-s2c", L=32)`
9. Daemon sends `auth_welcome` (type `0x04`, sender = `srvPub`, nonce = `nonce_aw`, AAD = `0x04 || srvPub`):
   ```json
   { "v": 1, "protocolVersion": 1, "serverChallenge": "<base64url 32B>", "sessionId": "<uuid>" }
   ```
10. Phone decrypts under its computed `K_auth_s2c`. Computes its own `K_app_c2s` and `K_app_s2c` identically.
11. All subsequent traffic is `app` frames (type `0x05`) encrypted under `K_app_c2s` (phone → daemon) or `K_app_s2c` (daemon → phone), with per-direction nonce counters starting at 0.

#### 5.4.5 Replay & integrity protection

- **Cross-connection app-frame replay** is defeated by per-connection ephemeral app keys. Daemon's fresh `serverChallenge` makes `K_app_c2s` different every reconnect; captured client app frames won't decrypt under the new key.
- **Within-connection app-frame replay** is defeated by per-direction monotonic counters in the nonce. Receiver tracks `lastCounter[direction]` *per AEAD key* and rejects equal-or-lower values. **The counter advances only after the AEAD tag verifies** — forged high-counter frames don't desynchronise legitimate traffic.
- **Handshake-frame replay** is defeated by per-frame ephemeral keys (each handshake frame uses a unique 12B random as both HKDF salt and AEAD nonce) plus a bounded LRU of recently seen handshake nonces per sender pubkey (last 256 entries; older entries fall out). Replayed `pair_hello` is also caught by single-use token consumption.
- **Header tampering** is defeated by AAD over `frameType || senderPub` (33 bytes) in every frame's Poly1305 tag.
- **Counter wrap** is fatal for app keys: receiver explicitly rejects counter wraparound and the connection must be re-handshaken.
- **Pairing token replay** is defeated by atomic single-use consumption + SHA-256-hashed storage server-side.
- **X25519 small-subgroup / all-zero shared secret** is rejected at the source (RFC 7748 §7) — see §5.4.2 implementation notes.
- **Long-term `K_premaster` exposure** would compromise past sessions (no forward secrecy in v1 — that would require ephemeral keys on every reconnect, which complicates UX). v2 may add this if threat model expands. Listed as v1 non-goal in §8.

#### 5.4.6 ChaChaPoly byte layout (Swift / Node)

The `ciphertext+tag` field in §5.4.1 is the concatenation of ChaChaPoly's ciphertext output and its 16-byte Poly1305 tag.

- **Swift (CryptoKit)**: call `ChaChaPoly.seal(plaintext, using: SymmetricKey(data: keyBytes), nonce: ChaChaPoly.Nonce(data: nonceBytes), authenticating: aad)`, then transmit `sealedBox.ciphertext + sealedBox.tag`. **Do NOT** transmit `sealedBox.combined` directly — its leading 12 bytes are the nonce, which we already carry in the frame header. On receive, construct via `ChaChaPoly.SealedBox(nonce: nonceFromHeader, ciphertext: <bytes>, tag: <last 16 bytes>)` then `ChaChaPoly.open(box, using: key, authenticating: aad)`.
- **Node (`crypto`)**: create with `createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })`, set AAD via `cipher.setAAD(aad)`, encrypt with `update` + `final`, then append `cipher.getAuthTag()` (16 bytes) after the ciphertext. Decrypt with `createDecipheriv` + `setAAD` + `setAuthTag` + `update` + `final`.
- `ChaChaPoly.Nonce` in CryptoKit is the **IETF 12-byte variant** (RFC 8439), matching our 12-byte nonce field.
- The Poly1305 tag covers **both AAD and ciphertext** per RFC 8439 §2.8; we rely on this rather than authenticating the clear header separately.

Both sides must produce byte-identical output for RFC 8439 test vectors. See §11 conformance fixtures.

### 5.5 WebSocket protocol envelope

Above the framing in §5.4, the **application payload** (decrypted plaintext) is JSON. Application frames (`frameType = 0x05`) carry one of these shapes:

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
{
  "id": "<uuid>",
  "type": "response",
  "ok": false,
  "error": { "code": "controller_locked", "message": "Steer requires being the active controller", "details": { ... } }
}
```

#### Event (server → client, server-initiated)

```json
{
  "id": "<server-event-uuid>",
  "type": "event",
  "topic": "session_event",
  "sessionPath": "...",
  "data": { ... }
}
```

#### Heartbeat

WebSocket ping/pong handles transport liveness. No application-layer heartbeat needed.

#### Close codes

| Code | Meaning |
|---|---|
| 1000 | Normal close |
| 4001 | Auth failure (unknown devicePub, bad MAC, replay, counter wrap) |
| 4002 | Protocol version unsupported |
| 4003 | Frame malformed |
| 4004 | Pairing token invalid / expired / consumed |
| 4900 | Daemon shutting down |

#### Limits

- **Max app-frame decrypted JSON: 4 MB.** Covers an iPhone photo after client-side compression (§3.10) plus the rest of a prompt JSON, in a single frame. Files above 4 MB use chunked reads (see §5.7).
- WebSocket transport frame size: same — daemon and client refuse oversize frames before decryption.

### 5.6 Radius ↔ Pi RPC command mapping

Pi's RPC interface (`pi --mode rpc`) uses **newline-delimited JSON over stdio with strict LF framing**. The Pi docs explicitly warn against Node `readline` (it splits on Unicode line separators). The daemon must implement its own LF-only splitter.

#### 5.6.1 Pi RPC child lifecycle state machine

Each Pi session has exactly one daemon-managed lifecycle:

```
              ┌───────────────────────────────────────┐
              │                                        │
              ▼                                        │
       ┌──────────────┐                                │
       │ idle_no_child│                                │
       └──────┬───────┘                                │
              │ prompt                                 │
              ▼                                        │
       ┌──────────────┐                                │
       │   starting   │  (spawn pi --mode rpc)         │
       └──────┬───────┘                                │
              │ ready                                  │
              ▼                                        │
       ┌──────────────┐    prompt / steer /            │
       │   running    │    follow_up (lease holder)    │
       │  (controller │◀───┐                           │
       │   = device X)│    │                           │
       └──────┬───────┘    │                           │
              │ run_completed                          │
              ▼                                        │
       ┌──────────────┐                                │
       │   grace      │  (60s timer; new prompt        │
       │              │   transitions back to running) │
       └──────┬───────┘                                │
              │ timeout                                │
              ▼                                        │
       ┌──────────────┐                                │
       │  stopping    │  (clean exit)                  │
       └──────┬───────┘                                │
              │                                        │
              └────────────────────────────────────────┘

     abort from any state → cancels current run, returns to grace
     pi child crash → emit rpc_child_exited event, → idle_no_child
```

**Transitions and command permissions:**

| State | `prompt` | `steer` | `follow_up` | `abort` | `set_model` | `open_session` |
|---|---|---|---|---|---|---|
| `idle_no_child` | ✅ spawns → `starting` | ❌ `controller_locked` (no run) | ❌ `controller_locked` (no run) | no-op (✅) | buffers (lazy) | ✅ |
| `starting` | queues for `running` | ❌ | ❌ | terminates | buffers (lazy) | ✅ |
| `running` (you = controller) | queues | ✅ | ✅ | ✅ | ✅ | ✅ |
| `running` (you ≠ controller) | ❌ `controller_locked` | ❌ `controller_locked` | ❌ `controller_locked` | ✅ (emergency stop) | ✅ | ✅ |
| `grace` | re-enters `running`, acquires lease | ❌ (would re-enter; require explicit `prompt`) | ❌ | no-op | buffers (lazy) | ✅ |
| `stopping` | rejected until exit complete | ❌ | ❌ | no-op | rejected | ✅ |

**Lease lifetime:**
- Acquired on `prompt` that transitions `idle_no_child → starting` or re-enters `running` from `grace`.
- Held by the device that issued the `prompt`.
- Released on: device's WS disconnect followed by 60s grace, OR `abort` from controller, OR child process exit.
- On lease release, daemon broadcasts `controller_lease_changed` event with new `activeControllerDevicePub` (null if released without successor).

#### 5.6.2 Command mapping table

| Radius method | Pi RPC counterpart | Permission | Notes |
|---|---|---|---|
| `list_projects` | (synthetic; daemon walks `~/.pi/agent/sessions/`) | any paired | Returns `{ cwd, displayName, sessionCount, lastTouched }[]`. |
| `list_sessions` | (synthetic; daemon walks JSONLs for a CWD) | any paired | Returns `{ sessions: [{ path, title, leafEntryId, lastTouched, model }] }`. |
| **`open_session`** | (daemon-local; unified attach + delta + snapshot) | any paired | **See §5.6.3 — the unified resume primitive.** |
| `close_session` | (daemon-local; unsubscribes) | any paired | If you were lease holder, lease enters 60s grace. |
| `prompt` | Pi `prompt` | per state machine | Spawns child if `idle_no_child`; acquires lease. |
| `steer` | Pi `steer` | controller only | Errors `controller_locked` otherwise. |
| `follow_up` | Pi `follow_up` | controller only | Errors `controller_locked` otherwise. |
| `abort` | Pi `abort` | any subscriber | Emergency stop. Logs `Aborted by <deviceName>`. |
| `set_model` | Pi `set_model` (buffered) | any paired | **Lazy:** buffered until next `prompt`. If no child alive, just stored. If running, applied immediately. |
| `get_available_models` | Pi `get_available_models` | any paired | Cached 5 min per project. If no child alive, daemon spawns a short-lived helper invocation (NOT a session child). |
| `extension_ui_response` | Pi `extension_ui_response` | any paired | Phone answers a pending UI request. |
| `read_file` | (daemon-local FS) | any paired | For files ≤ 4 MB. Returns base64 bytes + sha256 + mediaType. Sandboxed to session CWD. |
| `read_file_chunk` | (daemon-local FS) | any paired | For files > 4 MB up to 5 MB hard cap. `{ path, offset, length ≤ 1MB }`. Returns chunk + sha256 + isLast. |
| `list_files` | (daemon-local FS) | any paired | Paginated, sandboxed, symlinks-outside-CWD refused. |
| — | events forwarded as `session_event` | (server-initiated) | See §5.6.4 event taxonomy. |

#### 5.6.3 `open_session` — the unified resume primitive

`open_session` is the **single attach point** for any session-level work. It carries identity, disk catch-up, and live state in one round trip.

**Request:**

```json
{
  "id": "<uuid>",
  "type": "request",
  "method": "open_session",
  "params": {
    "sessionPath": "/full/path/to/session.jsonl",
    "lastEntryId": "8charid",     // optional: phone's last seen committed entry
    "leafEntryId": "8charid",     // optional: phone's view's current leaf
    "branchPathHash": "..."       // optional: hash of phone's branch path
  }
}
```

**Response:**

```json
{
  "id": "<uuid>",
  "type": "response",
  "ok": true,
  "result": {
    "sessionId": "<uuid>",
    "leafEntryId": "8charid",
    "branchPath": ["8charid", "8charid", ...],
    "model": "...",

    "delta": {
      "entries": [ /* Pi session entries since lastEntryId in current branch */ ],
      "newLeafEntryId": "8charid",
      "fullReload": false
    },

    "liveState": {
      "runStatus": "idle" | "starting" | "streaming" | "blocked_on_tool" | "blocked_on_ui" | "grace",
      "activeControllerDevicePub": "<base64url 32B or null>",
      "activeControllerDeviceName": "Martin's iPhone | null",
      "currentAssistantPartial": "<text emitted since last committed entry> | null",
      "activeToolCall": {
        "callId": "...",
        "toolName": "read | edit | write | bash | grep | find | ls | ...",
        "args": { ... },
        "partialResult": "<accumulated stdout/partial output>",
        "startedAt": "<iso timestamp>"
      } | null,
      "queue": [
        { "kind": "steer" | "follow_up", "text": "...", "fromDeviceName": "...", "queuedAt": "..." }
      ],
      "pendingExtensionUiRequest": {
        "requestId": "...",
        "kind": "select | confirm | input | editor",
        "prompt": "...",
        "options": [ ... ] | null,
        "timeoutAt": "<iso timestamp>"
      } | null
    }
  }
}
```

**Branch-aware delta semantics:**

- If `lastEntryId` is on the current active branch path AND `branchPathHash` matches → `delta.entries` is the append-only continuation, `delta.fullReload = false`.
- If `lastEntryId` exists but is on a sibling branch (Pi `/tree` or `/fork` happened) → `delta.fullReload = true` and `entries` is the full current active branch. Phone shows soft banner: *"This chat changed on the Mac — refreshed view."*
- If `lastEntryId` is not found at all (compaction, manual edit, file rewritten) → same `fullReload: true` path with the soft banner.
- If `lastEntryId` is omitted → first-time open, full branch returned, no banner.

**Why one primitive:**
- Single module (`SessionAttacher`) on the daemon owns the entire resume flow.
- Single call (`openSession()`) on the phone does the entire "I'm here, give me everything" handshake.
- Same code path for first-time-open and reconnect; just different inputs.
- No separate `get_live_session_state` RPC, no `subscription_lagged` recovery dance. If the phone misses live events, it just calls `open_session` again with its `lastEntryId`.

**Comparison to Paseo's pattern:** Paseo uses `fetch_workspaces` + `fetch_agents` + `fetch_agent_timeline` + `agent_state` event subscription — four moving parts for what we collapse into one. Paseo also accepts losing partial-stream content held in their `AgentStreamCoalescer` 60ms buffer; we explicitly carry `currentAssistantPartial` and `activeToolCall.partialResult` from the daemon's in-memory `LiveStateStore`. See `docs/superpowers/research/2026-06-10-paseo-live-state-recovery-findings.md` for the comparative analysis.

#### 5.6.4 Session events

After `open_session`, the daemon streams live updates as `session_event` events. Event `data.kind`:

| Kind | Meaning |
|---|---|
| `assistant_token_delta` | Partial assistant text (the daemon also accumulates this into `LiveStateStore.currentAssistantPartial`) |
| `entry_committed` | A new entry landed in the JSONL (assistant message complete, tool call complete, etc.) |
| `tool_started` | A tool execution began (also written to `LiveStateStore.activeToolCall`) |
| `tool_partial_output` | Tool emitted partial output |
| `tool_completed` | Tool finished (will be followed by `entry_committed`) |
| `extension_ui_request` | Extension asked for UI input (also stored in `LiveStateStore.pendingExtensionUiRequest`) |
| `extension_ui_cancelled` | Pending UI request was cancelled / timed out |
| `queue_changed` | The steer/follow-up queue contents changed |
| `controller_lease_changed` | Active controller transitioned |
| `model_changed` | `set_model` took effect |
| `run_completed` | Run reached `grace` state |
| `run_aborted` | Run aborted (includes `abortedBy: deviceName`) |
| `rpc_child_exited` | Pi child crashed/exited unexpectedly |
| `tree_changed` | Pi `/tree`/`/fork`/`/clone` operation changed branch structure → phone should call `open_session` again to resync |

Phones may receive events for sessions they're not actively viewing; UI filters by `sessionPath`.

### 5.7 Chunked file reads

For files > 4 MB up to the 5 MB hard cap:

**Request:**
```json
{ "id": "<uuid>", "type": "request", "method": "read_file_chunk",
  "params": { "path": "...", "offset": 0, "length": 1048576 } }
```

**Response:**
```json
{ "id": "<uuid>", "type": "response", "ok": true,
  "result": {
    "offset": 0,
    "length": 1048576,
    "bytes": "<base64>",
    "sha256OfChunk": "<hex>",
    "isLast": false,
    "totalSize": 4823104
  } }
```

- Each chunk's `length` ≤ 1 MB. Daemon never returns more.
- Phone repeatedly calls with incrementing `offset`. Stops when `isLast: true`.
- Phone may cancel by simply not requesting further chunks.
- `sha256OfChunk` lets the phone detect torn reads if the file changed mid-transfer (rare but possible). If a chunk's hash doesn't match a re-fetched chunk for the same offset/length, the phone discards its accumulated buffer and re-opens.
- Total file > 5 MB → `read_file_chunk` returns error `file_too_large` with `totalSize` for UI to show.

### 5.8 Operational concerns

#### Daemon crash recovery
- Daemon writes a PID file at `~/Library/Application Support/Radius/daemon.pid`. On startup, refuses to start if a fresh PID is already running. Stale PID (no live process) is overwritten.
- On crash mid-stream: phone's WS dies. Radius for Mac supervisor restarts the daemon (up to 3 restarts in 60s; after that, menubar shows failed state).
- Orphaned Pi RPC children from a crashed daemon are detected on startup by scanning for `pi` processes whose parent is PID 1 with `--mode rpc` in argv. They receive SIGTERM (graceful, lets Pi flush the JSONL), then SIGKILL after 5s.

#### Pi RPC child crash
- Daemon detects via stdio close. Emits `session_event` with `kind: "rpc_child_exited", code, signal`. Transitions session to `idle_no_child`. Phone shows a banner: *"Pi exited unexpectedly. The chat is safe — tap to retry."*

#### Phone disconnects mid-stream
- Daemon **keeps the Pi RPC child running** (the run might be doing work the user wants finished).
- `LiveStateStore` continues to accumulate `currentAssistantPartial`, `activeToolCall.partialResult`, queue, and pending UI requests as events arrive from Pi.
- If lease holder doesn't reconnect within 60s of disconnect, lease releases (`controller_lease_changed` to remaining subscribers, if any).
- On reconnect: phone calls `open_session` → gets full state in one response (see §5.6.3).

#### Mac sleep / wake
- **On sleep**: WS connections die. Bonjour service deregisters. macOS may suspend the daemon process and any Pi RPC children (depending on Power Nap settings — daemon does not control this).
- **Active runs during sleep**: Pi RPC child is suspended along with the daemon. LLM API calls in flight will likely time out from the server side; Pi handles this (retry / error in its own runtime).
- **On wake**: daemon re-registers Bonjour, accepts new connections. Phone detects via `NWPathMonitor` (network reachability change) and reconnects with backoff: 0s / 1s / 5s / 30s / 5min. Menubar shows transient *"Reconnecting…"* briefly on wake.

#### Network change (IP rotation, VPN toggle)
- iOS notifies via `NWPathMonitor`. Phone re-discovers via Bonjour first, then tries stored IP candidates, then prompts user.
- `serverId` cross-check on every connect ensures the phone doesn't accidentally connect to a different Mac that happens to share an IP.

### 5.9 iOS Local Network permission UX

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

**If denied**: Radius shows a clear recovery screen explaining the user must enable Local Network in Settings → Radius. No retry-prompt loop (iOS doesn't allow re-prompting).

---

## 6. Concurrency posture, active controller, and trust model

### 6.1 Single-controller posture (vs Pi TUI)

**Design philosophy**: Radius treats itself as the sole writer of any session it touches. Internally, the daemon enforces single in-flight Pi RPC per session via the §5.6.1 state machine.

**Pi's reality check**: Pi has no native session locking. `SessionManager` does plain `appendFileSync` and `openSync(..., "w")` with no `flock`, no external-change watcher, no claim file. (See `docs/superpowers/research/2026-06-08-pi-native-session-concurrency-findings.md` for cited evidence.) **External writers (the Mac TUI, another Pi process started directly by the user) are completely outside Radius's coordination model.**

**The risk, framed honestly**: this is a known limitation. The product target is the user who has a TUI on their Mac that they're not actively using when they're on their phone (e.g., lying in bed). If they keep a TUI on the same session running while typing on Radius, the two writers will race and either may corrupt the JSONL's branch structure.

**The long-term vision**: a future **Radius Desktop** chat client replaces the TUI for shared sessions. When both ends are Radius-controlled, the daemon arbitrates writes across desktop + mobile via the same §5.6.1 state machine, fully eliminating the corruption risk. v1 ships mobile + Mac shell first because that's the immediate pain point; the desktop client is a v3 problem after the mobile UX is proven and Radius Relay (v2) ships.

**Paseo precedent**: Paseo ships with the same posture — no session-level lock, single-subscription fan-out per provider session, no coordination with external writers. (Source: `docs/superpowers/research/2026-06-08-paseo-session-concurrency-findings.md`.)

### 6.2 Multi-device active controller (within Radius)

When multiple paired devices subscribe to the same session, the daemon arbitrates with the **active controller lease** described in §5.6.1:

- The device that issues `prompt` (or re-enters running from grace via a new `prompt`) **becomes the controller for that run**.
- `steer` and `follow_up` require being the controller.
- `abort` is available to **any subscriber** as emergency-stop. Non-controller aborts log as `Aborted by <deviceName>` in the transcript.
- Non-controllers see a subtle banner in the chat thread: *"Run started on Martin's iPad — you can watch and stop, but not steer."* Composer is disabled except for the stop button.
- Lease expires 60s after the controller's WS connection drops (no successful reconnect). On expiry, daemon broadcasts `controller_lease_changed` with `activeControllerDevicePub: null` and remaining subscribers' composers re-enable.

No takeover UI in v1 — if you want to take over and the previous controller is gone, just wait 60s. v1.1 may add an explicit "Take over" button.

### 6.3 Trust model — what a paired device can see and do

A paired device has **full access** to Pi sessions and files reachable through any session CWD under this Mac user's account. Specifically:

- Enumerate all projects (any directory containing Pi sessions).
- Read any file under any session CWD via the file viewer (including `.env*`, `.git/config`, source files, etc. — these are *dimmed* in the UI but readable).
- Prompt any session in any project.
- Read all stored model API keys *indirectly* by prompting Pi to do so (just as a Mac terminal user could).

**This is the same trust level as physical access to the unlocked Mac.** The pairing model is: *"By pairing this phone, you are giving it the same level of access to your Pi sessions that you have when sitting at this Mac."*

This is stated explicitly during the pairing UX on the phone (post-scan, pre-confirm):

```
Pair Martin's MacBook Pro?

This phone will be able to:
• See all your Pi chats and projects on this Mac
• Read files in any Pi project on this Mac
• Send prompts to Pi on your behalf

Mac fingerprint: 8a:f2:91:...
```

If the user wants per-project scope, that's a v2 feature (would require a project-scope ACL in the allowlist and Mac UI to set it). For v1, single-trust-level is acceptable for a personal bridge with no user accounts.

### 6.4 Catch-up semantics (recap)

The phone tracks `lastEntryId`, `leafEntryId`, and `branchPathHash` locally. On foreground return or chat reopen, it calls `open_session` (§5.6.3) which returns disk catch-up + live snapshot in one round-trip. See §5.6.3 for full semantics.

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
   - **Hidden-file refusal**: slug must not start with `.`. Stripped if present, fallback used if result is empty.
2. Compute base path: `<adhocRoot>/YYYY-MM-DD/<slug>` where `<adhocRoot>` is configurable (Mac Settings → Sessions; default `~/Documents/Radius/`).
3. **Atomic create**: `mkdir <basepath>`. On `EEXIST`, append `-2`, retry. Continue `-3`, `-4`, ... up to `-99`. If all collide, fall back to `<slug>-<5-char random>`.
4. Spawn Pi RPC for new session JSONL with the new folder as CWD (state machine: `idle_no_child → starting → running`).
5. Pi sees the empty folder; any file ops Pi performs land there.

**iCloud Documents caveat**: if the user has Documents synced to iCloud, `~/Documents/Radius/` is iCloud-synced. This is **fine** — actually a feature (cross-device backup of chat workspaces). Mac Settings → Sessions notes this.

**Folder deletion while session is live**: phone receives a `session_event` with `kind: "cwd_missing"` and the chat thread shows a non-blocking warning banner. The Pi RPC child is allowed to continue but any new file ops will fail.

---

## 8. Out of scope for v1

| Item | Notes |
|---|---|
| WAN / off-LAN access | Deferred to Radius Relay (§9). |
| Push notifications (APNs) | Cut — v1 has no cloud infra. Extension dialogs are foreground-only. |
| Android client | Future. |
| Web client / PWA | Future, possibly never (LAN connectivity from mobile browsers is awkward). |
| Mobile file editing | Deliberate — share to iOS Files for external editors. |
| File create / delete / rename / move from mobile | Deliberate — ask the agent. |
| Diff view in mobile file viewer | v1.1 add-on. |
| Multiple images per message | v1 = single image. v1.1+ may add multi-image. |
| Generic file attachments (non-image) | v1 = images only (matches Pi RPC). |
| In-app delete of ad-hoc chat folders | Use Finder. |
| Multi-Mac onboarding polish | Schema-ready (project picker is sectioned by Mac); v1 optimises for single-Mac flow. |
| Background extension UI | Foreground-only in v1. Buffered server-side, delivered on next foreground via `open_session.liveState.pendingExtensionUiRequest`. |
| App Store distribution | Sideload / TestFlight only for v1. |
| Per-project ACL scope | v1 = full trust per paired device (§6.3). v2 may add scoping. |
| Active-controller takeover UI | v1 = wait 60s for lease expiry. v1.1 may add "Take over" button. |
| Forward secrecy on app frames | v1 = none (long-term `K_premaster` derived per device-server pair). v2 reconsideration as threat model expands. |
| Radius Desktop chat client | v3 problem after mobile + relay prove out. |

---

## 9. v2 — Radius Relay (sketch, deferred)

Single decentralised relay model: the user runs their own relay binary (we ship `radius-relay` they deploy to Fly.io / Railway / a VPS / Cloudflare Tunnel). Configured via Mac Settings → Server → Relay URL.

**Why BYO, not centralised:**
- No trust burden on the project maintainer.
- No ongoing ops cost for the project.
- Strong privacy story: relay forwards ciphertext only (the AEAD envelope is end-to-end).
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

Re-ordered from v1: **validate iOS unknowns early.**

**Step 1: `radius-daemon` protocol spike + CLI test client.**
- mDNS responder, plain WS server, X25519 + HKDF + ChaChaPoly envelope, pairing handshake (with RFC test vectors as conformance fixtures).
- Pi RPC supervisor (LF-strict stdio), state machine (§5.6.1).
- Session enumeration, `SessionAttacher`, `LiveStateStore`.
- Synthetic CLI test client that does the full handshake from the command line and can `prompt` / `open_session` / `read_file_chunk` etc. **No iOS yet.** Tests protocol end-to-end against a real Pi process.

**Step 2: Radius for iOS — thin vertical slice.**
- Pair (QR scan + paste link), connect, send prompt, stream text, abort, reconnect.
- Skeletal home + project picker + chat thread. No file flyout yet. No long-press menu yet.
- **Goal: validate iOS Local Network permission UX, CryptoKit X25519/HKDF/ChaChaPoly interop with Node, NWBrowser reliability, WebSocket lifecycle across backgrounding.** These are the high-risk unknowns.

**Step 3: Radius for Mac — minimal supervisor + menubar.**
- Tray icon, popover with start/stop toggle, pairing QR, paired devices list.
- Spawns and supervises `radius-daemon`.
- Mac preferences window (skeletal — General + Server + Sessions sections).
- Private TestFlight build now possible.

**Step 4: Broaden the iOS UI.**
- Left flyout, ⋯ sort menu, settings.
- Right flyout (recent files + file tree).
- Modal file viewer with markdown rendering + select-to-quote.
- Long-press → fly-out (steer / follow-up).
- Extension UI dialog sheets.
- Streaming tool pills with progressive disclosure.
- Image attachment pipeline (§3.10).

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
- SwiftUI Previews work fine for menubar popover content.
- Standard `LSUIElement = YES` + popover patterns.

### Daemon iteration loop
- Node + `tsx watch` or Bun-based watcher. Standard.

### Crypto test vectors

Step 1 must produce conformance fixtures that both Swift (CryptoKit) and Node (`crypto`) implementations reproduce byte-identically:

- **X25519**: RFC 7748 §6.1 Alice/Bob test vector — fixed private/public keys must yield the documented shared secret. Optionally also RFC 7748 §5.2 one-iteration basepoint vector.
- **HKDF-SHA256**: RFC 5869 Appendix A.1 (with non-empty salt and info) and Appendix A.3 (zero-length salt and info — confirms `crypto.hkdfSync` handles empty inputs identically to CryptoKit, even though v3 itself never uses empty salt/info).
- **ChaCha20-Poly1305 AEAD**: RFC 8439 §2.8.2 encryption vector and Appendix A.5 decryption vector — verifies 12-byte IETF nonce, AAD handling, ciphertext output, and 16-byte tag layout.
- **End-to-end Radius frame**: one fixture per frame type (`pair_hello`, `pair_welcome`, `auth_hello`, `auth_welcome`, `app`) with fixed inputs (random sources stubbed) producing identical wire bytes from both implementations.

---

## 12. References

**Pi internals**
- Pi documentation: installed `@earendil-works/pi-coding-agent` package docs — particularly `rpc.md` (LF framing!), `sessions.md`, `session-format.md`.

**Research reports** (all under `docs/superpowers/research/`)
- [`2026-06-08-pi-native-session-concurrency-findings.md`](../research/2026-06-08-pi-native-session-concurrency-findings.md) — Pi has zero session locking; evidence-backed from `SessionManager` source.
- [`2026-06-08-paseo-session-concurrency-findings.md`](../research/2026-06-08-paseo-session-concurrency-findings.md) — Paseo's concurrency stance.
- [`2026-06-08-paseo-qr-pairing-findings.md`](../research/2026-06-08-paseo-qr-pairing-findings.md) — Paseo's QR pairing flow.
- [`2026-06-10-paseo-tls-handling-findings.md`](../research/2026-06-10-paseo-tls-handling-findings.md) — Paseo uses plain `ws://` + E2EE; validates Radius's transport choice.
- [`2026-06-10-swiftui-iteration-loop-findings.md`](../research/2026-06-10-swiftui-iteration-loop-findings.md) — current state of SwiftUI dev iteration in 2026.
- [`2026-06-10-paseo-live-state-recovery-findings.md`](../research/2026-06-10-paseo-live-state-recovery-findings.md) — Paseo's reconnect/snapshot pattern; informed the unified `open_session` design.

**External**
- Paseo repo: https://github.com/getpaseo/paseo
- Inject: https://github.com/krzysztofzablocki/Inject
- RFC 7748 (X25519): https://www.rfc-editor.org/rfc/rfc7748
- RFC 5869 (HKDF): https://www.rfc-editor.org/rfc/rfc5869
- RFC 8439 (ChaCha20-Poly1305): https://www.rfc-editor.org/rfc/rfc8439
- Brainstorm visual mockups: `.superpowers/brainstorm/` (gitignored).

---

## 13. Changes from v2

For diff-against-v2 readers, the substantive changes are:

**Crypto rewrite (§5.2, §5.4):**
1. Switched from NaCl box (XSalsa20-Poly1305) to **X25519 + HKDF + ChaChaPoly AEAD**. Both sides use platform-native crypto (CryptoKit on iOS, `node:crypto` on Mac) — zero third-party deps.
2. Fixed v2's nonce-reuse bug: per-connection app keys (`K_app_c2s`, `K_app_s2c`) derived from both fresh challenges via HKDF. Each connection gets fresh ChaChaPoly keys, eliminating cross-connection nonce collisions.
3. Fixed v2's server-side replay vulnerability: replaying an old `auth_hello` produces a different `K_app_*` than the original (because the daemon's `serverChallenge` is fresh per connection), so captured app frames won't decrypt.
4. Added AEAD associated data binding: `frameType || senderPub` in the clear is authenticated by the Poly1305 tag.
5. Single canonical `serverId` encoding: `base64url(SHA-256(srvPub))`. `fp` field is display-only.
6. Removed unused `sessionNonceSeed` from v2.
7. **(Applied from crypto-only review)** Split bidirectional handshake keys into c2s/s2c via `info` strings (`K_pair_c2s`/`K_pair_s2c`, `K_auth_c2s`/`K_auth_s2c`) so two parties never encrypt under the same key.
8. **(Applied from crypto-only review)** Handshake-frame keys derived per-frame using the frame's clear 12B random nonce as HKDF salt. This makes each handshake frame use a one-time key, eliminating birthday-collision risk under long-term `K_premaster`.
9. **(Applied from crypto-only review)** Replay counter is now scoped per AEAD key + direction (not per `(frameType, direction)`), and **advanced only after AEAD tag verifies** — forged high-counter frames cannot desynchronise legitimate traffic.
10. **(Applied from crypto-only review)** Added X25519 all-zero output rejection (RFC 7748 §7 small-subgroup defence) at every key-agreement step.
11. **(Applied from crypto-only review)** Added explicit Swift/Node API equivalence notes for HKDF and ChaChaPoly byte layout (§5.4.2, §5.4.6), and RFC-anchored test vector list in §11.

**Payload limits + image handling (§3.10, §5.5, §5.7):**
7. App-frame decrypted payload cap raised: 1 MB → **4 MB**.
8. Image attachment pipeline specified: `PhotosPicker(.compatible)` for HEIC→JPEG, resize-to-fit ≤2.5 MB raw before base64.
9. Chunked file reads (`read_file_chunk`) for files > 4 MB up to 5 MB hard cap.

**Unified `open_session` (§5.6.3):**
10. Replaced v2's split `open_session` + `get_session_delta` + proposed-by-reviewer `get_live_session_state` with a **single `open_session` RPC** that returns identity + disk delta + live snapshot.
11. Dropped `subscription_lagged` event-buffer recovery dance. If phone misses live events, just call `open_session` again.
12. Live snapshot explicitly carries `currentAssistantPartial`, `activeToolCall.partialResult`, `queue`, `pendingExtensionUiRequest` — closing the gap Paseo accepts.
13. Branch-aware delta semantics: phone provides `lastEntryId` + `leafEntryId` + `branchPathHash`; daemon decides continuation vs `fullReload`.

**Pi RPC integration (§5.6):**
14. Explicit Pi RPC child lifecycle state machine: `idle_no_child → starting → running → grace → stopping`. Only `prompt` can spawn a child; `steer`/`follow_up` against idle = typed error.
15. Active controller lease model (§5.6.1, §6.2): lease holder = device that issued the current `prompt`. `steer`/`follow_up` controller-only; `abort` available to any subscriber. 60s grace on disconnect.
16. Corrected Pi tool names: real built-ins are `read`, `edit`, `write`, `bash`, `grep`, `find`, `ls` (v2 invented `read_file`, `str_replace`, `create_file`).

**Trust model & spec hygiene:**
17. Added §6.3 explicit trust model: paired device = full access to Pi sessions and files under the Mac user account. Stated in pairing UX, not buried in docs.
18. Clarified Mac sleep behavior in §5.8: Pi RPC children suspended along with daemon; LLM calls in flight may time out; daemon does not kill children on phone disconnect.
19. Fixed §6 broken date reference (was `2026-06-10`, now correctly `2026-06-08`).
20. Bonjour TXT name field byte-capped at 180 bytes (DNS-SD limit awareness).
21. Hidden-file refusal in slug derivation.
22. Forward-secrecy explicitly listed as v1 non-goal (§8).
