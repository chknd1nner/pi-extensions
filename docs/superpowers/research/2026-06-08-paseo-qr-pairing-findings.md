# Paseo QR pairing flow findings

## High-level flow
1. Desktop daemon loads/creates a persistent `server-id` and Curve25519 keypair from `$PASEO_HOME`.
2. It builds an offer URL and renders it as a QR image or terminal QR.
3. User on phone taps **Scan QR code** (or **Paste pairing link**), grants camera permission if needed, and scans/pastes the URL.
4. App parses `https://app.paseo.sh/#offer=...`, probes the relay using `serverId` + `daemonPublicKeyB64`, then stores the host locally and navigates to it.
5. The relay handshake is self-bootstrapping: client sends `e2ee_hello` with an ephemeral public key, daemon replies `e2ee_ready`, and both sides derive a shared NaCl box key.

## QR payload contents
It is **not** host:port, a PIN, or account info. The QR encodes:
```json
{ "v": 2, "serverId": "srv_...", "daemonPublicKeyB64": "...", "relay": { "endpoint": "relay.paseo.sh:443", "useTls": true } }
```
Then it is wrapped into `https://app.paseo.sh/#offer=<base64url-json>`.

## Crypto / auth model
- Key exchange: Curve25519 (`tweetnacl.box.before`)
- Encryption: XSalsa20-Poly1305 (`nacl.box.after/open.after`)
- Transport: WebSocket, with encrypted frames base64-encoded after the handshake
- Client keypair is ephemeral per connection; daemon keypair is persistent per `$PASEO_HOME`

This is **not** mTLS, JWT, or a bearer-token pairing flow.

## Pairing token lifecycle
There is no one-time pairing token or expiry logic in code.
- `server-id` is persisted to `$PASEO_HOME/server-id`
- daemon keypair is persisted to `$PASEO_HOME/daemon-keypair.json`
- `generateLocalPairingOffer()` reuses them every time

So the QR/link is effectively long-lived until those files are deleted/regenerated. (Docs mention rotation on restart, but current code does not implement that.)

## Multi-device handling
There is no server-side device allowlist.
- The daemon keeps only its own identity + transient relay sockets.
- The phone/app stores paired hosts locally in AsyncStorage (`@paseo:daemon-registry`).
- A host profile can contain multiple connections and a preferred connection id; local eviction is via `removeHost()` / `removeConnection()`.

## Relay/WAN pairing extension
QR pairing is relay-only. The offer carries the relay endpoint, and the daemon connects outbound to the relay as `role: "server"`; the phone/CLI connects as `role: "client"`.
For direct LAN/VPN use, Paseo has separate direct connection paths; that is not the QR pairing flow.

## Recovery flows
- **Lost phone / app reinstall:** re-scan or re-paste the offer link; the registry is local only.
- **mac reinstall / deleted `$PASEO_HOME`:** new `server-id` + keypair are generated, so old QR links become stale; you must re-pair with the new offer.
- There is no recovery code or pairing secret to reissue.

## Fallbacks
- **Yes:** paste pairing link manually.
- **Yes:** direct connection via host:port / VPN (separate from pairing).
- **No:** PIN, numeric code, or desktop confirmation prompt.

## Gaps / not-implemented / TODOs
- No desktop-side “confirm this is you” step after scan.
- No expiry / one-time-use semantics for the offer.
- No server-side allowlist or device list.
- No explicit revocation flow; you rotate by regenerating daemon identity.
- QR trust is purely cryptographic: whoever can present a valid offer controls the daemon.

## File references
- `packages/server/src/server/pairing-offer.ts:14-67`
- `packages/protocol/src/connection-offer.ts:1-59`
- `packages/server/src/server/daemon-keypair.ts:24-69`
- `packages/server/src/server/server-id.ts:23-83`
- `packages/server/src/server/pairing-qr.ts:13-49`
- `packages/desktop/src/daemon/daemon-manager.ts:427-447`
- `packages/app/src/desktop/components/pair-device-section.tsx:41-194`
- `packages/app/src/app/pair-scan.tsx:112-260`
- `packages/app/src/components/pair-link-modal.tsx:62-220`
- `packages/app/src/components/add-host-method-modal.tsx:44-114`
- `packages/app/src/components/welcome-screen.tsx:205-249`
- `packages/app/src/types/host-connection.ts:24-299`
- `packages/app/src/runtime/host-runtime.ts:1202-1669`
- `packages/relay/src/encrypted-channel.ts:111-259`
- `packages/relay/src/crypto.ts:3-160`
- `SECURITY.md:22-47`
