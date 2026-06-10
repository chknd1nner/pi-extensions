# Radius design v2 — second-pass review

## 1. TL;DR

v2 is a major improvement over v1, but I would **not** green-light full implementation planning yet.

The highest-impact remaining issues:

1. **The crypto protocol is still not correct enough to implement.** §5.4 fixes the v1 `ephPub`-inside-the-box bug, but it introduces nonce/key/replay problems: auth and app frames can reuse nonces under `K_session`, server-side replay of captured client traffic is still possible, and the key derivation story is muddy.
2. **The Radius-controlled session state machine is still underspecified.** §6’s single-controller posture is acceptable as a product call, but the spec does not yet define active-controller ownership, cross-device steer/abort behavior, branch-aware deltas, or reconnect recovery for non-JSONL live state.
3. **The file/image features contradict the protocol limits.** §5.5 caps decrypted app payloads at 1 MB, while §3.9/§5.6 promise 5 MB file previews and §3.10 allows iPhone image attachments. That cannot work without chunking, compression, or lower caps.

Fix those before writing implementation plans. Most v1 blockers are genuinely addressed; the remaining failures are now in the detailed mechanics, not in the product direction.

---

## 2. Pass 1 — Blocker resolution audit

| v1 blocker | v2 status | Notes |
|---|---:|---|
| Crypto handshake underspecified / partly impossible (`ephPub` encrypted inside first box) | ⚠️ Partially resolved | §5.4 now has a binary frame format and sends `ephPub` in the clear for `pair_hello`, so the impossible first-frame bug is fixed. But §5.4 still has crypto blockers: auth/app nonce reuse, no server-side live-challenge binding for client app frames, no clear KDF, and unauthenticated clear frame headers. |
| No replay protection for normal connections or frames | ⚠️ Partially resolved | §5.4 adds per-direction counters, one-time pairing tokens, and a transcript MAC. That protects some simple replays, but a captured `auth_hello` plus old client→server app frames can still be replayed to the daemon because app frames use the long-term `K_session` and client-chosen session prefix. See Pass 3. |
| Outer WebSocket protocol missing | ✅ Resolved | §5.5 defines binary app payloads, request/response/event envelopes, IDs, error shape, close codes, size limits, and WS ping/pong posture. |
| Pi RPC mapping not specified | ✅ Mostly resolved | §5.6 has the required mapping table and correctly calls out strict LF JSONL framing. Remaining problems are lifecycle/state-machine issues, not absence of mapping. |
| Shared-session writes unsafe | 🚫 Author rejected | §6 explicitly documents the accepted risk and reframes the product around a single-controller Radius posture plus future Radius Desktop. Per instruction, I am not re-litigating this directional call. |
| Active branch semantics missing | ⚠️ Partially resolved | §5.6/§6 now mention `leafEntryId`, `branchPath`, tree changes, and `fullReload` when `lastEntryId` disappears. Still missing: branch-aware delta semantics when `lastEntryId` exists but is not on the current leaf path, and how Radius writes from a visible non-last-physical branch when Pi RPC has no generic `branch` command. |

---

## 3. Pass 2 — Important issues audit

