# Pi Bridge / Pi Mobile design review

## TL;DR

Not ready for implementation planning. The product direction is good, but the spec is carrying three unresolved engineering risks as if they were settled: shared-session concurrency is unsafe, the NaCl/WebSocket protocol is not actually specified and the first handshake is partly impossible as written, and the iOS networking/push story is hand-waved. Before planning, fix those: define a safe session ownership model, write the real wire/crypto protocol, and decide whether MVP is foreground/LAN-only or includes the infrastructure needed for background extension dialogs.

## Section A — Decisions

### 1. Pi-only — ✅ ship-as-is

Good scope cut. Do not abstract the daemon around “providers” for v1; Pi RPC already has enough surface area. Keep the bridge protocol Pi-shaped.

### 2. LAN-only MVP — ⚠️ tweak

LAN-only is fine for the core “Mac in the next room” use case. Bonjour-only is not fine as the only success path: mDNS is commonly broken by guest Wi-Fi, hotel networks, VLANs, VPNs, and client isolation. The spec needs a manual/direct fallback: QR/pairing should carry server identity plus one or more IP candidates, and the mobile app needs a “Can’t find your Mac?” flow.

Also: §3.7 promises background push notifications, but §8 defers relay/cloud. Those two are in conflict. APNs requires a provider server path to Apple; an iPhone app suspended in the background will not reliably keep a LAN WebSocket alive. Either cut background extension-dialog notifications from MVP or include a real push provider/relay.

### 3. NaCl box over WSS — ❌ rethink the transport detail, keep NaCl

NaCl box is the right auth/confidentiality layer. “Self-signed WSS used only to satisfy iOS URLSession defaults” (§5.1) is wrong: a self-signed cert does not satisfy URLSession trust by default. You still need ATS/local-network exceptions and/or a `URLSessionDelegate` server-trust override/pinning flow. Apple’s ATS docs and server-trust docs are explicit that URLSession performs normal TLS trust evaluation.

Prefer one of these:

1. **Plain `ws://` + NaCl** for MVP, with `NSAllowsLocalNetworking`, `NSLocalNetworkUsageDescription`, and `NSBonjourServices` configured. Security is from NaCl, not TLS.
2. **Pinned self-signed `wss://` + NaCl**, but then specify cert generation, QR pinning, ATS exceptions, and the trust-challenge code. Do not pretend WSS is “plain”.

Crypto issue: §5.2 says the first encrypted `hello` contains `ephPub`, but the daemon needs the sender public key before it can `box.open`. Send `ephPub` outside the ciphertext or use a sealed-box construction. The spec also omits nonces, sequence numbers, and replay checks.

### 4. One-time pairing token + allowlist — ⚠️ tweak

The direction is good and better than Paseo. Paseo’s offer is effectively long-lived: it reuses persisted `server-id` and daemon keypair when generating the QR (`/tmp/paseo-research/paseo/packages/server/src/server/pairing-offer.ts:39-46`, `server-id.ts:63-78`, `daemon-keypair.ts:38-65`) and has no server-side allowlist per the research report.

Five minutes is a reasonable default, but the spec needs the boring security mechanics:

- token ID + token hash stored server-side, not raw token in logs/state;
- atomic “consume once” semantics;
- QR refresh/regenerate UX when expired;
- server nonce/challenge for subsequent connections;
- per-frame replay protection after connection establishment.

### 5. No session-level concurrency coordination — ❌ rethink

This is the biggest correctness bug. “JSONL on disk is source of truth” is not enough because Pi’s active leaf and context are process-local until reopen. Pi loads the JSONL into memory (`SessionManager.setSessionFile()` reads into `fileEntries`, `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:531-550`), builds context from in-memory `fileEntries`/`byId` (`session-manager.js:868-884`), and writes with plain `appendFileSync` or `openSync(..., "w")` (`session-manager.js:609,643,652,664`). There is no lock or external-change watcher.

Hot spot outcomes:

