# Paseo TLS / certificate handling findings (2026-06-10)

## 1. TL;DR
- LAN/direct is plain `ws://` by default. The daemon is an HTTP server with a WS upgrade path, and the mobile app only flips to `wss://` if the user explicitly enables SSL.
- Relay is different: Paseo uses a pairing public key + E2EE as the real trust anchor. Transport TLS is optional/orthogonal (`ws://` or `wss://` via `useTls`), and the hosted relay is `wss://relay.paseo.sh`.
- I found no evidence of cert pinning, custom `URLSessionDelegate`, manual cert install, or ATS exception handling in the iOS app.

## 2. Evidence — LAN connection
- The daemon builds a plain HTTP server, not HTTPS: `packages/server/src/server/bootstrap.ts:500-506` creates `createHTTPServer(app)`, and `packages/server/src/server/bootstrap.ts:1048-1055` listens on that HTTP server.
- The WS server is attached to that HTTP server (`packages/server/src/server/websocket-server.ts:548-558`) and upgrades are filtered by host/origin + optional password auth, not TLS (`packages/server/src/server/websocket-server.ts:570-624`).
- Direct daemon URLs default to `ws://` unless `useTls` is set: `packages/protocol/src/daemon-endpoints.ts:165-173` and `packages/app/src/utils/test-daemon-connection.ts:119-148`.
- The direct-connection UI exposes a manual `Use SSL` toggle, but it only passes the boolean through; it does not manage certs or trust (`packages/app/src/components/add-host-modal.tsx:276-345`).
- The iOS app config has no `NSAppTransportSecurity`, `NSAllowsLocalNetworking`, or `NSExceptionDomains` block (`packages/app/app.config.js:65-75`). Android, by contrast, explicitly allows cleartext traffic.
- Public docs say direct connections are for LAN/VPN and that password auth does **not** encrypt traffic (`public-docs/security.md:91-100`).

## 3. Evidence — relay connection
- Pairing offers contain `serverId`, `daemonPublicKeyB64`, and `relay.endpoint/useTls` — no TLS cert fingerprint or CA data (`packages/protocol/src/connection-offer.ts:9-16`).
- Bootstrap keeps relay transport TLS separate from public-endpoint TLS: `relayUseTls` and `relayPublicUseTls` are computed independently, and the pairing offer carries `relayPublicUseTls` (`packages/server/src/server/bootstrap.ts:928-1039`).
- Relay URLs are built as `ws://` or `wss://` from that flag (`packages/protocol/src/daemon-endpoints.ts:176-199`); `shouldUseTlsForDefaultHostedRelay()` defaults 443 to TLS (`packages/protocol/src/daemon-endpoints.ts:201-210`).
- The relay client uses the normal `ws` library (`packages/server/src/server/relay-transport.ts:57-60, 172-182`).
- The hosted relay is tested against a real TLS endpoint: `wss://relay.paseo.sh` (`packages/relay/src/live-relay.e2e.test.ts:12-15`).
- Public docs describe the relay as untrusted and say the QR/pairing link is the trust anchor; the daemon public key is what matters, not the cert (`public-docs/security.md:27-37, 48-52`).
- Self-hosted relay docs show a normal nginx + Let’s Encrypt setup as the TLS example (`README.md:148-183`).
- Unclear: I did not find the certificate issuer for `relay.paseo.sh` in-repo.

## 4. iOS trust UX
- First-launch onboarding offers `Scan QR code`, `Direct connection`, and `Paste pairing link` (`packages/app/src/components/welcome-screen.tsx:205-249`).
- The add-connection modal labels QR/paste as `Encrypted relay connection` and direct as `Local network or VPN` (`packages/app/src/components/add-host-method-modal.tsx:72-112`).
- The pairing-link modal expects `https://app.paseo.sh/#offer=...` and submits the relay offer public key data to `connectToDaemon` (`packages/app/src/components/pair-link-modal.tsx:97-188`).
- The client uses the runtime’s global `WebSocket` rather than a custom native trust delegate (`packages/client/src/daemon-client-websocket-transport.ts:7-20`).
- I found no UI or code for certificate install, profile install, cert pinning, or manual server-trust evaluation. A public issue reports iOS TLS handshake failures on a custom self-hosted relay domain ([#293](https://github.com/getpaseo/paseo/issues/293)); that matches the repo’s lack of ATS exceptions, not a bespoke trust bypass.

## 5. Comparison summary
| Aspect | Paseo LAN | Paseo Relay |
|---|---|---|
| WS scheme | `ws://` by default; optional `wss://` via `Use SSL` | `ws://` or `wss://` via `useTls`; hosted relay defaults to `wss://` on 443 |
| Cert authority | None by default; if SSL is enabled, it relies on whatever cert iOS/OS trusts | Publicly trusted cert expected for hosted relay; self-hosted docs use Let’s Encrypt (issuer for `relay.paseo.sh` not shown) |
| iOS trust handling | No custom trust override found; default platform trust only | Same for transport TLS; actual trust comes from the pairing public key + E2EE |
| Pinning | None found | None found |
| Mixed-content handling | N/A in native app | N/A in native app |
| Mobile app type | React Native / Expo | React Native / Expo |

## 6. Recommendations for us
- Their model is basically: keep LAN simple, and use pairing-public-key + E2EE for remote access.
- They do **not** appear to do certificate pinning or a self-signed-cert trust UX.
- For us, that means: copy the pairing/E2EE idea, not a manual cert-trust flow. If we need TLS, treat it as transport hygiene; don’t make user trust depend on cert management.