| v1 important issue | v2 status | Notes |
|---|---:|---|
| Recovery when `lastEntryId` disappears | ✅ Resolved | §6 says return `{ fullReload: true }` and show a soft refresh banner. Branch ambiguity remains separately. |
| Daemon crash / Pi child crash / phone disconnect undefined | ✅ Mostly resolved | §5.7 defines daemon restart, orphaned child cleanup, child-exit event, and reconnect flow. Event-buffer loss is still a Pass 3 problem. |
| Mac sleep/wake and network changes undefined | ✅ Mostly resolved | §5.7 covers sleep/wake, Bonjour re-registration, reconnect backoff, `NWPathMonitor`, and IP rotation. Sleep behavior during an active run is still ambiguous. |
| iOS Local Network permission UX too thin | ✅ Resolved | §5.2 has `NSLocalNetworkUsageDescription` and `NSBonjourServices`; §5.8 adds pre-permission and denied-state UX. Apple docs confirm `NSAllowsLocalNetworking` is the right ATS exception for unqualified, `.local`, and IP-address local connections. |
| Bonjour failure mode missing | ✅ Resolved | §5.3 adds IP candidates in QR, manual IP entry, and stable identity cross-check. |
| Multi-Mac identity underspecified | ✅ Resolved | §5.3 uses stable `serverId`/pubkey identity; §3.3 and §3.11 account for paired Macs in UI/settings. Encoding consistency still needs cleanup. |
| Authorization scope all-or-nothing but unstated | ❌ Not resolved | v2 still never says plainly: “a paired phone is fully trusted for this Mac account.” §5.6 allows project/session enumeration and file reads; §3.8 says even `.env*` is browsable. This needs explicit onboarding/security text or scopes. |
| Push notification story not implementable | ✅ Resolved | §3.7 and §8 cut push/background extension UI from v1 and make foreground-only behavior explicit. |
| File viewer / touched-files data model missing | ⚠️ Partially resolved | §3.8 gives sources, sandboxing, limits, and bash caveats. But it names non-Pi tool names (`read_file`, `str_replace`, `create_file`) and conflicts with the 1 MB frame cap. |
| Attachment semantics missing | ⚠️ Partially resolved | §3.10 correctly cuts to images only, matching Pi RPC’s native image support. Missing: image size/compression/chunking rules under §5.5’s 1 MB frame limit. |
| Model picker behavior underdefined | ⚠️ Partially resolved | §3.10/§5.6 define lazy pending `set_model`. Still missing: how pending model state is exposed in `open_session`, what happens if the model disappears before next prompt, and how multiple paired devices’ pending choices conflict. |
| Session enumeration privacy/performance unplanned | ⚠️ Partially resolved | §3.8 adds file-tree caps, symlink refusal, and gitignore dimming. `list_projects`/`list_sessions` pagination and redaction are still thin, and the authorization-scope issue remains. |
| Protocol/version migration incomplete | ⚠️ Partially resolved | §5.4/§5.5 include `v`, `protocolVersion`, and close code `4002`. Missing: capabilities/min-max negotiation, allowlist schema versioning, and migration behavior. |
| Security storage details missing | ⚠️ Partially resolved | §5.4 now specifies identity path, `0600`, atomic identity writes, token hashing, Keychain accessibility, and allowlist schema. Missing: allowlist atomic write/chmod/fsync, log redaction, backup/corruption handling, and whether unpair closes active sockets immediately. |
| Test strategy absent | ⚠️ Partially resolved | §10 adds a daemon protocol spike, CLI client, and early iOS slice. Still missing: deterministic crypto vectors, fake Pi RPC fixtures, reconnect/crash tests, JSONL branch fixtures, and event-buffer overflow tests. |
| Subprocess vs direct Node API tradeoff note | ❌ Not resolved, but not blocking | v2 asserts subprocess-based Pi RPC. That is defensible, but the requested tradeoff note still is not present. |

---

## 4. Pass 3 — New problems in v2

### 1. Blocker — Auth/app nonce reuse under the same long-term key

**Citation:** §5.4 Pairing protocol.

§5.4 says every nonce is `8B session-prefix || direction || reserved || counter`, auth uses `K_session`, and “all subsequent `app` frames use `K_session` with counter starting at 1.” But `auth_hello` is already a client→server frame with counter 1, and `auth_welcome` is already a server→client frame with counter 1. If the first app frame in each direction also starts at counter 1 with the same session prefix and same `K_session`, Radius reuses NaCl box nonces under the same key. That is a cryptographic break, not a polish issue.

**Suggested fix:** either keep a single per-direction counter namespace across handshake and app frames (`auth_hello` c2s=1, first app c2s=2; `auth_welcome` s2c=1, first app s2c=2), or better: derive separate per-connection `K_app_c2s`/`K_app_s2c` keys from the handshake transcript and allow app counters to start at 1 only under those fresh keys.

### 2. Blocker — Server-side replay is still possible

**Citation:** §5.4 “Subsequent (re)connections” and “Replay protection.”

The transcript MAC protects the phone from accepting a stale `auth_welcome`. It does **not** prove to the daemon that the client saw the daemon’s fresh `serverChallenge` before sending app commands.

Attack shape:

1. Attacker records a valid old `auth_hello` and subsequent client→server app frames, such as a `prompt`.
2. Later, attacker opens a WS connection and replays the old `auth_hello`.
3. Daemon decrypts it with long-term `K_session`, sees an allowlisted `devicePub`, records the old client-chosen `sessionPrefix`, and sends a fresh `auth_welcome`.
4. Attacker cannot decrypt the fresh welcome, but does not need to. They replay the old client→server app frames. The daemon’s per-connection counters are fresh, the nonces match the replayed prefix/counters, and the frames decrypt under long-term `K_session`.

That means old prompts/control frames can be replayed as long as the device remains allowlisted.