- **Bridge RPC mid-flight, user opens same session in TUI:** both processes have independent in-memory leaves. TUI may append a user/assistant branch while the Bridge child later appends its own assistant/tool entries. Best case: a semantically weird fork. Worst case: a rewrite path from stale memory truncates external entries.
- **Phone sends, TUI sends, phone foregrounds:** walking “entries after `lastEntryId`” is not enough. The TUI’s entries may be siblings or a different branch. If the phone UI keeps showing its old leaf but the next Bridge RPC child reopens the file, Pi will use the last physical entry as leaf. The user can send from one apparent context while Pi answers from another.
- **Single in-flight Bridge RPC:** useful for iPhone+iPad, irrelevant for Mac TUI or any other Pi process. It only arbitrates writers the daemon controls.

Safer MVP alternatives:

1. **Mobile-owned sessions only:** existing sessions are view-only; “Continue on phone” creates a fork/clone/private Bridge session.
2. **Explicit risky shared-session mode:** before every send, reparse full JSONL, detect if the active branch changed externally, and force the user to reload/choose branch/clone before writing.
3. **Advisory Bridge lock + warning:** not sufficient alone because TUI won’t honor it, but useful for preventing two Bridge daemons and for diagnostics.

I would not ship “shrug + catch up on focus” for writable existing sessions.

### 6. Bridge owns state outside `~/.pi/` — ⚠️ tweak

Correct to avoid depending on Pi’s internal state layout. Keep Bridge identity/allowlist under `~/Library/Application Support/Pi Bridge/`, not `~/.pi/`.

Tweak: specify file permissions, atomic writes, corruption recovery, backup behavior, and log redaction. I am not convinced “not in macOS Keychain” is a free win; if the server private key is a plain JSON file, it must be `0600` and treated as a real secret.

### 7. ChatGPT-style mobile UX — ⚠️ tweak

The direction is right: chat app, not mobile IDE. But the MVP UI scope is bloated. Right flyout + recent touched files + full tree + syntax highlighting + Markdown rendering + image preview + custom select-to-quote is a lot before the transport/session model is proven.

Also, §3.5 says no glyphs for tool pills, then uses `▶ 💭 thinking`. Pick a rule and follow it.

### 8. Streaming queueing semantics — ⚠️ tweak

Conceptually aligned with Pi RPC. Pi exposes `prompt` with `streamingBehavior`, plus `steer`, `follow_up`, and `abort` (`docs/rpc.md` §Prompting; implementation in `dist/modes/rpc/rpc-mode.js:292-326`).

But the daemon lifecycle conflicts with this. §5.3 says the RPC child is short-lived and exits after the prompt completes. Follow-up messages queued during streaming require the same child/session runtime to stay alive until the queue drains. Define the state machine: active child, queued steer/follow-up, abort, disconnect, reconnect, and when the child is allowed to exit.

### 9. Auto-foldered ad-hoc workspaces — ⚠️ tweak

Good pattern. Needs implementation detail before planning:

- Unicode normalization, emoji removal/encoding, non-English text, empty/attachment-only prompts;
- length cap and reserved filename handling;
- atomic collision handling (`mkdir` without `recursive` in a retry loop, not pre-check then create);
- whether `~/Documents/Pi` means iCloud-synced Documents on many Macs;
- what happens if the folder is deleted while the session still exists.

Appending `-2` is fine, but only if collision handling is atomic.

### 10. Decomposition order — ⚠️ tweak

Daemon-first is right for the protocol core, but “daemon → full menubar → iOS last” de-risks the easy part first. The hardest unknowns are iOS local-network permission, WebSocket/ATS behavior, Keychain storage, backgrounding, and the actual chat ergonomics.

Better order:

1. daemon protocol spike with CLI test client/fake Pi;
2. thin iOS vertical slice against that daemon: pair, connect, send prompt, stream text, reconnect;
3. minimal Mac shell/menubar supervision;
4. broaden UI.

Do not wait until project 3 to discover that the iOS transport assumptions were wrong.

## Section B — Spec gaps

- **Blocker — Crypto handshake is underspecified and partly impossible.** §5.2 encrypts `ephPub` inside the `hello`, but NaCl box decryption needs that public key first. Nonces are not specified. Subsequent “signed handshake” is undefined; Curve25519 box keys are not signing keys. **Fix:** define exact frame shapes: clear ephemeral pubkey, nonce, ciphertext, server challenge, client proof, transcript binding, and key derivation.

- **Blocker — No replay protection for normal connections or frames.** Pairing token one-time use only protects initial enrollment. A captured later handshake/frame should not be replayable. **Fix:** fresh server nonce per connection, client proof over nonce + server id + protocol version, and monotonically increasing per-direction sequence numbers inside AEAD-protected frames.