**Suggested fix:** derive app-frame keys from both fresh challenges: `K_app = HKDF(crypto_box_beforenm(...), "radius v1 app", clientChallenge || serverChallenge || clientNonce || serverNonce || roles)`. The daemon must accept post-handshake app frames only under `K_app`, not under long-term `K_session`. Optionally add an explicit `auth_finish` client proof over `serverChallenge` before processing any app request.

### 3. Important — KDF and frame-header authentication are underspecified

**Citation:** §5.4 frame format and `K_session` definition.

§5.4 uses `K_session = scalarMult(...)` both as a NaCl box key and as an HMAC key. NaCl `crypto_box` implementations normally expose either `box(peerPub, ownSk, nonce, msg)` or a precomputed `crypto_box_beforenm` key, not “raw scalarMult as a general-purpose HMAC key.” Also, the clear `frame type` and `sender-pubkey` are not authenticated by `crypto_box` because NaCl box has no associated-data parameter.

**Suggested fix:** specify exact library APIs and key schedule:

- Use `crypto_box_beforenm` or equivalent as input key material.
- HKDF into labeled keys: handshake encryption, app c2s, app s2c, transcript MAC.
- Include `frameType`, protocol version, sender pubkey/server pubkey, and transcript hash inside the encrypted plaintext, then verify it matches the clear header.
- Add deterministic test vectors for Swift and Node.

### 4. Important — 64-bit random session prefix is weaker than it needs to be

**Citation:** §5.4 nonce structure.

A 24-byte XSalsa20 nonce gives plenty of room, but Radius spends only 8 bytes on random session uniqueness and the rest on direction/reserved/counter. For long-term `K_session`, random prefix collision across many reconnects would repeat counter nonces. The birthday risk is not immediate for a hobby app, but it is unnecessary design debt.

**Suggested fix:** use at least a 128-bit random per-connection nonce prefix plus a 64-bit counter, or derive fresh per-connection app keys so nonce uniqueness only needs to hold within a connection.

### 5. Important — `sessionNonceSeed` appears unused

**Citation:** §5.4 Pairing sequence step 5.

`pair_welcome` returns `sessionNonceSeed`, but the nonce structure already uses the phone-generated session prefix, and later auth uses a fresh phone-generated session prefix. The seed is never referenced again.

**Suggested fix:** remove it, or define an actual two-party nonce construction using both client and server nonce contributions.

### 6. Important — Active-controller ownership inside Radius is not defined

**Citation:** §3.6 Streaming controls; §6 Multi-device fan-out.

§6 says multiple subscribers can watch one session and a second device sending mid-stream gets `session_busy`. §3.6 says `steer` is specifically a mid-stream send. Edge case: Phone A starts a prompt, backgrounds, and Phone B opens the same session. Can Phone B steer? abort? follow up? The current text implies “no,” but then the user has no Radius-controlled way to stop or steer a runaway active stream if the original controller is gone.

**Suggested fix:** define an `activeControllerDevicePub` lease per session run:

- who owns `prompt`/`steer`/`follow_up`/`abort`;
- what happens when the controller disconnects/backgrounds;
- whether `abort` is owner-only or any subscriber can emergency-stop;
- whether takeover is impossible in v1 or allowed after a timeout;
- exact error codes and UI copy for non-controller actions.

This does not relitigate external TUI concurrency. It is entirely within Radius’s own control model.

### 7. Important — Lazy Pi RPC child lifecycle contradicts Pi RPC semantics

**Citation:** §5.6 Radius ↔ Pi RPC command mapping and “Lazy RPC child lifecycle.”

The table says `steer`/`follow_up` require an active Pi RPC child. The lifecycle bullet then says the child is “Spawned on the first `prompt`/`steer`/`follow_up`.” That is not coherent. Pi RPC `steer` and `follow_up` are queue commands for an already-running agent; a freshly spawned idle `pi --mode rpc --session ...` cannot meaningfully consume a standalone `steer`.

There are related holes:

- buffered `set_model` may never be applied if no prompt follows;
- `get_available_models` likely does require spawning or embedding Pi config, despite the “lazy” posture;
- the 60s grace rule does not say whether an `open_session` with subscribers but no prompt keeps the child alive;
- after `abort`, queued follow-ups and pending UI requests need explicit cleanup semantics.

**Suggested fix:** write a small state machine: `idle/no_child`, `starting`, `running(controller, queue)`, `draining`, `grace`, `stopping`, `crashed`. Only `prompt` starts from idle. `steer`/`follow_up` require `running` or return a typed error. Define exactly when pending model changes are applied and surfaced.