- **Blocker — Outer WebSocket protocol is missing.** The spec does not define request/response/event envelopes, IDs, sequencing, subscriptions, max frame sizes, binary vs JSON ciphertext, heartbeats, or error envelopes. **Fix:** write a v1 protocol document with `hello/welcome`, `request`, `response`, `event`, `error`, `ping/pong`, close codes, and size limits.

- **Blocker — Pi RPC mapping is not specified.** Pi RPC is JSONL over stdio with strict LF framing; docs explicitly warn not to use Node `readline` because it splits on Unicode separators (`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` §Framing). The spec does not say how Bridge maps mobile `prompt`, `steer`, `follow_up`, `abort`, `set_model`, `get_available_models`, `extension_ui_response`, etc. **Fix:** define one Bridge command per Pi RPC command and specify correlation IDs, cancellation, and response/error behavior.

- **Blocker — Shared-session writes are unsafe.** Covered in Decision 5. The spec needs a session ownership model before planning. **Fix:** make existing sessions view-only unless cloned/forked, or implement external-change detection and force branch selection before any mobile write.

- **Blocker — Active branch semantics are missing.** Session files are trees; “entries after lastEntryId” is a file-order delta, not necessarily the visible branch. Pi reopens with the last physical entry as leaf. **Fix:** mobile state must track `sessionFile`, `sessionId`, `leafEntryId`, and branch path. On catch-up, parse the full tree or a branch-aware delta and explicitly decide whether to keep leaf, switch leaf, or ask the user.

- **Important — Missing recovery when `lastEntryId` disappears.** The spec asks about compaction; current Pi compaction appends a `compaction` entry (`agent-session.js:1324,1569`; `session-manager.js:716-724`), but migration and some session operations can rewrite files (`session-manager.js:547-548,606-614`). Files can also be deleted, moved, or manually edited. **Fix:** if `lastEntryId` is absent, do a full reload with a “history changed on Mac” banner; never silently append to an unknown branch.

- **Important — Daemon crash / Pi child crash / phone disconnect are undefined.** If the daemon dies mid-stream, the phone may have optimistic partial text that never landed in JSONL. If the Pi child is orphaned, it may keep writing without event delivery. **Fix:** process-group management, child cleanup policy, reconnect flow, “run status unknown” UI, and reload-from-disk reconciliation.

- **Important — Mac sleep/wake and network changes are undefined.** Sleep kills sockets; wake may change IPs; Bonjour services need re-advertisement. **Fix:** heartbeat timeouts, reconnect backoff, service rediscovery, and a visible “Mac asleep/offline” state.

- **Important — iOS Local Network permission UX is too thin.** The app needs `NSLocalNetworkUsageDescription` and `NSBonjourServices` for `_pi-bridge._tcp`, and should explain before triggering the system prompt. Apple TN3179 covers this requirement. **Fix:** add first-launch/pairing preflight screens and denied-permission recovery instructions.

- **Important — Bonjour failure mode is missing.** QR contains `host: martins-macbook-pro.local:7423`; that fails on networks without mDNS. **Fix:** QR should include stable server id/fingerprint plus current IP candidates; mobile should support manual IP/port and re-resolve by server id.

- **Important — Multi-Mac identity is underspecified.** Hostnames and Bonjour names collide or change. §3.3 sections by paired Mac, but the identity model is the server public key, not `hostname.local`. **Fix:** store/display stable `serverId`, public-key fingerprint, last-seen Bonjour instance, and user-editable display name. Treat hostname as mutable metadata.

- **Important — Authorization scope is all-or-nothing but unstated.** A paired phone appears able to list all projects, read files under any session CWD, and prompt any session. That is powerful. **Fix:** explicitly choose “paired device is fully trusted for this Mac account” or add per-project/session scopes. If all-powerful, say it in onboarding.

- **Important — Push notification story is not implementable as written.** §3.7 says APNs via daemon or future relay; §7/§8 defer relay/cloud. APNs needs a provider server with signing credentials, and iOS will suspend background sockets. **Fix:** either cut background extension UI from MVP or scope a real push provider/relay. Local notifications are not a substitute for Mac-originated background prompts.