### 8. Important — Branch-aware deltas are still ambiguous

**Citation:** §5.6 `get_session_delta`; §6 Catch-up semantics.

`get_session_delta(sessionPath, lastEntryId)` returning “everything after `lastEntryId` in tree order” is not enough for Pi’s session tree. If `lastEntryId` still exists but is on a sibling branch, “after it” in file order is not the visible continuation. If a TUI `/tree` operation moves the active leaf to an older entry and appends a branch summary, the phone needs a coherent branch snapshot, not a file-order suffix.

Also: Pi RPC docs expose `fork` and `clone`, but not a generic “set active leaf to arbitrary entry” RPC command. Spawning `pi --mode rpc --session <path>` will reopen the session according to Pi’s current file semantics, not necessarily the branch the phone is rendering.

**Suggested fix:** make deltas branch-aware:

- phone sends `knownLeafEntryId` plus a branch-path hash, not just `sinceEntryId`;
- daemon returns either an append-only child continuation or a `branchReplaced/fullReload` with the full active branch;
- before any mobile write, daemon verifies the phone’s visible leaf equals the daemon/Pi leaf it will write from, or forces reload/branch choice;
- if writing arbitrary branches is required, add a real Pi RPC command or explicitly declare Radius only writes from the current last physical leaf.

### 9. Important — Event-buffer overflow recovery loses live state that is not in JSONL

**Citation:** §5.5 “Max event burst”; §5.7 Phone disconnects mid-stream; Pi RPC docs Events / Extension UI Protocol.

§5.5 caps buffered events at 1000 and says older events are dropped with `subscription_lagged`; §5.7 says the phone recovers with `get_session_delta`. That only recovers committed session entries. Pi RPC emits important live events that may not be reconstructible from JSONL:

- `message_update` token deltas for the current incomplete assistant message;
- `tool_execution_update` partial accumulated output;
- `queue_update` for pending steer/follow-up bubbles;
- `extension_ui_request` while the agent is blocked waiting for the user;
- `compaction_start`, retry state, and transient errors.

A long-running tool can burn through 1000 streaming updates quickly. If the lost event was an extension dialog, `get_session_delta` will not tell the phone what it must answer.

**Suggested fix:** do not model reconnect as “event replay only.” Add a `get_live_session_state` snapshot that returns current partial assistant content, active tool state, queue state, outstanding extension UI requests, current run status, and last committed leaf. Coalesce high-frequency deltas in the buffer and never drop control-plane events like UI requests or run termination.

### 10. Important — File/image payload limits are internally inconsistent

**Citation:** §5.5 Limits; §3.9 File viewer; §5.6 `read_file`; §3.10 Composer.

§5.5 limits decrypted app JSON to 1 MB. But §3.9 says the viewer previews files up to 5 MB, §5.6 says `read_file` returns file bytes up to 5 MB, and §3.10 allows camera/photo images. A normal iPhone photo will often exceed 1 MB even before base64 overhead. A 5 MB file returned as base64 JSON is far over the frame limit.

**Suggested fix:** pick one:

- lower v1 file/image caps to fit inside 1 MB JSON after base64;
- add chunked encrypted transfers (`file_chunk`, `image_chunk`, checksums, cancellation);
- raise the app-frame limit and accept memory/backpressure costs;
- use a separate local HTTP range endpoint protected by the same session keys.  

Do not leave 1 MB frames plus 5 MB files in the same spec.

### 11. Important — Recent-file tracking names the wrong Pi tools

**Citation:** §3.8 Right flyout; Pi source `dist/core/tools/index.js`.

§3.8 says touched files come from `read_file` / `write` / `str_replace` / `create_file` tool args. Pi’s built-in tool names are `read`, `edit`, `write`, `bash`, `grep`, `find`, `ls`; there is no `read_file`, `str_replace`, or `create_file` in the installed Pi source. This looks copied from another agent’s tool surface.

**Suggested fix:** define the Pi-specific extractor:

- `read.args.path` → read/touched;
- `edit.args.path` plus `edit.details.patch/diff` → modified;
- `write.args.path` → created/overwritten;
- `bash` → best-effort only, maybe parse nothing unless compaction/session summary details mention files;
- compaction/branch summary `details.readFiles` / `details.modifiedFiles` can supplement historical data.

### 12. Important — iOS NaCl implementation is not chosen

**Citation:** §5.2 Transport; §5.4 Pairing protocol; §10 Step 2.

CryptoKit does not provide NaCl `crypto_box` / XSalsa20-Poly1305. §10 says Step 2 validates “NaCl crypto in Swift,” but the spec never chooses a dependency. This matters because Swift/Node interoperability bugs in nonce ordering, base64url, and precomputed keys are exactly where this product can fail.

**Suggested fix:** either:

- choose libsodium on both sides (`swift-sodium` on iOS, `sodium-native`/libsodium or audited equivalent on Node), or
- switch the protocol to CryptoKit-native X25519 + HKDF + ChaChaPoly and implement the same construction in Node.

Either way, add test vectors before implementation.

### 13. Important — Authorization scope remains a security UX hole

**Citation:** §3.8 file browsing; §5.6 `list_projects`, `read_file`, `list_files`, `revoke_device`.

The spec implies a paired phone can enumerate sessions, browse files under session CWDs, read `.env*`, and possibly revoke other devices. That may be the right trust model, but it must be explicit. “Dimmed but still browsable” sensitive files are only acceptable if onboarding says the phone is fully trusted as the Mac user.

**Suggested fix:** add a Security / Trust Model subsection for v1: paired device = full access to Pi sessions and files reachable through session CWDs for this macOS account. If that is too broad, add scopes now; do not discover this during UI copywriting.

### 14. Nice-to-have — Bonjour TXT record needs byte caps

**Citation:** §5.3 Discovery.

The TXT record is realistic in normal cases, but `name=<utf8 mac display name>` should have a byte cap. DNS-SD TXT strings have per-string limits, and the total record has practical limits. Non-Latin names are fine, but byte length matters.

**Suggested fix:** cap service display name in TXT to a conservative UTF-8 byte length, e.g. 180 bytes, with ellipsis/truncation rules. The full name can still be returned after encrypted auth.

### 15. Nice-to-have — Fingerprint/serverId encodings are inconsistent

**Citation:** §5.3 TXT `id`; §5.4 Pairing offer `fp`; §5.4 `pair_welcome.serverId`.

§5.3 uses `id=<base64url(server-pubkey-fingerprint)>`, the pairing offer uses `fp=<hex SHA-256 of srvPub>`, and `pair_welcome.serverId` uses `base64url(fp(srvPub))`. That is three subtly different presentations of the same identity.

**Suggested fix:** define one canonical `serverId` encoding, probably base64url of raw SHA-256 bytes, and make `fp` a display-only colon-grouped or hex rendering derived from it.

---

## 5. Pass 4 — Spec hygiene

- **Broken research reference:** §6 cites `docs/superpowers/research/2026-06-10-pi-native-session-concurrency-findings.md`, but the repo has `2026-06-08-pi-native-session-concurrency-findings.md`. §12 uses the correct `2026-06-08` filename.
- **Dangling cross-reference:** §5.4 says the sender pubkey may be “omitted/zeroed after the first frame within a session — see §5.5,” but §5.5 does not define how zeroed pubkeys are interpreted.
- **Unused field:** `sessionNonceSeed` in §5.4 `pair_welcome` is not used later.
- **Mac sleep ambiguity:** §5.7 says phone disconnect keeps the Pi RPC child running, but sleep says the daemon enters quiescent state with “no Pi RPC children running.” Define whether active runs are killed, suspended, or resumed after wake.
- **Pi docs path:** §12 points to `~/.pi/agent/extensions/node_modules/@earendil-works/pi-coding-agent/docs/`; the installed docs path in this environment is `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/`. If the spec wants a durable reference, say “installed Pi package docs” rather than a specific local path.
- **No contradiction with Paseo TLS research:** §5.2’s plain `ws://` + encrypted envelope matches `2026-06-10-paseo-tls-handling-findings.md`.
- **No PWA/App Store relitigation:** v2 consistently cuts PWA and defers App Store distribution; that matches the stated author decisions.
- **Implementation decomposition is mostly sane:** §10 Step 1 is CLI/daemon-only and Step 2 is where iOS Local Network/WebSocket lifecycle is validated. That ordering is fine; just do not claim Step 1 validates iOS assumptions.

---

## 6. Final verdict

**Not green-light for full implementation planning yet.**

Required changes first:

1. Rewrite §5.4 with a complete, test-vector-backed key schedule, nonce schedule, replay story, and Swift/Node crypto dependency choice.
2. Add the Radius session state machine: active controller, child lifecycle, reconnect/live-state snapshot, branch-aware deltas, and write preconditions.
3. Resolve protocol payload limits versus image attachments and 5 MB file viewing.

After those are fixed, v2 should be ready for implementation planning. The remaining issues are mostly spec polish and test-plan depth, not product blockers.