- **Important — File viewer/touched-files data model is missing.** Pi RPC events expose tool calls/results (`docs/rpc.md` §Events), but “every file touched” requires tool-specific parsing and misses arbitrary bash edits. **Fix:** define best-effort sources: read/edit/write tool args, tool result metadata, file mtimes, and limitations. Or cut the touched-file list.

- **Important — Attachment semantics are missing.** §3.10 exposes camera/photo/files. Pi RPC supports images on prompts, not arbitrary file uploads in the same way (`docs/rpc.md` §prompt). **Fix:** v1 images only with size limits, or define upload storage, MIME handling, and how file attachments are referenced to Pi.

- **Important — Model picker behavior is underdefined.** `set_model` writes model changes into the session; if no RPC child is alive, the daemon must spawn one just to set model or persist a pending choice. **Fix:** define whether model changes are session-persistent immediately, only next-run CLI args, or pending mobile state.

- **Important — Session enumeration privacy/performance is unplanned.** Listing `~/.pi/agent/sessions/` can reveal private paths and huge history. File tree browsing can traverse very large repos or sensitive directories. **Fix:** pagination, path redaction options, max tree size/depth, ignore rules, symlink policy, and unreadable-file handling.

- **Important — Protocol/version migration is incomplete.** QR has `v: 1`; the WebSocket protocol, encrypted frame schema, allowlist schema, and daemon/mobile compatibility do not. **Fix:** include protocol version and capabilities in handshake; define min/max supported versions and user-facing upgrade errors.

- **Important — Security storage details are missing.** App Support JSON files need atomic writes and permissions; pairing tokens and private keys must not appear in logs; unpair/regenerate must close active sockets. **Fix:** specify storage schemas, chmod, fsync/atomic rename, backup files, and log redaction.

- **Important — Test strategy is absent.** Three processes + crypto + mDNS + iOS permissions will be painful without a harness. **Fix:** fake Pi RPC server, deterministic crypto test vectors, protocol conformance tests, daemon crash/reconnect tests, JSONL concurrency fixtures, and iOS integration tests with dependency-injected discovery/transport.

- **Nice-to-have — Reconsider subprocess vs direct Node API.** Pi RPC docs say Node/TypeScript embedders should consider `AgentSession` directly (`docs/rpc.md` intro). Spawning `pi --mode rpc` is a defensible isolation choice, but the spec should explain it explicitly. **Fix:** add a short tradeoff note: subprocess stability/version isolation vs direct API control.

## Section C — Cut list

- Cut **background push/extension-dialog notifications** from MVP unless a real APNs provider/relay is in scope.
- Cut **writable existing sessions**; make them view-only with “Continue on phone” clone/fork for MVP.
- Cut **full right-side file tree/recent touched list**. Start with transcript + expandable tool details; add file viewer later.
- Cut **custom select-to-quote**. Copy/paste is enough for v1.
- Cut **generic file attachments**. If needed, support images only because Pi RPC already does.
- Cut **multi-Mac polish**. Keep schema capable, but optimize v1 onboarding for one Mac.
- Cut **Mac stats tiles/tokens**. They do not validate the core product.
- Consider cutting **long-press follow-up** until basic steer/abort/reconnect is proven.

## Section D — Open questions for the author

1. Is writing to an existing TUI-used session a must-have, or is “clone/fork to phone” acceptable?
2. Is MVP intended for App Store/TestFlight distribution or personal sideloading? This changes ATS, APNs, entitlements, and review risk.
3. Is “no central cloud” absolute even for APNs provider duties? If yes, are background extension dialogs explicitly not MVP?
4. What is the threat model: malicious LAN users, stolen paired phone, compromised Mac account, or just accidental exposure?
5. Are paired devices fully trusted for all projects/files under the Mac user account?
6. Should the Mac show an accept/reject prompt after a QR scan, or is “click Pair device” the only consent?
7. How important are extension UI dialogs for v1? Can MVP ignore/degrade them while the app is backgrounded?
8. Should ad-hoc folders live in `~/Documents/Pi` even when Documents is iCloud-synced?
9. Is using Pi’s direct `AgentSession` API off-limits, or merely less preferred than spawning `pi --mode rpc`?
10. What is the expected graceful path when Bonjour fails: manual IP, USB, hotspot, or “same Wi-Fi only, sorry”?
