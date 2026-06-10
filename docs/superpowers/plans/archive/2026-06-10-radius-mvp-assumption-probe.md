# Radius MVP Implementation Plan — Assumption Probe

> **For agentic workers:** REQUIRED SUB-SKILL: Use `pi-delegate-driven-development:delegate-driven-development` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimum viable Radius artifacts — Node daemon + CLI test client + iOS thin slice — that probe every load-bearing assumption in the v3 design spec (`docs/superpowers/specs/2026-06-10-radius-design-v3.md`) before committing to full product development.

**Architecture:** Three artifacts, smallest-possible-thing-that-works. (1) A Node daemon implementing the full crypto, Bonjour, WebSocket, pairing, Pi-RPC supervisor, state machine, `SessionAttacher`, and `LiveStateStore` stack from the spec. (2) A Node CLI test client that performs the full handshake + a streaming `prompt` + reconnect, so the daemon is fully testable from the command line before any Swift is written. (3) A SwiftUI iOS app that performs the same handshake using CryptoKit and renders streaming text, so we validate iOS Local Network UX, NWBrowser, WebSocket backgrounding, and Swift↔Node crypto interop against RFC vectors. No Mac menubar app, no QR scanner, no file viewer, no images, no multi-device — all deferred.

**Tech Stack:**
- **Daemon:** Node 22+, TypeScript 5.x ESM, Vitest, `ws` (WebSocket server), `bonjour-service` (mDNS), only Node built-in `crypto` for cryptography.
- **CLI test client:** Same stack, single-file CLI driven by a small argument parser, no extra deps beyond the daemon's.
- **iOS app:** Swift 5.10+, iOS 17+ (for `@Observable` and Swift Testing), SwiftUI, CryptoKit, Network framework. Zero third-party Swift dependencies. Project generated via `xcodegen`.
- **Source tree:** `apps/radius/daemon/` for the Node code, `apps/radius/cli/` for the CLI test client (shares deps via npm workspace), `apps/radius/ios/` for the iOS project.

---

## Load-bearing assumptions this plan tests

Each assumption maps to one or more tasks; Phase 4 (`Task 26`) wraps them into a manual verification checklist.

| # | Assumption | Validated by |
|---|---|---|
| A | RFC test vectors for X25519, HKDF-SHA256, ChaCha20-Poly1305 produce byte-identical output in Node and Swift | Tasks 3, 18, 19 |
| B | Two-frame pair handshake works end-to-end with one-time per-frame keys | Tasks 6, 14, 22, 26 |
| C | Two-frame auth handshake derives matching per-connection app keys on both sides | Tasks 7, 14, 22, 26 |
| D | Pi RPC LF-strict stdio framing survives U+2028 / U+2029 inside JSON strings (Node `readline` does not) | Task 9 |
| E | Pi RPC child lifecycle state machine permits exactly the transitions in spec §5.6.1 | Tasks 10, 14 |
| F | Unified `open_session` returns disk catch-up + live snapshot in one round trip | Tasks 12, 14 |
| G | `LiveStateStore` correctly accumulates `currentAssistantPartial` and `activeToolCall.partialResult` from Pi's `message_update` / `tool_execution_update` event stream | Tasks 11, 14 |
| H | Branch-aware delta semantics — phone's `lastEntryId` on a sibling branch produces `fullReload: true` | Task 12 |
| I | Bonjour `_radius._tcp` registration is discoverable from iOS `NWBrowser` on real LAN | Tasks 8, 24, 26 |
| J | iOS Local Network permission prompt appears with our `NSLocalNetworkUsageDescription` copy and gates discovery as expected | Tasks 24, 26 |
| K | URLSessionWebSocketTask survives iOS app backgrounding for at least 30s and reconnects cleanly on foreground via `NWPathMonitor` | Tasks 23, 25, 26 |
| L | End-to-end streaming: prompt sent from iOS, `text_delta` events render incrementally, `agent_end` finalises | Tasks 14, 25, 26 |
| M | Reconnect after WS drop mid-stream produces a correct `liveState.currentAssistantPartial` so the phone resumes without loss | Tasks 11, 12, 22, 26 |
| N | Pairing token is single-use, atomically consumed, SHA-256-hashed in storage | Tasks 8, 13 |
| O | The combined wire format (frame codec + AEAD + AAD over `frameType \|\| senderPub`) is interoperable between Node and Swift implementations | Tasks 5, 20, 21 |

---

## Out of MVP scope (explicit cuts)

These are spec features deliberately omitted from the MVP. Each is a deferred follow-on, not a missed requirement.

| Cut | Why deferred |
|---|---|
| Radius for Mac menubar app | Daemon runs from terminal during MVP. Menubar shell is product polish, not a load-bearing assumption. |
| QR code scanning on iOS | Paste-link path validates the same crypto + UX. AVFoundation QR scanning is a known-solved problem. |
| File browser (right flyout, viewer, select-to-quote) | No load-bearing crypto/protocol assumptions here — pure SwiftUI work. |
| Image attachments + chunked file reads | Validates 4 MB cap + `PhotosPicker` later; not load-bearing for protocol design. |
| Extension UI dialogs (select/confirm/input/editor) | Protocol envelope is the same as prompt; pure UI work. |
| Multi-device active controller lease | Requires 2 paired devices; validates 2nd device after MVP. |
| Auto-foldered ad-hoc workspaces | Daemon takes an explicit CWD parameter for MVP; slug derivation is well-defined utility code. |
| `set_model` / `cycle_model` / `get_available_models` | Pi default model is used for the MVP. |
| `follow_up` queueing | `prompt` + `steer` exercises the queue mechanic; `follow_up` is symmetric. |
| Subscription buffer / `subscription_lagged` | Spec §5.6.3 already drops this in favour of `open_session` re-fetch. MVP just calls `open_session` again. |
| Forward secrecy on app frames | v1 non-goal per spec §8. |
| Conversation history / chat list UI | Phone goes straight to a single new chat for MVP. |
| Pairing offer universal-link domain (`radius.app`) | Paste link uses a custom scheme `radius://pair?...` for MVP. Universal-link domain registration is product polish. |
| Settings / preferences UI on either side | Defaults are hard-coded. |
| Multiple sessions in flight | One CWD, one session per device pairing for MVP. |
| LRU bound on handshake nonce store | Use a plain `Set<string>` for MVP; LRU is optimisation. |
| Mac sleep / wake event handling | Manual reconnect on iOS suffices for MVP probing. |
| App Store / TestFlight distribution | Sideload via Xcode for MVP. |

---

## Repository layout

```
apps/radius/
├── README.md                         # MVP overview, run instructions
├── .gitignore
├── daemon/                           # Node daemon (npm workspace member)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── biome.json                    # formatter/linter
│   ├── src/
│   │   ├── index.ts                  # entrypoint — wires everything together
│   │   ├── config.ts                 # paths, ports, defaults
│   │   ├── crypto/
│   │   │   ├── primitives.ts         # X25519, HKDF, ChaChaPoly thin wrappers
│   │   │   ├── frame.ts              # encode/decode wire frames
│   │   │   ├── handshake.ts          # pair + auth handshake state
│   │   │   └── keys.ts               # K_pair_*, K_auth_*, K_app_* derivation
│   │   ├── identity.ts               # srvPub/srvSk persistence
│   │   ├── allowlist.ts              # paired devices file
│   │   ├── pairing.ts                # token issuance + offer URL
│   │   ├── bonjour.ts                # _radius._tcp registration
│   │   ├── ws-server.ts              # WebSocket transport
│   │   ├── envelope.ts               # request/response/event JSON
│   │   ├── pi-rpc/
│   │   │   ├── lf-reader.ts          # LF-strict stdio reader
│   │   │   ├── child.ts              # spawn + lifecycle of one pi process
│   │   │   └── supervisor.ts         # state machine, sessions registry
│   │   ├── session/
│   │   │   ├── enumerator.ts         # list_projects / list_sessions
│   │   │   ├── jsonl.ts              # read / parse Pi session JSONL
│   │   │   ├── attacher.ts           # open_session unified primitive
│   │   │   └── live-state.ts         # LiveStateStore
│   │   └── dispatch.ts               # method router (prompt, abort, ...)
│   └── test/
│       ├── vectors/                  # RFC test vector fixtures
│       │   ├── x25519.json           # RFC 7748 §6.1
│       │   ├── hkdf.json             # RFC 5869 A.1 + A.3
│       │   └── chacha20poly1305.json # RFC 8439 §2.8.2 + A.5
│       ├── crypto.test.ts
│       ├── frame.test.ts
│       ├── handshake.test.ts
│       ├── pairing.test.ts
│       ├── lf-reader.test.ts
│       ├── supervisor.test.ts
│       ├── live-state.test.ts
│       ├── attacher.test.ts
│       └── fixtures/
│           ├── fake-pi-child.ts      # scripted Pi RPC emitter
│           └── sample-sessions/      # JSONL fixtures
├── cli/                              # Node CLI test client (shares workspace)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # arg parser entrypoint
│       ├── pair.ts                   # pair against paste link
│       ├── connect.ts                # reconnect with stored identity
│       └── store.ts                  # local identity persistence
├── ios/
│   ├── project.yml                   # xcodegen spec
│   ├── README.md                     # how to generate & open
│   ├── Sources/
│   │   ├── RadiusApp.swift           # @main App
│   │   ├── Views/
│   │   │   ├── DiscoveryView.swift   # NWBrowser results + paste-link entry
│   │   │   ├── PairView.swift        # confirm fingerprint + name device
│   │   │   ├── HomeView.swift        # list sessions + compose
│   │   │   └── ChatView.swift        # streaming text + composer + abort
│   │   ├── Net/
│   │   │   ├── Discovery.swift       # NWBrowser wrapper
│   │   │   ├── WSClient.swift        # URLSessionWebSocketTask wrapper
│   │   │   ├── Frame.swift           # wire frame codec
│   │   │   ├── Crypto.swift          # CryptoKit thin wrappers
│   │   │   ├── Handshake.swift       # pair + auth client
│   │   │   └── Envelope.swift        # request/response/event JSON
│   │   ├── State/
│   │   │   ├── Identity.swift        # Keychain persistence
│   │   │   ├── PairedMac.swift       # model
│   │   │   └── AppState.swift        # @Observable root state
│   │   └── Info.plist                # NSBonjourServices, NSLocalNetworkUsageDescription
│   └── Tests/
│       ├── CryptoTests.swift         # RFC vector parity with Node
│       ├── FrameTests.swift          # codec round-trip + cross-impl vector
│       └── HandshakeTests.swift      # mock-server pair + auth
└── docs/
    ├── manual-verification-checklist.md  # Phase 4 deliverable
    └── cross-impl-vectors.json           # hand-rolled vectors for Swift↔Node parity
```

---

## Pre-task setup

Before starting Task 1, the engineer must:

- [ ] Confirm Node 22+ is on PATH: `node --version` should print `v22.x` or higher.
- [ ] Confirm Pi is installed and on PATH: `which pi` should print `/opt/homebrew/bin/pi` (or similar). `pi --help` should mention `--mode rpc`.
- [ ] Confirm Xcode 16+ is installed (for iOS 17+ SDK + Swift Testing). `xcodebuild -version` should print `Xcode 16.x` or higher.
- [ ] Install xcodegen if absent: `brew install xcodegen`. `xcodegen --version` should print `2.x` or higher.
- [ ] At least one LLM provider API key configured for Pi (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`) so end-to-end smoke tests can run real Pi sessions.
- [ ] Pair of physical devices for Phase 4 manual testing: one Mac (this machine) + one iPhone on the same Wi-Fi network.

---

# Phase 1 — Daemon foundations

Twelve tasks. By the end of Phase 1, the daemon compiles, starts, registers Bonjour, accepts WebSocket connections, completes the full handshake, and supervises a real Pi RPC child for one session. Unit tests cover crypto, framing, handshake, LF reader, state machine, attacher, and live-state.

### Task 1: Workspace scaffolding for `apps/radius/daemon`

**Files:**
- Create: `apps/radius/README.md`
- Create: `apps/radius/.gitignore`
- Create: `apps/radius/daemon/package.json`
- Create: `apps/radius/daemon/tsconfig.json`
- Create: `apps/radius/daemon/vitest.config.ts`
- Create: `apps/radius/daemon/biome.json`
- Create: `apps/radius/daemon/src/index.ts`
- Modify: `package.json` (root) — add `apps/radius/daemon` to `workspaces`

- [ ] **Step 1: Create `apps/radius/README.md`**

```markdown
# Radius (MVP)

Personal mobile-Mac bridge for the Pi coding agent. See spec at
`/docs/superpowers/specs/2026-06-10-radius-design-v3.md`.

This is the MVP — minimum artifacts to validate load-bearing assumptions.
Not a shippable product yet.

## Layout

- `daemon/` — Node daemon (`radius-daemon`). Runs on the Mac.
- `cli/` — Node CLI test client. Talks to the daemon for protocol testing.
- `ios/` — SwiftUI iOS app (xcodegen project).
- `docs/` — manual verification checklist and cross-impl test vectors.

## Run the daemon

```bash
cd apps/radius/daemon
npm run dev -- --cwd /path/to/some/pi/project
```

The daemon prints a pairing URL to stdout. Use it from the CLI client or iOS app.
```

- [ ] **Step 2: Create `apps/radius/.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
ios/Generated/
ios/RadiusForIOS.xcodeproj/
ios/Build/
ios/DerivedData/
```

- [ ] **Step 3: Create `apps/radius/daemon/package.json`**

```json
{
  "name": "@radius/daemon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "radius-daemon": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check src test",
    "format": "biome format --write src test"
  },
  "dependencies": {
    "bonjour-service": "^1.2.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 4: Create `apps/radius/daemon/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 5: Create `apps/radius/daemon/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
  },
});
```

- [ ] **Step 6: Create `apps/radius/daemon/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true, "style": { "noNonNullAssertion": "off" } }
  }
}
```

- [ ] **Step 7: Create `apps/radius/daemon/src/index.ts`**

```ts
// Entry point — wired up incrementally as Phase 1 tasks complete.
console.log("radius-daemon: placeholder entry, not wired yet");
```

- [ ] **Step 8: Add daemon to root npm workspaces**

Open `package.json` at the repo root. Find the `workspaces` array.

Change:
```json
  "workspaces": [
    "packages/*"
  ],
```
to:
```json
  "workspaces": [
    "packages/*",
    "apps/radius/daemon"
  ],
```

- [ ] **Step 9: Install dependencies from repo root**

Run: `npm install`

Expected: completes without errors. New entries appear in `node_modules/` for `bonjour-service`, `ws`, `vitest`, etc. No nested `apps/radius/daemon/node_modules/` is created (deps hoist to root).

- [ ] **Step 10: Verify the toolchain runs**

Run: `npm run typecheck -w @radius/daemon`
Expected: exits 0 with no output.

Run: `npm run test -w @radius/daemon`
Expected: prints `No test files found` — that's correct for now.

- [ ] **Step 11: Commit**

```bash
git add apps/radius/ package.json package-lock.json
git commit -m "feat(radius): scaffold daemon workspace (MVP)"
```

---

### Task 2: RFC test vector fixtures

We load published RFC vectors as JSON fixtures so the crypto module has objective correctness criteria from the start.

**Files:**
- Create: `apps/radius/daemon/test/vectors/x25519.json`
- Create: `apps/radius/daemon/test/vectors/hkdf.json`
- Create: `apps/radius/daemon/test/vectors/chacha20poly1305.json`

- [ ] **Step 1: Create `apps/radius/daemon/test/vectors/x25519.json`**

RFC 7748 §6.1 Alice/Bob vector (all values hex):

```json
{
  "rfc": "RFC 7748 §6.1",
  "alice": {
    "privateKey": "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
    "publicKey":  "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"
  },
  "bob": {
    "privateKey": "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
    "publicKey":  "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"
  },
  "sharedSecret": "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"
}
```

- [ ] **Step 2: Create `apps/radius/daemon/test/vectors/hkdf.json`**

RFC 5869 A.1 (basic) + A.3 (zero-length salt/info):

```json
{
  "rfc": "RFC 5869 Appendix A",
  "cases": [
    {
      "name": "A.1 basic SHA-256",
      "hash": "sha256",
      "ikm": "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
      "salt": "000102030405060708090a0b0c",
      "info": "f0f1f2f3f4f5f6f7f8f9",
      "length": 42,
      "okm": "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
    },
    {
      "name": "A.3 zero-length salt and info",
      "hash": "sha256",
      "ikm": "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
      "salt": "",
      "info": "",
      "length": 42,
      "okm": "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8"
    }
  ]
}
```

- [ ] **Step 3: Create `apps/radius/daemon/test/vectors/chacha20poly1305.json`**

RFC 8439 §2.8.2 (encryption) + A.5 (decryption):

```json
{
  "rfc": "RFC 8439",
  "cases": [
    {
      "name": "§2.8.2 encryption",
      "key": "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f",
      "nonce": "070000004041424344454647",
      "aad": "50515253c0c1c2c3c4c5c6c7",
      "plaintext": "4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e",
      "ciphertext": "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116",
      "tag": "1ae10b594f09e26a7e902ecbd0600691"
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/radius/daemon/test/vectors/
git commit -m "test(radius): import RFC 7748 / 5869 / 8439 vectors"
```

---

### Task 3: Crypto primitives + RFC vector tests

Thin wrappers around `node:crypto` so the rest of the daemon doesn't sprinkle low-level calls. Validated against RFC vectors.

**Files:**
- Create: `apps/radius/daemon/src/crypto/primitives.ts`
- Create: `apps/radius/daemon/test/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/radius/daemon/test/crypto.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  x25519DiffieHellman,
  hkdfSha256,
  chaChaPoly1305Encrypt,
  chaChaPoly1305Decrypt,
  randomBytes,
  rejectAllZero,
} from "../src/crypto/primitives.js";
import x25519Vec from "./vectors/x25519.json" with { type: "json" };
import hkdfVec from "./vectors/hkdf.json" with { type: "json" };
import aeadVec from "./vectors/chacha20poly1305.json" with { type: "json" };

const hex = (s: string) => Buffer.from(s, "hex");

describe("X25519", () => {
  test("RFC 7748 §6.1 Alice→Bob shared secret", () => {
    const ss = x25519DiffieHellman(hex(x25519Vec.alice.privateKey), hex(x25519Vec.bob.publicKey));
    expect(Buffer.from(ss).toString("hex")).toBe(x25519Vec.sharedSecret);
  });
  test("RFC 7748 §6.1 Bob→Alice shared secret", () => {
    const ss = x25519DiffieHellman(hex(x25519Vec.bob.privateKey), hex(x25519Vec.alice.publicKey));
    expect(Buffer.from(ss).toString("hex")).toBe(x25519Vec.sharedSecret);
  });
});

describe("HKDF-SHA256", () => {
  for (const c of hkdfVec.cases) {
    test(c.name, () => {
      const okm = hkdfSha256(hex(c.ikm), hex(c.salt), hex(c.info), c.length);
      expect(Buffer.from(okm).toString("hex")).toBe(c.okm);
    });
  }
});

describe("ChaCha20-Poly1305", () => {
  for (const c of aeadVec.cases) {
    test(`encrypt: ${c.name}`, () => {
      const r = chaChaPoly1305Encrypt(hex(c.key), hex(c.nonce), hex(c.aad), hex(c.plaintext));
      expect(Buffer.from(r.ciphertext).toString("hex")).toBe(c.ciphertext);
      expect(Buffer.from(r.tag).toString("hex")).toBe(c.tag);
    });
    test(`decrypt: ${c.name}`, () => {
      const pt = chaChaPoly1305Decrypt(hex(c.key), hex(c.nonce), hex(c.aad), hex(c.ciphertext), hex(c.tag));
      expect(Buffer.from(pt).toString("hex")).toBe(c.plaintext);
    });
    test(`decrypt with tampered tag throws: ${c.name}`, () => {
      const badTag = hex(c.tag);
      badTag[0] ^= 0x01;
      expect(() => chaChaPoly1305Decrypt(hex(c.key), hex(c.nonce), hex(c.aad), hex(c.ciphertext), badTag))
        .toThrow();
    });
  }
});

describe("randomBytes", () => {
  test("returns requested length", () => {
    expect(randomBytes(12).length).toBe(12);
    expect(randomBytes(32).length).toBe(32);
  });
  test("two calls differ", () => {
    expect(Buffer.from(randomBytes(32))).not.toEqual(Buffer.from(randomBytes(32)));
  });
});

describe("rejectAllZero", () => {
  test("throws on all zero buffer", () => {
    expect(() => rejectAllZero(new Uint8Array(32))).toThrow(/all-zero/);
  });
  test("passes on non-zero buffer", () => {
    const b = new Uint8Array(32);
    b[15] = 1;
    expect(() => rejectAllZero(b)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run`
Expected: All tests fail with `Cannot find module '../src/crypto/primitives.js'`.

- [ ] **Step 3: Implement `apps/radius/daemon/src/crypto/primitives.ts`**

```ts
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomFillSync,
} from "node:crypto";

/**
 * X25519 ECDH. Returns 32-byte raw shared secret.
 * Note: callers should pass the result through `rejectAllZero` per RFC 7748 §7.
 */
export function x25519DiffieHellman(privateKey32: Uint8Array, publicKey32: Uint8Array): Uint8Array {
  if (privateKey32.length !== 32) throw new Error("X25519 private key must be 32 bytes");
  if (publicKey32.length !== 32) throw new Error("X25519 public key must be 32 bytes");

  // node:crypto requires DER-encoded keys for x25519. The simplest reliable path
  // is to wrap raw bytes in JWK form (base64url), then createPrivateKey/createPublicKey.
  const b64u = (b: Uint8Array) =>
    Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const sk = createPrivateKey({
    key: { kty: "OKP", crv: "X25519", d: b64u(privateKey32), x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    format: "jwk",
  });
  const pk = createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: b64u(publicKey32) },
    format: "jwk",
  });
  const ss = diffieHellman({ privateKey: sk, publicKey: pk });
  return new Uint8Array(ss);
}

/**
 * Throws if every byte is zero. RFC 7748 §7 small-subgroup defence.
 */
export function rejectAllZero(b: Uint8Array): void {
  let acc = 0;
  for (const x of b) acc |= x;
  if (acc === 0) throw new Error("X25519 shared secret was all-zero (RFC 7748 §7)");
}

/**
 * HKDF-SHA256 Extract+Expand (RFC 5869). Empty salt is treated as `HashLen` zero bytes by `hkdfSync`.
 */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  // Node's hkdfSync interprets an empty salt by zeroing HashLen bytes internally, matching RFC 5869 §3.1.
  const out = hkdfSync("sha256", ikm, salt, info, length);
  return new Uint8Array(out);
}

/**
 * IETF ChaCha20-Poly1305 AEAD (RFC 8439).
 * - 32-byte key
 * - 12-byte nonce
 * - AAD authenticated but not encrypted
 * Returns { ciphertext, tag } separately. Caller is responsible for concatenation on the wire.
 */
export function chaChaPoly1305Encrypt(
  key32: Uint8Array,
  nonce12: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): { ciphertext: Uint8Array; tag: Uint8Array } {
  if (key32.length !== 32) throw new Error("ChaChaPoly key must be 32 bytes");
  if (nonce12.length !== 12) throw new Error("ChaChaPoly nonce must be 12 bytes");
  const c = createCipheriv("chacha20-poly1305", key32, nonce12, { authTagLength: 16 });
  c.setAAD(aad, { plaintextLength: plaintext.length });
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext: new Uint8Array(ct), tag: new Uint8Array(c.getAuthTag()) };
}

export function chaChaPoly1305Decrypt(
  key32: Uint8Array,
  nonce12: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
  tag16: Uint8Array,
): Uint8Array {
  if (tag16.length !== 16) throw new Error("Poly1305 tag must be 16 bytes");
  const d = createDecipheriv("chacha20-poly1305", key32, nonce12, { authTagLength: 16 });
  d.setAAD(aad, { plaintextLength: ciphertext.length });
  d.setAuthTag(tag16);
  const pt = Buffer.concat([d.update(ciphertext), d.final()]);
  return new Uint8Array(pt);
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  randomFillSync(b);
  return b;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run`
Expected: all tests in `test/crypto.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/crypto/primitives.ts apps/radius/daemon/test/crypto.test.ts
git commit -m "feat(radius/daemon): X25519+HKDF+ChaChaPoly primitives with RFC vectors"
```

---

### Task 4: Key derivation module

Implements the per-frame and per-connection key schedule from spec §5.4.2.

**Files:**
- Create: `apps/radius/daemon/src/crypto/keys.ts`
- Create: `apps/radius/daemon/test/keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  deriveKPairC2S, deriveKPairS2C,
  deriveKAuthC2S, deriveKAuthS2C,
  deriveKAppC2S, deriveKAppS2C,
} from "../src/crypto/keys.js";

const z32 = new Uint8Array(32);
const z12 = new Uint8Array(12);
const fillN = (b: Uint8Array, n: number) => { b.fill(n); return b; };

describe("Key derivation", () => {
  test("K_pair_c2s ≠ K_pair_s2c for the same DH+nonce (info-string separation)", () => {
    const ss = fillN(new Uint8Array(32), 0xab);
    const nonce = fillN(new Uint8Array(12), 0x55);
    const c = deriveKPairC2S(ss, nonce);
    const s = deriveKPairS2C(ss, nonce);
    expect(Buffer.from(c).toString("hex")).not.toBe(Buffer.from(s).toString("hex"));
  });

  test("K_auth_c2s changes when nonce changes (per-frame keys)", () => {
    const ss = fillN(new Uint8Array(32), 0x11);
    const k1 = deriveKAuthC2S(ss, fillN(new Uint8Array(12), 0x01));
    const k2 = deriveKAuthC2S(ss, fillN(new Uint8Array(12), 0x02));
    expect(Buffer.from(k1).toString("hex")).not.toBe(Buffer.from(k2).toString("hex"));
  });

  test("K_app_c2s changes when challenges change (per-connection keys)", () => {
    const ss = fillN(new Uint8Array(32), 0x22);
    const cc1 = fillN(new Uint8Array(32), 0xaa);
    const sc1 = fillN(new Uint8Array(32), 0xbb);
    const cc2 = fillN(new Uint8Array(32), 0xcc);
    const sc2 = fillN(new Uint8Array(32), 0xdd);
    const k1 = deriveKAppC2S(ss, cc1, sc1);
    const k2 = deriveKAppC2S(ss, cc2, sc2);
    expect(Buffer.from(k1).toString("hex")).not.toBe(Buffer.from(k2).toString("hex"));
  });

  test("K_app_c2s ≠ K_app_s2c for the same challenges", () => {
    const ss = fillN(new Uint8Array(32), 0x33);
    const cc = fillN(new Uint8Array(32), 0xee);
    const sc = fillN(new Uint8Array(32), 0xff);
    expect(Buffer.from(deriveKAppC2S(ss, cc, sc)).toString("hex"))
      .not.toBe(Buffer.from(deriveKAppS2C(ss, cc, sc)).toString("hex"));
  });

  test("All keys are 32 bytes", () => {
    const ss = fillN(new Uint8Array(32), 0x44);
    expect(deriveKPairC2S(ss, z12).length).toBe(32);
    expect(deriveKPairS2C(ss, z12).length).toBe(32);
    expect(deriveKAuthC2S(ss, z12).length).toBe(32);
    expect(deriveKAuthS2C(ss, z12).length).toBe(32);
    expect(deriveKAppC2S(ss, z32, z32).length).toBe(32);
    expect(deriveKAppS2C(ss, z32, z32).length).toBe(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run keys`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 3: Implement `apps/radius/daemon/src/crypto/keys.ts`**

```ts
import { hkdfSha256 } from "./primitives.js";

const enc = (s: string) => new TextEncoder().encode(s);

const INFO = {
  pairC2S: enc("radius-v1-pair-c2s"),
  pairS2C: enc("radius-v1-pair-s2c"),
  authC2S: enc("radius-v1-auth-c2s"),
  authS2C: enc("radius-v1-auth-s2c"),
  appC2S: enc("radius-v1-app-c2s"),
  appS2C: enc("radius-v1-app-s2c"),
} as const;

/**
 * Handshake-frame keys: derived per-frame using the frame's clear 12B nonce as HKDF salt.
 * IKM is the X25519 shared secret (already validated non-zero by caller).
 */
export const deriveKPairC2S = (ss: Uint8Array, frameNonce12: Uint8Array): Uint8Array =>
  hkdfSha256(ss, frameNonce12, INFO.pairC2S, 32);
export const deriveKPairS2C = (ss: Uint8Array, frameNonce12: Uint8Array): Uint8Array =>
  hkdfSha256(ss, frameNonce12, INFO.pairS2C, 32);
export const deriveKAuthC2S = (ss: Uint8Array, frameNonce12: Uint8Array): Uint8Array =>
  hkdfSha256(ss, frameNonce12, INFO.authC2S, 32);
export const deriveKAuthS2C = (ss: Uint8Array, frameNonce12: Uint8Array): Uint8Array =>
  hkdfSha256(ss, frameNonce12, INFO.authS2C, 32);

/**
 * App-frame keys: derived per-connection using concatenated challenges as HKDF salt.
 */
function appSalt(clientChallenge32: Uint8Array, serverChallenge32: Uint8Array): Uint8Array {
  const salt = new Uint8Array(64);
  salt.set(clientChallenge32, 0);
  salt.set(serverChallenge32, 32);
  return salt;
}
export const deriveKAppC2S = (ss: Uint8Array, cc: Uint8Array, sc: Uint8Array): Uint8Array =>
  hkdfSha256(ss, appSalt(cc, sc), INFO.appC2S, 32);
export const deriveKAppS2C = (ss: Uint8Array, cc: Uint8Array, sc: Uint8Array): Uint8Array =>
  hkdfSha256(ss, appSalt(cc, sc), INFO.appS2C, 32);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run keys`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/crypto/keys.ts apps/radius/daemon/test/keys.test.ts
git commit -m "feat(radius/daemon): per-frame and per-connection key derivation"
```

---

### Task 5: Frame codec

Encode/decode the on-wire frame `[1B type][32B senderPub][12B nonce][ciphertext+tag]` with AAD = `frameType || senderPub`. Spec §5.4.1.

**Files:**
- Create: `apps/radius/daemon/src/crypto/frame.ts`
- Create: `apps/radius/daemon/test/frame.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  FrameType,
  encodeFrame,
  decodeFrameHeader,
  decryptFrameBody,
  parseFrame,
} from "../src/crypto/frame.js";
import { randomBytes } from "../src/crypto/primitives.js";

describe("Frame codec", () => {
  test("encode then parse round-trips a known message", () => {
    const key = new Uint8Array(32).fill(0xaa);
    const senderPub = new Uint8Array(32).fill(0xbb);
    const nonce = new Uint8Array(12).fill(0xcc);
    const plaintext = new TextEncoder().encode(JSON.stringify({ hello: "world" }));

    const wire = encodeFrame(FrameType.App, senderPub, nonce, key, plaintext);

    expect(wire[0]).toBe(FrameType.App);
    expect(wire.slice(1, 33)).toEqual(senderPub);
    expect(wire.slice(33, 45)).toEqual(nonce);
    expect(wire.length).toBeGreaterThan(45 + 16); // header + at least tag

    const parsed = parseFrame(wire, key);
    expect(parsed.frameType).toBe(FrameType.App);
    expect(parsed.senderPub).toEqual(senderPub);
    expect(parsed.nonce).toEqual(nonce);
    expect(new TextDecoder().decode(parsed.plaintext)).toBe(JSON.stringify({ hello: "world" }));
  });

  test("tampering with frameType in header fails MAC", () => {
    const key = new Uint8Array(32).fill(0x11);
    const senderPub = new Uint8Array(32).fill(0x22);
    const nonce = randomBytes(12);
    const wire = encodeFrame(FrameType.App, senderPub, nonce, key, new Uint8Array([1, 2, 3]));
    wire[0] = FrameType.AuthHello; // tamper
    expect(() => parseFrame(wire, key)).toThrow();
  });

  test("tampering with senderPub in header fails MAC", () => {
    const key = new Uint8Array(32).fill(0x33);
    const senderPub = new Uint8Array(32).fill(0x44);
    const nonce = randomBytes(12);
    const wire = encodeFrame(FrameType.PairHello, senderPub, nonce, key, new Uint8Array([9, 8, 7]));
    wire[1] ^= 0xff; // tamper one byte of senderPub
    expect(() => parseFrame(wire, key)).toThrow();
  });

  test("decodeFrameHeader exposes the clear header for key derivation", () => {
    const senderPub = new Uint8Array(32).fill(0x55);
    const nonce = new Uint8Array(12).fill(0x66);
    const wire = encodeFrame(FrameType.PairHello, senderPub, nonce, new Uint8Array(32).fill(0xee), new Uint8Array(8));
    const hdr = decodeFrameHeader(wire);
    expect(hdr.frameType).toBe(FrameType.PairHello);
    expect(hdr.senderPub).toEqual(senderPub);
    expect(hdr.nonce).toEqual(nonce);
    expect(hdr.bodyOffset).toBe(45);
  });

  test("frame shorter than header is rejected", () => {
    expect(() => decodeFrameHeader(new Uint8Array(40))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run frame`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 3: Implement `apps/radius/daemon/src/crypto/frame.ts`**

```ts
import { chaChaPoly1305Decrypt, chaChaPoly1305Encrypt } from "./primitives.js";

export const FrameType = {
  PairHello: 0x01,
  PairWelcome: 0x02,
  AuthHello: 0x03,
  AuthWelcome: 0x04,
  App: 0x05,
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const FRAME_HEADER_LEN = 1 + 32 + 12; // 45 bytes
export const POLY1305_TAG_LEN = 16;

export interface FrameHeader {
  frameType: FrameType;
  senderPub: Uint8Array;
  nonce: Uint8Array;
  bodyOffset: number;
}

export interface ParsedFrame extends FrameHeader {
  plaintext: Uint8Array;
}

export function decodeFrameHeader(wire: Uint8Array): FrameHeader {
  if (wire.length < FRAME_HEADER_LEN + POLY1305_TAG_LEN) {
    throw new Error(`frame too short: ${wire.length} bytes`);
  }
  const frameType = wire[0] as FrameType;
  if (
    frameType !== FrameType.PairHello &&
    frameType !== FrameType.PairWelcome &&
    frameType !== FrameType.AuthHello &&
    frameType !== FrameType.AuthWelcome &&
    frameType !== FrameType.App
  ) {
    throw new Error(`unknown frameType ${frameType}`);
  }
  return {
    frameType,
    senderPub: wire.slice(1, 33),
    nonce: wire.slice(33, 45),
    bodyOffset: FRAME_HEADER_LEN,
  };
}

export function encodeFrame(
  frameType: FrameType,
  senderPub: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  if (senderPub.length !== 32) throw new Error("senderPub must be 32 bytes");
  if (nonce.length !== 12) throw new Error("nonce must be 12 bytes");

  const aad = new Uint8Array(33);
  aad[0] = frameType;
  aad.set(senderPub, 1);

  const { ciphertext, tag } = chaChaPoly1305Encrypt(key, nonce, aad, plaintext);

  const wire = new Uint8Array(FRAME_HEADER_LEN + ciphertext.length + POLY1305_TAG_LEN);
  wire[0] = frameType;
  wire.set(senderPub, 1);
  wire.set(nonce, 33);
  wire.set(ciphertext, FRAME_HEADER_LEN);
  wire.set(tag, FRAME_HEADER_LEN + ciphertext.length);
  return wire;
}

export function decryptFrameBody(header: FrameHeader, wire: Uint8Array, key: Uint8Array): Uint8Array {
  const aad = new Uint8Array(33);
  aad[0] = header.frameType;
  aad.set(header.senderPub, 1);

  const ctEnd = wire.length - POLY1305_TAG_LEN;
  const ciphertext = wire.slice(header.bodyOffset, ctEnd);
  const tag = wire.slice(ctEnd);
  return chaChaPoly1305Decrypt(key, header.nonce, aad, ciphertext, tag);
}

export function parseFrame(wire: Uint8Array, key: Uint8Array): ParsedFrame {
  const header = decodeFrameHeader(wire);
  const plaintext = decryptFrameBody(header, wire, key);
  return { ...header, plaintext };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run frame`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/crypto/frame.ts apps/radius/daemon/test/frame.test.ts
git commit -m "feat(radius/daemon): wire frame codec with AEAD AAD over header"
```

---

### Task 6: Pair handshake state

Implements steps in spec §5.4.3: ephemeral key gen, build pair_hello, verify pair_welcome.

**Files:**
- Create: `apps/radius/daemon/src/crypto/handshake.ts`
- Create: `apps/radius/daemon/test/handshake.test.ts`

- [ ] **Step 1: Write the failing test (server-side pair handshake)**

```ts
import { describe, expect, test } from "vitest";
import {
  buildPairHello,
  handlePairHello,
  buildPairWelcome,
  handlePairWelcome,
} from "../src/crypto/handshake.js";
import { randomBytes, x25519DiffieHellman } from "../src/crypto/primitives.js";
import { generateKeyPairSync } from "node:crypto";

function genX25519Pair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pub = new Uint8Array(publicKey.export({ format: "jwk" }).x
    ? Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url")
    : []);
  const priv = new Uint8Array(privateKey.export({ format: "jwk" }).d
    ? Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url")
    : []);
  return { pub, priv };
}

describe("Pair handshake", () => {
  test("client → server → client round-trip succeeds", () => {
    const server = genX25519Pair();
    const eph = genX25519Pair();
    const device = genX25519Pair();

    // Phone builds pair_hello
    const helloWire = buildPairHello({
      ephPub: eph.pub,
      ephSk: eph.priv,
      srvPub: server.pub,
      token: "tok-from-qr",
      devicePub: device.pub,
      deviceName: "Martin's iPhone",
    });

    // Daemon processes pair_hello
    const helloOut = handlePairHello({ wire: helloWire, srvSk: server.priv });
    expect(helloOut.token).toBe("tok-from-qr");
    expect(helloOut.devicePub).toEqual(device.pub);
    expect(helloOut.deviceName).toBe("Martin's iPhone");

    // Daemon builds pair_welcome
    const welcomeWire = buildPairWelcome({
      srvPub: server.pub,
      srvSk: server.priv,
      ephPub: eph.pub,
      serverId: "test-server-id",
      serverName: "Martin's MacBook Pro",
    });

    // Phone processes pair_welcome
    const welcomeOut = handlePairWelcome({
      wire: welcomeWire,
      ephSk: eph.priv,
      srvPub: server.pub,
    });
    expect(welcomeOut.serverId).toBe("test-server-id");
    expect(welcomeOut.serverName).toBe("Martin's MacBook Pro");
  });

  test("tampered pair_hello fails decryption", () => {
    const server = genX25519Pair();
    const eph = genX25519Pair();
    const device = genX25519Pair();
    const wire = buildPairHello({
      ephPub: eph.pub, ephSk: eph.priv, srvPub: server.pub,
      token: "t", devicePub: device.pub, deviceName: "x",
    });
    wire[50] ^= 0x55; // tamper inside ciphertext
    expect(() => handlePairHello({ wire, srvSk: server.priv })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run handshake`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 3: Implement `apps/radius/daemon/src/crypto/handshake.ts` (pair half)**

```ts
import {
  FrameType,
  decodeFrameHeader,
  decryptFrameBody,
  encodeFrame,
} from "./frame.js";
import { deriveKPairC2S, deriveKPairS2C, deriveKAuthC2S, deriveKAuthS2C } from "./keys.js";
import { randomBytes, rejectAllZero, x25519DiffieHellman } from "./primitives.js";

const td = new TextDecoder();
const te = new TextEncoder();

function encodeJson(o: unknown): Uint8Array {
  return te.encode(JSON.stringify(o));
}
function decodeJson<T>(b: Uint8Array): T {
  return JSON.parse(td.decode(b)) as T;
}

// ── Pair hello ────────────────────────────────────────────────────────────────

export interface BuildPairHelloInput {
  ephPub: Uint8Array; ephSk: Uint8Array; srvPub: Uint8Array;
  token: string; devicePub: Uint8Array; deviceName: string;
}
export function buildPairHello(i: BuildPairHelloInput): Uint8Array {
  const ss = x25519DiffieHellman(i.ephSk, i.srvPub);
  rejectAllZero(ss);
  const nonce = randomBytes(12);
  const key = deriveKPairC2S(ss, nonce);
  const plaintext = encodeJson({
    v: 1,
    tok: i.token,
    devicePub: Buffer.from(i.devicePub).toString("base64url"),
    deviceName: i.deviceName,
  });
  return encodeFrame(FrameType.PairHello, i.ephPub, nonce, key, plaintext);
}

export interface HandlePairHelloInput { wire: Uint8Array; srvSk: Uint8Array; }
export interface HandlePairHelloOutput {
  token: string; devicePub: Uint8Array; deviceName: string; ephPub: Uint8Array; nonce: Uint8Array;
}
export function handlePairHello(i: HandlePairHelloInput): HandlePairHelloOutput {
  const header = decodeFrameHeader(i.wire);
  if (header.frameType !== FrameType.PairHello) throw new Error("expected PairHello");
  const ss = x25519DiffieHellman(i.srvSk, header.senderPub);
  rejectAllZero(ss);
  const key = deriveKPairC2S(ss, header.nonce);
  const pt = decryptFrameBody(header, i.wire, key);
  const o = decodeJson<{ v: number; tok: string; devicePub: string; deviceName: string }>(pt);
  if (o.v !== 1) throw new Error(`unsupported handshake v=${o.v}`);
  const devicePub = new Uint8Array(Buffer.from(o.devicePub, "base64url"));
  if (devicePub.length !== 32) throw new Error("devicePub wrong length");
  return { token: o.tok, devicePub, deviceName: o.deviceName, ephPub: header.senderPub, nonce: header.nonce };
}

// ── Pair welcome ──────────────────────────────────────────────────────────────

export interface BuildPairWelcomeInput {
  srvPub: Uint8Array; srvSk: Uint8Array; ephPub: Uint8Array;
  serverId: string; serverName: string;
}
export function buildPairWelcome(i: BuildPairWelcomeInput): Uint8Array {
  const ss = x25519DiffieHellman(i.srvSk, i.ephPub);
  rejectAllZero(ss);
  const nonce = randomBytes(12);
  const key = deriveKPairS2C(ss, nonce);
  const plaintext = encodeJson({ v: 1, serverId: i.serverId, serverName: i.serverName });
  return encodeFrame(FrameType.PairWelcome, i.srvPub, nonce, key, plaintext);
}

export interface HandlePairWelcomeInput { wire: Uint8Array; ephSk: Uint8Array; srvPub: Uint8Array; }
export interface HandlePairWelcomeOutput { serverId: string; serverName: string; }
export function handlePairWelcome(i: HandlePairWelcomeInput): HandlePairWelcomeOutput {
  const header = decodeFrameHeader(i.wire);
  if (header.frameType !== FrameType.PairWelcome) throw new Error("expected PairWelcome");
  if (Buffer.from(header.senderPub).toString("hex") !== Buffer.from(i.srvPub).toString("hex")) {
    throw new Error("pair_welcome sender pubkey does not match expected srvPub");
  }
  const ss = x25519DiffieHellman(i.ephSk, header.senderPub);
  rejectAllZero(ss);
  const key = deriveKPairS2C(ss, header.nonce);
  const pt = decryptFrameBody(header, i.wire, key);
  return decodeJson<{ serverId: string; serverName: string }>(pt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run handshake`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/crypto/handshake.ts apps/radius/daemon/test/handshake.test.ts
git commit -m "feat(radius/daemon): pair handshake (client + server halves)"
```

---

### Task 7: Auth handshake + app-frame helpers

Extends `handshake.ts` with auth_hello, auth_welcome, and helpers to seal/open `app` frames under derived `K_app_*`.

**Files:**
- Modify: `apps/radius/daemon/src/crypto/handshake.ts`
- Modify: `apps/radius/daemon/test/handshake.test.ts`

- [ ] **Step 1: Append failing tests to `test/handshake.test.ts`**

```ts
import {
  buildAuthHello,
  handleAuthHello,
  buildAuthWelcome,
  handleAuthWelcome,
  sealAppFrame,
  openAppFrame,
} from "../src/crypto/handshake.js";

describe("Auth handshake", () => {
  test("client→server→client returns matching app keys both sides", () => {
    const server = genX25519Pair();
    const device = genX25519Pair();

    // Phone builds auth_hello
    const cc = randomBytes(32);
    const helloWire = buildAuthHello({
      devicePub: device.pub, deviceSk: device.priv, srvPub: server.pub, clientChallenge: cc,
    });

    // Daemon processes auth_hello
    const helloOut = handleAuthHello({ wire: helloWire, srvSk: server.priv });
    expect(helloOut.clientChallenge).toEqual(cc);
    expect(helloOut.devicePub).toEqual(device.pub);

    // Daemon builds auth_welcome (returns app keys too)
    const sc = randomBytes(32);
    const { wire: welcomeWire, kAppC2S: srvKAppC2S, kAppS2C: srvKAppS2C } = buildAuthWelcome({
      srvPub: server.pub, srvSk: server.priv, devicePub: device.pub,
      clientChallenge: cc, serverChallenge: sc, sessionId: "ses-123",
    });

    // Phone processes auth_welcome (also returns app keys)
    const welcomeOut = handleAuthWelcome({
      wire: welcomeWire, deviceSk: device.priv, srvPub: server.pub, clientChallenge: cc,
    });
    expect(welcomeOut.serverChallenge).toEqual(sc);
    expect(welcomeOut.sessionId).toBe("ses-123");
    expect(Buffer.from(welcomeOut.kAppC2S).toString("hex")).toBe(Buffer.from(srvKAppC2S).toString("hex"));
    expect(Buffer.from(welcomeOut.kAppS2C).toString("hex")).toBe(Buffer.from(srvKAppS2C).toString("hex"));
  });
});

describe("App frame sealing", () => {
  test("sealAppFrame then openAppFrame round-trips", () => {
    const sender = genX25519Pair();
    const key = randomBytes(32);
    const counters = { tx: 0, rx: 0 };
    const wire = sealAppFrame({ senderPub: sender.pub, key, counter: counters.tx++, plaintext: te.encode("hi") });
    const opened = openAppFrame({ wire, key, lastCounter: counters.rx });
    expect(td.decode(opened.plaintext)).toBe("hi");
    expect(opened.counter).toBe(0);
  });

  test("openAppFrame rejects replayed counter", () => {
    const sender = genX25519Pair();
    const key = randomBytes(32);
    const wire = sealAppFrame({ senderPub: sender.pub, key, counter: 5, plaintext: te.encode("once") });
    const first = openAppFrame({ wire, key, lastCounter: -1 });
    expect(first.counter).toBe(5);
    expect(() => openAppFrame({ wire, key, lastCounter: 5 })).toThrow(/counter/i);
  });

  test("openAppFrame rejects out-of-order older counter", () => {
    const sender = genX25519Pair();
    const key = randomBytes(32);
    const wire = sealAppFrame({ senderPub: sender.pub, key, counter: 3, plaintext: te.encode("old") });
    expect(() => openAppFrame({ wire, key, lastCounter: 10 })).toThrow(/counter/i);
  });
});

const te = new TextEncoder();
const td = new TextDecoder();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run handshake`
Expected: new tests fail with `Cannot find module` for the new exports.

- [ ] **Step 3: Append to `apps/radius/daemon/src/crypto/handshake.ts`**

```ts
// ── Auth hello ────────────────────────────────────────────────────────────────

export interface BuildAuthHelloInput {
  devicePub: Uint8Array; deviceSk: Uint8Array; srvPub: Uint8Array; clientChallenge: Uint8Array;
}
export function buildAuthHello(i: BuildAuthHelloInput): Uint8Array {
  const ss = x25519DiffieHellman(i.deviceSk, i.srvPub);
  rejectAllZero(ss);
  const nonce = randomBytes(12);
  const key = deriveKAuthC2S(ss, nonce);
  const plaintext = encodeJson({
    v: 1, protocolVersion: 1,
    clientChallenge: Buffer.from(i.clientChallenge).toString("base64url"),
  });
  return encodeFrame(FrameType.AuthHello, i.devicePub, nonce, key, plaintext);
}

export interface HandleAuthHelloInput { wire: Uint8Array; srvSk: Uint8Array; }
export interface HandleAuthHelloOutput {
  devicePub: Uint8Array; clientChallenge: Uint8Array; nonce: Uint8Array;
}
export function handleAuthHello(i: HandleAuthHelloInput): HandleAuthHelloOutput {
  const header = decodeFrameHeader(i.wire);
  if (header.frameType !== FrameType.AuthHello) throw new Error("expected AuthHello");
  const ss = x25519DiffieHellman(i.srvSk, header.senderPub);
  rejectAllZero(ss);
  const key = deriveKAuthC2S(ss, header.nonce);
  const pt = decryptFrameBody(header, i.wire, key);
  const o = decodeJson<{ v: number; protocolVersion: number; clientChallenge: string }>(pt);
  if (o.v !== 1 || o.protocolVersion !== 1) throw new Error("unsupported auth version");
  return {
    devicePub: header.senderPub,
    clientChallenge: new Uint8Array(Buffer.from(o.clientChallenge, "base64url")),
    nonce: header.nonce,
  };
}

// ── Auth welcome ──────────────────────────────────────────────────────────────

import { deriveKAppC2S, deriveKAppS2C } from "./keys.js";

export interface BuildAuthWelcomeInput {
  srvPub: Uint8Array; srvSk: Uint8Array; devicePub: Uint8Array;
  clientChallenge: Uint8Array; serverChallenge: Uint8Array; sessionId: string;
}
export interface BuildAuthWelcomeOutput {
  wire: Uint8Array; kAppC2S: Uint8Array; kAppS2C: Uint8Array;
}
export function buildAuthWelcome(i: BuildAuthWelcomeInput): BuildAuthWelcomeOutput {
  const ss = x25519DiffieHellman(i.srvSk, i.devicePub);
  rejectAllZero(ss);
  const nonce = randomBytes(12);
  const key = deriveKAuthS2C(ss, nonce);
  const plaintext = encodeJson({
    v: 1, protocolVersion: 1,
    serverChallenge: Buffer.from(i.serverChallenge).toString("base64url"),
    sessionId: i.sessionId,
  });
  const wire = encodeFrame(FrameType.AuthWelcome, i.srvPub, nonce, key, plaintext);
  const kAppC2S = deriveKAppC2S(ss, i.clientChallenge, i.serverChallenge);
  const kAppS2C = deriveKAppS2C(ss, i.clientChallenge, i.serverChallenge);
  return { wire, kAppC2S, kAppS2C };
}

export interface HandleAuthWelcomeInput {
  wire: Uint8Array; deviceSk: Uint8Array; srvPub: Uint8Array; clientChallenge: Uint8Array;
}
export interface HandleAuthWelcomeOutput {
  serverChallenge: Uint8Array; sessionId: string; kAppC2S: Uint8Array; kAppS2C: Uint8Array;
}
export function handleAuthWelcome(i: HandleAuthWelcomeInput): HandleAuthWelcomeOutput {
  const header = decodeFrameHeader(i.wire);
  if (header.frameType !== FrameType.AuthWelcome) throw new Error("expected AuthWelcome");
  if (Buffer.from(header.senderPub).toString("hex") !== Buffer.from(i.srvPub).toString("hex")) {
    throw new Error("auth_welcome sender pubkey mismatch");
  }
  const ss = x25519DiffieHellman(i.deviceSk, header.senderPub);
  rejectAllZero(ss);
  const key = deriveKAuthS2C(ss, header.nonce);
  const pt = decryptFrameBody(header, i.wire, key);
  const o = decodeJson<{ v: number; protocolVersion: number; serverChallenge: string; sessionId: string }>(pt);
  const sc = new Uint8Array(Buffer.from(o.serverChallenge, "base64url"));
  const kAppC2S = deriveKAppC2S(ss, i.clientChallenge, sc);
  const kAppS2C = deriveKAppS2C(ss, i.clientChallenge, sc);
  return { serverChallenge: sc, sessionId: o.sessionId, kAppC2S, kAppS2C };
}

// ── App frames ────────────────────────────────────────────────────────────────

export interface SealAppFrameInput { senderPub: Uint8Array; key: Uint8Array; counter: number; plaintext: Uint8Array; }
export function sealAppFrame(i: SealAppFrameInput): Uint8Array {
  if (i.counter < 0 || !Number.isInteger(i.counter)) throw new Error("counter must be non-negative integer");
  if (i.counter > 0x7fffffff_ffffffff) throw new Error("counter wrap");
  const nonce = new Uint8Array(12);
  randomBytes(4).forEach((b, idx) => (nonce[idx] = b));
  // 8B big-endian counter at bytes 4..11
  const dv = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  dv.setBigUint64(4, BigInt(i.counter), false);
  return encodeFrame(FrameType.App, i.senderPub, nonce, i.key, i.plaintext);
}

export interface OpenAppFrameInput { wire: Uint8Array; key: Uint8Array; lastCounter: number; }
export interface OpenAppFrameOutput { plaintext: Uint8Array; counter: number; senderPub: Uint8Array; }
export function openAppFrame(i: OpenAppFrameInput): OpenAppFrameOutput {
  const header = decodeFrameHeader(i.wire);
  if (header.frameType !== FrameType.App) throw new Error("expected App frame");
  const dv = new DataView(header.nonce.buffer, header.nonce.byteOffset, header.nonce.byteLength);
  const counter = Number(dv.getBigUint64(4, false));
  if (counter <= i.lastCounter) throw new Error(`stale or duplicate counter ${counter} <= ${i.lastCounter}`);
  // Authenticate before advancing counter — caller bumps `lastCounter` on success.
  const plaintext = decryptFrameBody(header, i.wire, i.key);
  return { plaintext, counter, senderPub: header.senderPub };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run handshake`
Expected: all auth + app-frame tests pass alongside pair tests.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/crypto/handshake.ts apps/radius/daemon/test/handshake.test.ts
git commit -m "feat(radius/daemon): auth handshake + app frame seal/open"
```

---

### Task 8: Identity, allowlist, pairing, Bonjour

Small but crucial: persistence of `srvPub/srvSk`, allowlist mutations, pairing token issuance + URL building, Bonjour announce.

**Files:**
- Create: `apps/radius/daemon/src/config.ts`
- Create: `apps/radius/daemon/src/identity.ts`
- Create: `apps/radius/daemon/src/allowlist.ts`
- Create: `apps/radius/daemon/src/pairing.ts`
- Create: `apps/radius/daemon/src/bonjour.ts`
- Create: `apps/radius/daemon/test/pairing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/radius/daemon/test/pairing.test.ts
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateIdentity } from "../src/identity.js";
import { Allowlist } from "../src/allowlist.js";
import { issuePairingToken, buildPairingUrl, consumePairingToken } from "../src/pairing.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "radius-test-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("Identity", () => {
  test("creates a new identity if absent and reuses on second load", () => {
    const id1 = loadOrCreateIdentity(dir);
    const id2 = loadOrCreateIdentity(dir);
    expect(Buffer.from(id1.srvPub).toString("hex")).toBe(Buffer.from(id2.srvPub).toString("hex"));
    expect(Buffer.from(id1.srvSk).toString("hex")).toBe(Buffer.from(id2.srvSk).toString("hex"));
    expect(id1.srvPub.length).toBe(32);
    expect(id1.srvSk.length).toBe(32);
  });
});

describe("Allowlist", () => {
  test("add → contains → remove → !contains", () => {
    const al = new Allowlist(dir);
    const pub = new Uint8Array(32).fill(0xab);
    expect(al.contains(pub)).toBe(false);
    al.add({ devicePub: pub, deviceName: "Martin's iPhone", pairedAt: Date.now() });
    expect(al.contains(pub)).toBe(true);
    al.remove(pub);
    expect(al.contains(pub)).toBe(false);
  });

  test("survives reload", () => {
    const pub = new Uint8Array(32).fill(0xcd);
    new Allowlist(dir).add({ devicePub: pub, deviceName: "x", pairedAt: 1 });
    expect(new Allowlist(dir).contains(pub)).toBe(true);
  });
});

describe("Pairing token", () => {
  test("issuePairingToken returns 32-byte token + url", () => {
    const id = loadOrCreateIdentity(dir);
    const t = issuePairingToken(dir);
    expect(t.token.length).toBe(43); // base64url 32 bytes
    expect(t.tokenHash.length).toBe(64); // hex SHA-256

    const url = buildPairingUrl({
      token: t.token, srvPub: id.srvPub, host: "host.local", port: 7423,
      ips: ["1.2.3.4"], name: "MyMac", expiresAt: t.expiresAt,
    });
    expect(url.startsWith("radius://pair?")).toBe(true);
  });

  test("consumePairingToken succeeds once, then fails", () => {
    const t = issuePairingToken(dir);
    expect(consumePairingToken(dir, t.token)).toBe(true);
    expect(consumePairingToken(dir, t.token)).toBe(false);
  });

  test("expired token is rejected", async () => {
    const t = issuePairingToken(dir, { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(consumePairingToken(dir, t.token)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run pairing`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 3: Implement `apps/radius/daemon/src/config.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export interface RuntimeConfig {
  appSupportDir: string;
  port: number;
  serviceName: string;
  cwd: string;
}

export function defaultConfig(): RuntimeConfig {
  return {
    appSupportDir: join(homedir(), "Library", "Application Support", "Radius"),
    port: 7423,
    serviceName: "Radius on this Mac",
    cwd: process.cwd(),
  };
}
```

- [ ] **Step 4: Implement `apps/radius/daemon/src/identity.ts`**

```ts
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";

export interface Identity { srvPub: Uint8Array; srvSk: Uint8Array; }

function atomicWriteJson(path: string, obj: unknown): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(obj));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function loadOrCreateIdentity(appSupportDir: string): Identity {
  mkdirSync(appSupportDir, { recursive: true, mode: 0o700 });
  const path = join(appSupportDir, "identity.json");
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { srvPub: string; srvSk: string };
    return {
      srvPub: new Uint8Array(Buffer.from(raw.srvPub, "base64url")),
      srvSk: new Uint8Array(Buffer.from(raw.srvSk, "base64url")),
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const privJwk = privateKey.export({ format: "jwk" }) as { d: string };
  const srvPub = new Uint8Array(Buffer.from(pubJwk.x, "base64url"));
  const srvSk = new Uint8Array(Buffer.from(privJwk.d, "base64url"));
  atomicWriteJson(path, {
    srvPub: Buffer.from(srvPub).toString("base64url"),
    srvSk: Buffer.from(srvSk).toString("base64url"),
  });
  return { srvPub, srvSk };
}
```

- [ ] **Step 5: Implement `apps/radius/daemon/src/allowlist.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync, writeSync } from "node:fs";
import { join } from "node:path";

export interface AllowlistEntry {
  devicePub: Uint8Array; deviceName: string; pairedAt: number;
}
interface PersistedEntry { devicePub: string; deviceName: string; pairedAt: number; }

export class Allowlist {
  private path: string;
  private entries: AllowlistEntry[] = [];
  constructor(appSupportDir: string) {
    mkdirSync(appSupportDir, { recursive: true, mode: 0o700 });
    this.path = join(appSupportDir, "allowlist.json");
    this.reload();
  }
  private reload(): void {
    if (!existsSync(this.path)) { this.entries = []; return; }
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as PersistedEntry[];
    this.entries = raw.map((r) => ({
      devicePub: new Uint8Array(Buffer.from(r.devicePub, "base64url")),
      deviceName: r.deviceName,
      pairedAt: r.pairedAt,
    }));
  }
  private persist(): void {
    const out: PersistedEntry[] = this.entries.map((e) => ({
      devicePub: Buffer.from(e.devicePub).toString("base64url"),
      deviceName: e.deviceName, pairedAt: e.pairedAt,
    }));
    const tmp = `${this.path}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try { writeSync(fd, JSON.stringify(out, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
  }
  contains(pub: Uint8Array): boolean {
    const hex = Buffer.from(pub).toString("hex");
    return this.entries.some((e) => Buffer.from(e.devicePub).toString("hex") === hex);
  }
  get(pub: Uint8Array): AllowlistEntry | undefined {
    const hex = Buffer.from(pub).toString("hex");
    return this.entries.find((e) => Buffer.from(e.devicePub).toString("hex") === hex);
  }
  add(e: AllowlistEntry): void {
    if (this.contains(e.devicePub)) return;
    this.entries.push(e);
    this.persist();
  }
  remove(pub: Uint8Array): void {
    const hex = Buffer.from(pub).toString("hex");
    this.entries = this.entries.filter((e) => Buffer.from(e.devicePub).toString("hex") !== hex);
    this.persist();
  }
  list(): AllowlistEntry[] { return [...this.entries]; }
}
```

- [ ] **Step 6: Implement `apps/radius/daemon/src/pairing.ts`**

```ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "./crypto/primitives.js";

interface PendingToken { tokenHash: string; expiresAt: number; }

function path(appSupportDir: string): string {
  mkdirSync(appSupportDir, { recursive: true, mode: 0o700 });
  return join(appSupportDir, "pairings-pending.json");
}
function load(p: string): PendingToken[] {
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as PendingToken[];
}
function save(p: string, t: PendingToken[]): void {
  writeFileSync(p, JSON.stringify(t, null, 2), { mode: 0o600 });
}

export interface IssueOptions { ttlMs?: number; }
export interface IssuedToken { token: string; tokenHash: string; expiresAt: number; }

export function issuePairingToken(appSupportDir: string, opts: IssueOptions = {}): IssuedToken {
  const ttl = opts.ttlMs ?? 5 * 60 * 1000;
  const raw = randomBytes(32);
  const token = Buffer.from(raw).toString("base64url"); // 43 chars
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + ttl;
  const p = path(appSupportDir);
  const pending = load(p);
  // GC expired
  const now = Date.now();
  const fresh = pending.filter((t) => t.expiresAt > now);
  fresh.push({ tokenHash, expiresAt });
  save(p, fresh);
  return { token, tokenHash, expiresAt };
}

export function consumePairingToken(appSupportDir: string, presentedToken: string): boolean {
  const p = path(appSupportDir);
  const tokenHash = createHash("sha256").update(presentedToken).digest("hex");
  const pending = load(p);
  const now = Date.now();
  const idx = pending.findIndex((t) => t.tokenHash === tokenHash && t.expiresAt > now);
  if (idx === -1) return false;
  pending.splice(idx, 1);
  save(p, pending);
  return true;
}

export interface PairingUrlInput {
  token: string; srvPub: Uint8Array; host: string; port: number;
  ips: string[]; name: string; expiresAt: number;
}
export function buildPairingUrl(i: PairingUrlInput): string {
  const fp = createHash("sha256").update(i.srvPub).digest("hex");
  const payload = {
    v: 1, name: i.name, host: i.host, port: i.port, ips: i.ips,
    srvPub: Buffer.from(i.srvPub).toString("base64url"),
    fp, tok: i.token, exp: Math.floor(i.expiresAt / 1000), relay: null,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `radius://pair?p=${b64}`;
}

export function parsePairingUrl(url: string): PairingUrlInput & { srvPubB64: string } {
  if (!url.startsWith("radius://pair?p=")) throw new Error("not a radius pairing URL");
  const b64 = url.slice("radius://pair?p=".length);
  const o = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  return {
    token: o.tok, srvPub: new Uint8Array(Buffer.from(o.srvPub, "base64url")),
    host: o.host, port: o.port, ips: o.ips, name: o.name, expiresAt: o.exp * 1000,
    srvPubB64: o.srvPub,
  };
}
```

- [ ] **Step 7: Implement `apps/radius/daemon/src/bonjour.ts`**

```ts
import { Bonjour } from "bonjour-service";
import { createHash } from "node:crypto";

export interface AnnounceInput { srvPub: Uint8Array; serviceName: string; port: number; }

export function announceBonjour(i: AnnounceInput): { stop: () => void } {
  const bonjour = new Bonjour();
  const idBytes = createHash("sha256").update(i.srvPub).digest();
  const id = Buffer.from(idBytes).toString("base64url"); // 43 chars
  // DNS-SD TXT entries are per-key length-prefixed strings ≤ 255 bytes each. Cap name at 180B UTF-8.
  const nameBytes = Buffer.from(i.serviceName, "utf8");
  const name = nameBytes.length > 180
    ? Buffer.from(nameBytes.subarray(0, 180)).toString("utf8") + "…"
    : i.serviceName;

  const service = bonjour.publish({
    name: i.serviceName,
    type: "radius",
    protocol: "tcp",
    port: i.port,
    txt: { v: "1", id, name },
  });

  return {
    stop: () => {
      service.stop?.();
      bonjour.destroy();
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run pairing`
Expected: all pairing/identity/allowlist tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/radius/daemon/src/config.ts apps/radius/daemon/src/identity.ts apps/radius/daemon/src/allowlist.ts apps/radius/daemon/src/pairing.ts apps/radius/daemon/src/bonjour.ts apps/radius/daemon/test/pairing.test.ts
git commit -m "feat(radius/daemon): identity, allowlist, pairing tokens, Bonjour announce"
```

---

### Task 9: LF-strict stdio reader (Pi RPC framing)

Pi's docs (`docs/pi/docs/rpc.md`) explicitly warn against Node `readline` for U+2028 / U+2029. We write our own splitter and test it against that exact case.

**Files:**
- Create: `apps/radius/daemon/src/pi-rpc/lf-reader.ts`
- Create: `apps/radius/daemon/test/lf-reader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { Readable } from "node:stream";
import { LFReader } from "../src/pi-rpc/lf-reader.js";

async function collect(r: Readable, on: (lines: string[]) => void): Promise<void> {
  const reader = new LFReader();
  for await (const chunk of r) {
    const lines = reader.feed(chunk as Buffer);
    if (lines.length) on(lines);
  }
  const tail = reader.flush();
  if (tail.length) on(tail);
}

describe("LFReader", () => {
  test("splits on LF only", async () => {
    const data = Buffer.from('{"a":1}\n{"b":2}\n{"c":3}\n');
    const out: string[] = [];
    await collect(Readable.from(data), (lines) => out.push(...lines));
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  test("strips a trailing CR before LF (CRLF tolerance)", async () => {
    const data = Buffer.from('{"a":1}\r\n{"b":2}\n');
    const out: string[] = [];
    await collect(Readable.from(data), (lines) => out.push(...lines));
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("does NOT split on U+2028 inside a JSON string", async () => {
    // U+2028 in UTF-8 is 0xE2 0x80 0xA8
    const payload = '{"text":"line\u2028continues"}\n';
    const out: string[] = [];
    await collect(Readable.from(Buffer.from(payload, "utf8")), (lines) => out.push(...lines));
    expect(out.length).toBe(1);
    expect(JSON.parse(out[0]!).text).toBe("line\u2028continues");
  });

  test("does NOT split on U+2029 inside a JSON string", async () => {
    const payload = '{"text":"line\u2029continues"}\n';
    const out: string[] = [];
    await collect(Readable.from(Buffer.from(payload, "utf8")), (lines) => out.push(...lines));
    expect(out.length).toBe(1);
    expect(JSON.parse(out[0]!).text).toBe("line\u2029continues");
  });

  test("handles chunks split mid-record", async () => {
    const out: string[] = [];
    const r = new LFReader();
    r.feed(Buffer.from('{"a":1')).forEach((l) => out.push(l));
    r.feed(Buffer.from(',"b":2}\n{"c":')).forEach((l) => out.push(l));
    r.feed(Buffer.from("3}\n")).forEach((l) => out.push(l));
    expect(out).toEqual(['{"a":1,"b":2}', '{"c":3}']);
  });

  test("flush returns any unterminated trailing data", () => {
    const r = new LFReader();
    expect(r.feed(Buffer.from("trailing-no-LF"))).toEqual([]);
    expect(r.flush()).toEqual(["trailing-no-LF"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run lf-reader`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 3: Implement `apps/radius/daemon/src/pi-rpc/lf-reader.ts`**

```ts
/**
 * LF-strict line splitter for Pi RPC mode (docs/pi/docs/rpc.md "Framing").
 * Splits only on byte 0x0A ('\n'). Strips trailing 0x0D ('\r') for CRLF tolerance.
 * Does NOT split on U+2028 / U+2029 — those are valid bytes inside JSON strings.
 */
export class LFReader {
  private buf = Buffer.alloc(0);

  feed(chunk: Buffer): string[] {
    this.buf = this.buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buf, chunk]);
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i] === 0x0a) {
        let end = i;
        if (end > start && this.buf[end - 1] === 0x0d) end -= 1;
        lines.push(this.buf.subarray(start, end).toString("utf8"));
        start = i + 1;
      }
    }
    this.buf = this.buf.subarray(start);
    return lines;
  }

  flush(): string[] {
    if (this.buf.length === 0) return [];
    const out = this.buf.toString("utf8");
    this.buf = Buffer.alloc(0);
    return [out];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run lf-reader`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/pi-rpc/lf-reader.ts apps/radius/daemon/test/lf-reader.test.ts
git commit -m "feat(radius/daemon): LF-strict stdio reader (Pi RPC framing)"
```

---

### Task 10: Pi RPC child + supervisor state machine

Wraps a Pi process: spawn, write commands, read events, lifecycle state machine from spec §5.6.1.

**Files:**
- Create: `apps/radius/daemon/src/pi-rpc/child.ts`
- Create: `apps/radius/daemon/src/pi-rpc/supervisor.ts`
- Create: `apps/radius/daemon/test/fixtures/fake-pi-child.ts`
- Create: `apps/radius/daemon/test/supervisor.test.ts`

- [ ] **Step 1: Write `apps/radius/daemon/test/fixtures/fake-pi-child.ts`**

```ts
import { EventEmitter } from "node:events";

/**
 * A scripted Pi RPC stand-in. Emits the line sequence supplied by tests and
 * records every command written to it.
 */
export class FakePiChild extends EventEmitter {
  public stdinLines: string[] = [];
  public alive = true;
  private scripted: string[] = [];

  script(events: object[]): void {
    this.scripted.push(...events.map((e) => JSON.stringify(e)));
  }

  // Begin emitting events after `start()`.
  start(): void {
    queueMicrotask(() => {
      for (const line of this.scripted) this.emit("event", JSON.parse(line));
      this.scripted = [];
    });
  }

  // Called by supervisor to send a command.
  send(cmd: object): void {
    this.stdinLines.push(JSON.stringify(cmd));
  }

  kill(): void {
    this.alive = false;
    this.emit("exit", { code: 0, signal: null });
  }
}
```

- [ ] **Step 2: Write the failing test for the state machine**

```ts
// apps/radius/daemon/test/supervisor.test.ts
import { describe, expect, test, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor, SupervisorState } from "../src/pi-rpc/supervisor.js";
import { FakePiChild } from "./fixtures/fake-pi-child.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "radius-sup-")); });

describe("Supervisor state machine", () => {
  test("idle_no_child → starting → running on prompt", async () => {
    const fake = new FakePiChild();
    const sup = new Supervisor({ cwd: dir, sessionPath: join(dir, "s.jsonl"), spawn: () => fake });
    expect(sup.state).toBe(SupervisorState.IdleNoChild);

    const promise = sup.prompt({ text: "hello", devicePub: new Uint8Array(32) });
    expect(sup.state).toBe(SupervisorState.Starting);

    // Fake child emits its first event indicating readiness
    fake.script([{ type: "agent_start" }]);
    fake.start();
    await promise;
    expect(sup.state).toBe(SupervisorState.Running);
  });

  test("steer against IdleNoChild errors with controller_locked", async () => {
    const fake = new FakePiChild();
    const sup = new Supervisor({ cwd: dir, sessionPath: join(dir, "s.jsonl"), spawn: () => fake });
    await expect(sup.steer({ text: "x", devicePub: new Uint8Array(32) })).rejects.toThrow(/controller_locked/);
  });

  test("steer from non-controller while running errors with controller_locked", async () => {
    const fake = new FakePiChild();
    const sup = new Supervisor({ cwd: dir, sessionPath: join(dir, "s.jsonl"), spawn: () => fake });
    const controller = new Uint8Array(32).fill(0xaa);
    const stranger = new Uint8Array(32).fill(0xbb);
    fake.script([{ type: "agent_start" }]);
    fake.start();
    await sup.prompt({ text: "hello", devicePub: controller });
    expect(sup.activeControllerDevicePub).toEqual(controller);
    await expect(sup.steer({ text: "x", devicePub: stranger })).rejects.toThrow(/controller_locked/);
  });

  test("abort by any subscriber transitions to grace then back to running on next prompt", async () => {
    const fake = new FakePiChild();
    const sup = new Supervisor({ cwd: dir, sessionPath: join(dir, "s.jsonl"), spawn: () => fake });
    const ctrl = new Uint8Array(32).fill(0xaa);
    const stranger = new Uint8Array(32).fill(0xbb);

    fake.script([{ type: "agent_start" }]);
    fake.start();
    await sup.prompt({ text: "hi", devicePub: ctrl });
    expect(sup.state).toBe(SupervisorState.Running);

    fake.emit("event", { type: "agent_end", messages: [] });
    expect(sup.state).toBe(SupervisorState.Grace);

    // Stranger may abort; here we just check stranger can re-prompt now (grace is open)
    fake.script([{ type: "agent_start" }]);
    await sup.prompt({ text: "again", devicePub: stranger });
    expect(sup.state).toBe(SupervisorState.Running);
    expect(sup.activeControllerDevicePub).toEqual(stranger);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run supervisor`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 4: Implement `apps/radius/daemon/src/pi-rpc/child.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { LFReader } from "./lf-reader.js";

export interface SpawnPiChildInput { cwd: string; sessionPath: string; piBin?: string; }

export interface PiChild extends EventEmitter {
  send(cmd: object): void;
  kill(): void;
  alive: boolean;
}

class RealPiChild extends EventEmitter implements PiChild {
  alive = true;
  private proc: ChildProcessWithoutNullStreams;
  private reader = new LFReader();

  constructor(i: SpawnPiChildInput) {
    super();
    const piBin = i.piBin ?? "pi";
    this.proc = spawn(piBin, ["--mode", "rpc", "--session", i.sessionPath], {
      cwd: i.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of this.reader.feed(chunk)) {
        try { this.emit("event", JSON.parse(line)); }
        catch (e) { this.emit("malformed", line, e); }
      }
    });
    this.proc.stderr.on("data", (chunk: Buffer) => this.emit("stderr", chunk.toString("utf8")));
    this.proc.on("exit", (code, signal) => {
      this.alive = false;
      this.emit("exit", { code, signal });
    });
  }

  send(cmd: object): void {
    if (!this.alive) throw new Error("Pi child is not alive");
    this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
  }

  kill(): void {
    if (!this.alive) return;
    this.proc.kill("SIGTERM");
    setTimeout(() => { if (this.alive) this.proc.kill("SIGKILL"); }, 5000).unref();
  }
}

export function spawnPiChild(i: SpawnPiChildInput): PiChild {
  return new RealPiChild(i);
}
```

- [ ] **Step 5: Implement `apps/radius/daemon/src/pi-rpc/supervisor.ts`**

```ts
import { EventEmitter } from "node:events";
import type { PiChild } from "./child.js";

export const SupervisorState = {
  IdleNoChild: "idle_no_child",
  Starting: "starting",
  Running: "running",
  Grace: "grace",
  Stopping: "stopping",
} as const;
export type SupervisorState = (typeof SupervisorState)[keyof typeof SupervisorState];

export interface SupervisorInput {
  cwd: string;
  sessionPath: string;
  spawn: () => PiChild;
  graceMs?: number;
}

export interface ControlInput { text: string; devicePub: Uint8Array; }

interface PendingPrompt {
  resolve: () => void;
  reject: (e: Error) => void;
  text: string;
  devicePub: Uint8Array;
}

export class Supervisor extends EventEmitter {
  state: SupervisorState = SupervisorState.IdleNoChild;
  activeControllerDevicePub: Uint8Array | null = null;
  private child: PiChild | null = null;
  private pending: PendingPrompt | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private cmdSeq = 0;

  constructor(private i: SupervisorInput) { super(); }

  private samePub(a: Uint8Array | null, b: Uint8Array): boolean {
    if (!a) return false;
    return Buffer.from(a).toString("hex") === Buffer.from(b).toString("hex");
  }

  private startChild(): PiChild {
    const ch = this.i.spawn();
    ch.on("event", (e: any) => this.onEvent(e));
    ch.on("exit", () => this.onChildExit());
    return ch;
  }

  private onChildExit(): void {
    this.child = null;
    this.activeControllerDevicePub = null;
    this.clearGrace();
    this.state = SupervisorState.IdleNoChild;
    this.emit("child_exited");
    if (this.pending) {
      this.pending.reject(new Error("rpc_child_exited"));
      this.pending = null;
    }
  }

  private onEvent(e: { type: string }): void {
    this.emit("pi_event", e);
    switch (e.type) {
      case "agent_start": {
        if (this.state === SupervisorState.Starting && this.pending) {
          this.state = SupervisorState.Running;
          const p = this.pending; this.pending = null;
          p.resolve();
        }
        break;
      }
      case "agent_end": {
        this.state = SupervisorState.Grace;
        this.scheduleGrace();
        break;
      }
    }
  }

  private scheduleGrace(): void {
    this.clearGrace();
    this.graceTimer = setTimeout(() => {
      if (this.state === SupervisorState.Grace && this.child) {
        this.state = SupervisorState.Stopping;
        this.child.kill();
      }
    }, this.i.graceMs ?? 60_000);
    this.graceTimer.unref?.();
  }
  private clearGrace(): void {
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
  }

  async prompt(c: ControlInput): Promise<void> {
    this.clearGrace();
    if (this.state === SupervisorState.IdleNoChild) {
      this.child = this.startChild();
      this.state = SupervisorState.Starting;
      this.activeControllerDevicePub = c.devicePub;
      return new Promise((resolve, reject) => {
        this.pending = { resolve, reject, text: c.text, devicePub: c.devicePub };
        const id = `req-${++this.cmdSeq}`;
        this.child!.send({ id, type: "prompt", message: c.text });
      });
    }
    if (this.state === SupervisorState.Grace) {
      this.state = SupervisorState.Running;
      this.activeControllerDevicePub = c.devicePub;
      const id = `req-${++this.cmdSeq}`;
      this.child!.send({ id, type: "prompt", message: c.text });
      return Promise.resolve();
    }
    if (this.state === SupervisorState.Running) {
      // Re-prompt while running = steer-like; for MVP require explicit steer/follow_up
      throw new Error("controller_locked: cannot prompt while running; use steer");
    }
    throw new Error(`prompt rejected in state ${this.state}`);
  }

  async steer(c: ControlInput): Promise<void> {
    if (this.state !== SupervisorState.Running) {
      throw new Error("controller_locked: no active run to steer");
    }
    if (!this.samePub(this.activeControllerDevicePub, c.devicePub)) {
      throw new Error("controller_locked: only the active controller may steer");
    }
    const id = `req-${++this.cmdSeq}`;
    this.child!.send({ id, type: "steer", message: c.text });
  }

  async abort(by: Uint8Array): Promise<void> {
    if (this.state === SupervisorState.Running && this.child) {
      const id = `req-${++this.cmdSeq}`;
      this.child.send({ id, type: "abort" });
      this.emit("aborted_by", by);
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run supervisor`
Expected: all 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/radius/daemon/src/pi-rpc/child.ts apps/radius/daemon/src/pi-rpc/supervisor.ts apps/radius/daemon/test/fixtures/fake-pi-child.ts apps/radius/daemon/test/supervisor.test.ts
git commit -m "feat(radius/daemon): Pi RPC child supervisor with state machine"
```

---

### Task 11: LiveStateStore

Accumulates `currentAssistantPartial`, `activeToolCall`, queue, pending UI requests by replaying Pi events from spec §5.6.4.

**Files:**
- Create: `apps/radius/daemon/src/session/live-state.ts`
- Create: `apps/radius/daemon/test/live-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { LiveStateStore } from "../src/session/live-state.js";

describe("LiveStateStore", () => {
  test("initial snapshot is idle", () => {
    const s = new LiveStateStore();
    const snap = s.snapshot();
    expect(snap.runStatus).toBe("idle");
    expect(snap.currentAssistantPartial).toBeNull();
    expect(snap.activeToolCall).toBeNull();
    expect(snap.queue).toEqual([]);
  });

  test("accumulates text_delta into currentAssistantPartial", () => {
    const s = new LiveStateStore();
    s.applyPiEvent({ type: "agent_start" });
    s.applyPiEvent({ type: "message_start", message: {} });
    s.applyPiEvent({ type: "message_update", message: {},
      assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: {} } });
    s.applyPiEvent({ type: "message_update", message: {},
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello ", partial: {} } });
    s.applyPiEvent({ type: "message_update", message: {},
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "world", partial: {} } });
    expect(s.snapshot().currentAssistantPartial).toBe("Hello world");
    expect(s.snapshot().runStatus).toBe("streaming");
  });

  test("text_end clears partial (entry committed)", () => {
    const s = new LiveStateStore();
    s.applyPiEvent({ type: "agent_start" });
    s.applyPiEvent({ type: "message_update", message: {},
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "abc", partial: {} } });
    s.applyPiEvent({ type: "message_update", message: {},
      assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "abc", partial: {} } });
    expect(s.snapshot().currentAssistantPartial).toBeNull();
  });

  test("tool_execution_start / update / end populate activeToolCall and clear on end", () => {
    const s = new LiveStateStore();
    s.applyPiEvent({ type: "agent_start" });
    s.applyPiEvent({ type: "tool_execution_start", toolCall: { callId: "c1", toolName: "bash", args: { cmd: "ls" } } });
    expect(s.snapshot().runStatus).toBe("blocked_on_tool");
    expect(s.snapshot().activeToolCall?.toolName).toBe("bash");
    s.applyPiEvent({ type: "tool_execution_update", callId: "c1", chunk: "file1.txt\n" });
    s.applyPiEvent({ type: "tool_execution_update", callId: "c1", chunk: "file2.txt\n" });
    expect(s.snapshot().activeToolCall?.partialResult).toBe("file1.txt\nfile2.txt\n");
    s.applyPiEvent({ type: "tool_execution_end", callId: "c1", result: "file1.txt\nfile2.txt\n" });
    expect(s.snapshot().activeToolCall).toBeNull();
    expect(s.snapshot().runStatus).toBe("streaming");
  });

  test("queue_update populates queue", () => {
    const s = new LiveStateStore();
    s.applyPiEvent({ type: "queue_update", queue: [{ kind: "steer", text: "go left" }] });
    expect(s.snapshot().queue).toHaveLength(1);
    expect(s.snapshot().queue[0]!.text).toBe("go left");
  });

  test("agent_end resets to idle but keeps queue + clears partial", () => {
    const s = new LiveStateStore();
    s.applyPiEvent({ type: "agent_start" });
    s.applyPiEvent({ type: "message_update", message: {},
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "...", partial: {} } });
    s.applyPiEvent({ type: "agent_end", messages: [] });
    const snap = s.snapshot();
    expect(snap.runStatus).toBe("idle");
    expect(snap.currentAssistantPartial).toBeNull();
    expect(snap.activeToolCall).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run live-state`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 3: Implement `apps/radius/daemon/src/session/live-state.ts`**

```ts
export type RunStatus = "idle" | "starting" | "streaming" | "blocked_on_tool" | "blocked_on_ui" | "grace";

export interface ActiveToolCall {
  callId: string; toolName: string; args: unknown;
  partialResult: string; startedAt: string;
}
export interface QueueItem { kind: "steer" | "follow_up"; text: string; }
export interface PendingExtensionUiRequest {
  requestId: string; kind: "select" | "confirm" | "input" | "editor";
  prompt: string; options?: unknown; timeoutAt: string;
}

export interface LiveSnapshot {
  runStatus: RunStatus;
  activeControllerDevicePub: string | null;
  activeControllerDeviceName: string | null;
  currentAssistantPartial: string | null;
  activeToolCall: ActiveToolCall | null;
  queue: QueueItem[];
  pendingExtensionUiRequest: PendingExtensionUiRequest | null;
}

export class LiveStateStore {
  private runStatus: RunStatus = "idle";
  private partials = new Map<number, string>();
  private activeToolCall: ActiveToolCall | null = null;
  private queue: QueueItem[] = [];
  private pendingUI: PendingExtensionUiRequest | null = null;

  applyPiEvent(e: any): void {
    switch (e.type) {
      case "agent_start": this.runStatus = "streaming"; break;
      case "agent_end":
        this.runStatus = "idle";
        this.partials.clear();
        this.activeToolCall = null;
        break;
      case "message_start": this.partials.clear(); break;
      case "message_update": this.handleMessageUpdate(e); break;
      case "message_end":
        this.partials.clear();
        break;
      case "tool_execution_start":
        this.activeToolCall = {
          callId: e.toolCall?.callId ?? e.callId,
          toolName: e.toolCall?.toolName ?? e.toolName,
          args: e.toolCall?.args ?? e.args,
          partialResult: "",
          startedAt: new Date().toISOString(),
        };
        this.runStatus = "blocked_on_tool";
        break;
      case "tool_execution_update":
        if (this.activeToolCall && this.activeToolCall.callId === e.callId) {
          this.activeToolCall.partialResult += String(e.chunk ?? "");
        }
        break;
      case "tool_execution_end":
        if (this.activeToolCall && this.activeToolCall.callId === e.callId) {
          this.activeToolCall = null;
        }
        this.runStatus = "streaming";
        break;
      case "queue_update":
        this.queue = (e.queue ?? []).map((q: any) => ({ kind: q.kind, text: q.text }));
        break;
    }
  }

  private handleMessageUpdate(e: any): void {
    const ev = e.assistantMessageEvent;
    if (!ev) return;
    const idx: number = ev.contentIndex ?? 0;
    switch (ev.type) {
      case "text_start":
        this.partials.set(idx, "");
        break;
      case "text_delta":
        this.partials.set(idx, (this.partials.get(idx) ?? "") + String(ev.delta ?? ""));
        break;
      case "text_end":
        this.partials.delete(idx);
        break;
      // thinking and toolcall deltas are ignored for live partial text
    }
  }

  setRunStatus(s: RunStatus): void { this.runStatus = s; }
  setQueue(q: QueueItem[]): void { this.queue = q; }
  setPendingUI(p: PendingExtensionUiRequest | null): void { this.pendingUI = p; }

  snapshot(): LiveSnapshot {
    const parts = [...this.partials.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    const joined = parts.join("");
    return {
      runStatus: this.runStatus,
      activeControllerDevicePub: null,
      activeControllerDeviceName: null,
      currentAssistantPartial: joined.length > 0 ? joined : null,
      activeToolCall: this.activeToolCall,
      queue: [...this.queue],
      pendingExtensionUiRequest: this.pendingUI,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run live-state`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/session/live-state.ts apps/radius/daemon/test/live-state.test.ts
git commit -m "feat(radius/daemon): LiveStateStore accumulating Pi events into snapshot"
```

---

### Task 12: SessionAttacher (open_session) — JSONL delta + live snapshot

Implements spec §5.6.3 unified attach primitive.

**Files:**
- Create: `apps/radius/daemon/src/session/jsonl.ts`
- Create: `apps/radius/daemon/src/session/attacher.ts`
- Create: `apps/radius/daemon/test/fixtures/sample-sessions/branch-A.jsonl`
- Create: `apps/radius/daemon/test/attacher.test.ts`

- [ ] **Step 1: Create a sample session JSONL fixture**

`apps/radius/daemon/test/fixtures/sample-sessions/branch-A.jsonl`:
```
{"id":"00000001","parentId":null,"type":"user_message","text":"hi"}
{"id":"00000002","parentId":"00000001","type":"assistant_message","text":"hello"}
{"id":"00000003","parentId":"00000002","type":"user_message","text":"continue"}
{"id":"00000004","parentId":"00000003","type":"assistant_message","text":"sure"}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/radius/daemon/test/attacher.test.ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionAttacher } from "../src/session/attacher.js";
import { LiveStateStore } from "../src/session/live-state.js";

const sessionPath = join(__dirname, "fixtures/sample-sessions/branch-A.jsonl");

describe("SessionAttacher.openSession", () => {
  test("first-time open with no lastEntryId returns full branch", async () => {
    const live = new LiveStateStore();
    const att = new SessionAttacher(() => live);
    const out = await att.openSession({ sessionPath });
    expect(out.delta?.entries).toHaveLength(4);
    expect(out.delta?.fullReload).toBe(false);
    expect(out.leafEntryId).toBe("00000004");
    expect(out.branchPath).toEqual(["00000001","00000002","00000003","00000004"]);
    expect(out.liveState.runStatus).toBe("idle");
  });

  test("delta from a known lastEntryId returns only newer entries", async () => {
    const live = new LiveStateStore();
    const att = new SessionAttacher(() => live);
    const out = await att.openSession({ sessionPath, lastEntryId: "00000002" });
    expect(out.delta?.entries).toHaveLength(2);
    expect(out.delta?.entries.map((e: any) => e.id)).toEqual(["00000003","00000004"]);
    expect(out.delta?.fullReload).toBe(false);
  });

  test("unknown lastEntryId triggers fullReload", async () => {
    const live = new LiveStateStore();
    const att = new SessionAttacher(() => live);
    const out = await att.openSession({ sessionPath, lastEntryId: "deadbeef" });
    expect(out.delta?.fullReload).toBe(true);
    expect(out.delta?.entries).toHaveLength(4);
  });

  test("mismatched branchPathHash triggers fullReload", async () => {
    const live = new LiveStateStore();
    const att = new SessionAttacher(() => live);
    const out = await att.openSession({
      sessionPath, lastEntryId: "00000002",
      leafEntryId: "00000004", branchPathHash: "wrong-hash",
    });
    expect(out.delta?.fullReload).toBe(true);
  });

  test("liveState reflects current LiveStateStore", async () => {
    const live = new LiveStateStore();
    live.applyPiEvent({ type: "agent_start" });
    live.applyPiEvent({ type: "message_update", message: {},
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "streaming...", partial: {} }});
    const att = new SessionAttacher(() => live);
    const out = await att.openSession({ sessionPath });
    expect(out.liveState.runStatus).toBe("streaming");
    expect(out.liveState.currentAssistantPartial).toBe("streaming...");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w @radius/daemon -- --run attacher`
Expected: tests fail with `Cannot find module`.

- [ ] **Step 4: Implement `apps/radius/daemon/src/session/jsonl.ts`**

```ts
import { readFileSync } from "node:fs";

export interface SessionEntry {
  id: string;
  parentId: string | null;
  type: string;
  [k: string]: unknown;
}

/**
 * Reads a Pi session JSONL into the array of entries in file order. LF only.
 */
export function readSessionEntries(path: string): SessionEntry[] {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  return lines.map((l) => JSON.parse(l) as SessionEntry);
}

/**
 * Given the entries (file order), build the active branch path by walking
 * from the last entry up via parentId chains.
 */
export function activeBranchPath(entries: SessionEntry[]): string[] {
  if (entries.length === 0) return [];
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const leaf = entries[entries.length - 1]!;
  const path: string[] = [];
  let cursor: SessionEntry | undefined = leaf;
  while (cursor) {
    path.unshift(cursor.id);
    if (!cursor.parentId) break;
    cursor = byId.get(cursor.parentId);
  }
  return path;
}

import { createHash } from "node:crypto";
export function hashBranchPath(path: string[]): string {
  return createHash("sha256").update(path.join("|")).digest("hex");
}
```

- [ ] **Step 5: Implement `apps/radius/daemon/src/session/attacher.ts`**

```ts
import { activeBranchPath, hashBranchPath, readSessionEntries, type SessionEntry } from "./jsonl.js";
import type { LiveStateStore, LiveSnapshot } from "./live-state.js";
import { randomUUID } from "node:crypto";

export interface OpenSessionInput {
  sessionPath: string;
  lastEntryId?: string;
  leafEntryId?: string;
  branchPathHash?: string;
}

export interface SessionDelta {
  entries: SessionEntry[];
  newLeafEntryId: string;
  fullReload: boolean;
}

export interface OpenSessionResult {
  sessionId: string;
  leafEntryId: string;
  branchPath: string[];
  model: string;
  delta: SessionDelta | null;
  liveState: LiveSnapshot;
}

export class SessionAttacher {
  constructor(private liveStateFor: (sessionPath: string) => LiveStateStore) {}

  async openSession(i: OpenSessionInput): Promise<OpenSessionResult> {
    const entries = readSessionEntries(i.sessionPath);
    const branch = activeBranchPath(entries);
    const leaf = branch[branch.length - 1] ?? "";
    const branchSet = new Set(branch);

    const branchHash = hashBranchPath(branch);
    const branchHashMismatch = i.branchPathHash !== undefined && i.branchPathHash !== branchHash;

    let delta: SessionDelta | null;
    if (entries.length === 0) {
      delta = null;
    } else if (!i.lastEntryId) {
      // First-time open: return full branch
      const branchEntries = entries.filter((e) => branchSet.has(e.id));
      delta = { entries: branchEntries, newLeafEntryId: leaf, fullReload: false };
    } else if (!branchSet.has(i.lastEntryId) || branchHashMismatch) {
      const branchEntries = entries.filter((e) => branchSet.has(e.id));
      delta = { entries: branchEntries, newLeafEntryId: leaf, fullReload: true };
    } else {
      const branchEntries = entries.filter((e) => branchSet.has(e.id));
      const cut = branchEntries.findIndex((e) => e.id === i.lastEntryId);
      const newer = branchEntries.slice(cut + 1);
      delta = { entries: newer, newLeafEntryId: leaf, fullReload: false };
    }

    const liveState = this.liveStateFor(i.sessionPath).snapshot();

    return {
      sessionId: randomUUID(),
      leafEntryId: leaf,
      branchPath: branch,
      model: "default",
      delta,
      liveState,
    };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w @radius/daemon -- --run attacher`
Expected: all 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/radius/daemon/src/session/jsonl.ts apps/radius/daemon/src/session/attacher.ts apps/radius/daemon/test/fixtures/sample-sessions/ apps/radius/daemon/test/attacher.test.ts
git commit -m "feat(radius/daemon): SessionAttacher (open_session) with branch-aware delta"
```

---

### Task 13: WebSocket server + envelope + connection state

Stitches transport: accept WS, run handshake, then app frames carrying JSON envelope.

**Files:**
- Create: `apps/radius/daemon/src/envelope.ts`
- Create: `apps/radius/daemon/src/ws-server.ts`

This task does not have a unit test of its own — it's wiring. The end-to-end test in Task 14 covers it.

- [ ] **Step 1: Implement `apps/radius/daemon/src/envelope.ts`**

```ts
export type RequestEnvelope = { id: string; type: "request"; method: string; params: unknown };
export type ResponseEnvelope = { id: string; type: "response"; ok: true; result: unknown }
  | { id: string; type: "response"; ok: false; error: { code: string; message: string; details?: unknown } };
export type EventEnvelope = { id: string; type: "event"; topic: string; sessionPath?: string; data: unknown };

export type AnyEnvelope = RequestEnvelope | ResponseEnvelope | EventEnvelope;

export function isRequest(e: AnyEnvelope): e is RequestEnvelope { return e.type === "request"; }
export function isResponse(e: AnyEnvelope): e is ResponseEnvelope { return e.type === "response"; }
export function isEvent(e: AnyEnvelope): e is EventEnvelope { return e.type === "event"; }
```

- [ ] **Step 2: Implement `apps/radius/daemon/src/ws-server.ts`**

```ts
import { WebSocketServer, type WebSocket } from "ws";
import { EventEmitter } from "node:events";
import {
  buildAuthWelcome, handleAuthHello, handlePairHello, buildPairWelcome,
  sealAppFrame, openAppFrame,
} from "./crypto/handshake.js";
import { FrameType, decodeFrameHeader } from "./crypto/frame.js";
import { Allowlist } from "./allowlist.js";
import { consumePairingToken } from "./pairing.js";
import type { Identity } from "./identity.js";
import { createHash, randomUUID } from "node:crypto";
import { randomBytes } from "./crypto/primitives.js";
import type { AnyEnvelope, RequestEnvelope } from "./envelope.js";

export interface WsServerInput {
  port: number;
  identity: Identity;
  allowlist: Allowlist;
  appSupportDir: string;
  serverName: string;
}

export interface Connection {
  id: string;
  devicePub: Uint8Array;
  send(env: AnyEnvelope): void;
  close(code: number, reason?: string): void;
  on(ev: "request", h: (r: RequestEnvelope, c: Connection) => void): void;
  on(ev: "close", h: () => void): void;
}

class ConnState extends EventEmitter implements Connection {
  id = randomUUID();
  devicePub!: Uint8Array;
  private kAppC2S!: Uint8Array;
  private kAppS2C!: Uint8Array;
  private rxCounter = -1;
  private txCounter = 0;
  private td = new TextDecoder();
  private te = new TextEncoder();

  constructor(private ws: WebSocket, private srvPub: Uint8Array) { super(); }

  initApp(devicePub: Uint8Array, kC2S: Uint8Array, kS2C: Uint8Array): void {
    this.devicePub = devicePub;
    this.kAppC2S = kC2S;
    this.kAppS2C = kS2C;
  }

  onAppFrame(wire: Uint8Array): void {
    try {
      const opened = openAppFrame({ wire, key: this.kAppC2S, lastCounter: this.rxCounter });
      this.rxCounter = opened.counter;
      const json = JSON.parse(this.td.decode(opened.plaintext)) as AnyEnvelope;
      if (json.type === "request") this.emit("request", json, this);
    } catch (e) {
      this.close(4003, `frame: ${(e as Error).message}`);
    }
  }

  send(env: AnyEnvelope): void {
    const pt = this.te.encode(JSON.stringify(env));
    const wire = sealAppFrame({ senderPub: this.srvPub, key: this.kAppS2C, counter: this.txCounter++, plaintext: pt });
    this.ws.send(wire);
  }

  close(code: number, reason?: string): void { this.ws.close(code, reason); }
}

export class WsServer extends EventEmitter {
  private wss: WebSocketServer;
  constructor(private i: WsServerInput) {
    super();
    this.wss = new WebSocketServer({ port: i.port });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  private onConnection(ws: WebSocket): void {
    let state: ConnState | null = null;
    ws.on("message", (data) => {
      const wire = data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(Buffer.from(data as ArrayBuffer));
      const header = (() => { try { return decodeFrameHeader(wire); } catch { return null; } })();
      if (!header) { ws.close(4003, "bad frame"); return; }
      if (state) { state.onAppFrame(wire); return; }
      switch (header.frameType) {
        case FrameType.PairHello: this.handlePair(ws, wire); break;
        case FrameType.AuthHello: state = this.handleAuth(ws, wire); break;
        default: ws.close(4003, "unexpected frame in initial state");
      }
    });
    ws.on("close", () => { state?.emit("close"); });
  }

  private handlePair(ws: WebSocket, wire: Uint8Array): void {
    let out;
    try { out = handlePairHello({ wire, srvSk: this.i.identity.srvSk }); }
    catch { ws.close(4001, "bad pair_hello"); return; }
    const token = out.token;
    if (!consumePairingToken(this.i.appSupportDir, token)) { ws.close(4004, "bad token"); return; }
    if (this.i.allowlist.contains(out.devicePub)) { ws.close(4001, "already paired"); return; }
    this.i.allowlist.add({ devicePub: out.devicePub, deviceName: out.deviceName, pairedAt: Date.now() });
    const serverId = createHash("sha256").update(this.i.identity.srvPub).digest("base64url");
    const welcome = buildPairWelcome({
      srvPub: this.i.identity.srvPub, srvSk: this.i.identity.srvSk,
      ephPub: out.ephPub, serverId, serverName: this.i.serverName,
    });
    ws.send(welcome);
    ws.close(1000, "pair complete");
  }

  private handleAuth(ws: WebSocket, wire: Uint8Array): ConnState | null {
    let out;
    try { out = handleAuthHello({ wire, srvSk: this.i.identity.srvSk }); }
    catch { ws.close(4001, "bad auth_hello"); return null; }
    if (!this.i.allowlist.contains(out.devicePub)) { ws.close(4001, "unpaired"); return null; }
    const sc = randomBytes(32);
    const sessionId = randomUUID();
    const { wire: welcomeWire, kAppC2S, kAppS2C } = buildAuthWelcome({
      srvPub: this.i.identity.srvPub, srvSk: this.i.identity.srvSk,
      devicePub: out.devicePub, clientChallenge: out.clientChallenge, serverChallenge: sc, sessionId,
    });
    ws.send(welcomeWire);
    const state = new ConnState(ws, this.i.identity.srvPub);
    state.initApp(out.devicePub, kAppC2S, kAppS2C);
    this.emit("authenticated", state);
    return state;
  }

  close(): void { this.wss.close(); }
}
```

- [ ] **Step 3: Compile-check**

Run: `npm run typecheck -w @radius/daemon`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/radius/daemon/src/envelope.ts apps/radius/daemon/src/ws-server.ts
git commit -m "feat(radius/daemon): WebSocket transport with pair/auth + app-frame envelope"
```

---

### Task 14: Dispatch + integration smoke test

Wires the request router (`open_session`, `prompt`, `steer`, `abort`, `list_sessions`) and adds the first end-to-end test that drives the server through an in-process client.

**Files:**
- Create: `apps/radius/daemon/src/dispatch.ts`
- Create: `apps/radius/daemon/src/index.ts` (overwrite the placeholder)
- Create: `apps/radius/daemon/test/integration-loopback.test.ts`

- [ ] **Step 1: Implement `apps/radius/daemon/src/dispatch.ts`**

```ts
import type { Connection } from "./ws-server.js";
import type { RequestEnvelope } from "./envelope.js";
import { SessionAttacher, type OpenSessionInput } from "./session/attacher.js";
import { LiveStateStore } from "./session/live-state.js";
import { Supervisor } from "./pi-rpc/supervisor.js";
import { spawnPiChild } from "./pi-rpc/child.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface SessionRecord { liveState: LiveStateStore; supervisor: Supervisor; sessionPath: string; }

export class Dispatcher {
  private sessions = new Map<string, SessionRecord>();
  private attacher = new SessionAttacher((sp) => this.ensure(sp).liveState);

  constructor(private cwd: string) {}

  private ensure(sessionPath: string): SessionRecord {
    let rec = this.sessions.get(sessionPath);
    if (!rec) {
      const liveState = new LiveStateStore();
      const supervisor = new Supervisor({
        cwd: this.cwd,
        sessionPath,
        spawn: () => spawnPiChild({ cwd: this.cwd, sessionPath }),
      });
      supervisor.on("pi_event", (e: any) => liveState.applyPiEvent(e));
      rec = { liveState, supervisor, sessionPath };
      this.sessions.set(sessionPath, rec);
    }
    return rec;
  }

  async handle(req: RequestEnvelope, conn: Connection): Promise<void> {
    try {
      const result = await this.route(req, conn);
      conn.send({ id: req.id, type: "response", ok: true, result });
    } catch (e) {
      const err = e as Error;
      conn.send({
        id: req.id, type: "response", ok: false,
        error: { code: err.message.split(":")[0] || "internal", message: err.message },
      });
    }
  }

  private async route(req: RequestEnvelope, conn: Connection): Promise<unknown> {
    const p = req.params as any;
    switch (req.method) {
      case "list_sessions":
        return { sessions: this.listSessions() };
      case "open_session": {
        const rec = this.ensure(p.sessionPath);
        rec.supervisor.on("pi_event", (e: any) => {
          conn.send({ id: `evt-${Date.now()}`, type: "event", topic: "session_event", sessionPath: p.sessionPath, data: e });
        });
        return this.attacher.openSession(p as OpenSessionInput);
      }
      case "prompt":
        await this.ensure(p.sessionPath).supervisor.prompt({ text: p.text, devicePub: conn.devicePub });
        return { ok: true };
      case "steer":
        await this.ensure(p.sessionPath).supervisor.steer({ text: p.text, devicePub: conn.devicePub });
        return { ok: true };
      case "abort":
        await this.ensure(p.sessionPath).supervisor.abort(conn.devicePub);
        return { ok: true };
      default:
        throw new Error(`unknown_method: ${req.method}`);
    }
  }

  private listSessions(): { path: string; lastTouched: number }[] {
    const out: { path: string; lastTouched: number }[] = [];
    try {
      for (const name of readdirSync(this.cwd)) {
        if (!name.endsWith(".jsonl")) continue;
        const p = join(this.cwd, name);
        out.push({ path: p, lastTouched: statSync(p).mtimeMs });
      }
    } catch { /* ignore */ }
    return out.sort((a, b) => b.lastTouched - a.lastTouched);
  }
}
```

- [ ] **Step 2: Overwrite `apps/radius/daemon/src/index.ts`**

```ts
import { parseArgs } from "node:util";
import { defaultConfig } from "./config.js";
import { loadOrCreateIdentity } from "./identity.js";
import { Allowlist } from "./allowlist.js";
import { announceBonjour } from "./bonjour.js";
import { WsServer } from "./ws-server.js";
import { Dispatcher } from "./dispatch.js";
import { issuePairingToken, buildPairingUrl } from "./pairing.js";
import { networkInterfaces, hostname } from "node:os";
import { createHash } from "node:crypto";

function activeIPs(): string[] {
  const out: string[] = [];
  for (const ifs of Object.values(networkInterfaces())) {
    for (const i of ifs ?? []) {
      if (i.internal) continue;
      if (i.family === "IPv4" || i.family === "IPv6") out.push(i.address);
    }
  }
  return out;
}

const { values } = parseArgs({
  options: {
    cwd: { type: "string" },
    port: { type: "string" },
    name: { type: "string" },
    "issue-token": { type: "boolean" },
  },
});

const cfg = defaultConfig();
if (values.cwd) cfg.cwd = values.cwd;
if (values.port) cfg.port = Number(values.port);
if (values.name) cfg.serviceName = values.name;

const id = loadOrCreateIdentity(cfg.appSupportDir);
const allowlist = new Allowlist(cfg.appSupportDir);
const fp = createHash("sha256").update(id.srvPub).digest("hex");
console.log(`[radius-daemon] starting. srvPub fp=${fp.slice(0, 16)}…`);
console.log(`[radius-daemon] cwd=${cfg.cwd} port=${cfg.port} name=${cfg.serviceName}`);

const ws = new WsServer({
  port: cfg.port, identity: id, allowlist,
  appSupportDir: cfg.appSupportDir, serverName: cfg.serviceName,
});
const dispatch = new Dispatcher(cfg.cwd);
ws.on("authenticated", (conn: any) => {
  conn.on("request", (req: any) => dispatch.handle(req, conn));
});

const bonjour = announceBonjour({ srvPub: id.srvPub, serviceName: cfg.serviceName, port: cfg.port });
console.log(`[radius-daemon] mDNS announced as _radius._tcp`);

if (values["issue-token"]) {
  const t = issuePairingToken(cfg.appSupportDir);
  const url = buildPairingUrl({
    token: t.token, srvPub: id.srvPub, host: hostname(), port: cfg.port,
    ips: activeIPs(), name: cfg.serviceName, expiresAt: t.expiresAt,
  });
  console.log(`[radius-daemon] pairing URL (one-time, 5 min):\n${url}\n`);
}

process.on("SIGINT", () => { console.log("\n[radius-daemon] shutting down"); bonjour.stop(); ws.close(); process.exit(0); });
process.on("SIGTERM", () => { bonjour.stop(); ws.close(); process.exit(0); });
```

- [ ] **Step 3: Write loopback integration test**

```ts
// apps/radius/daemon/test/integration-loopback.test.ts
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateIdentity } from "../src/identity.js";
import { Allowlist } from "../src/allowlist.js";
import { WsServer } from "../src/ws-server.js";
import { issuePairingToken } from "../src/pairing.js";
import { WebSocket } from "ws";
import { buildAuthHello, buildPairHello, handleAuthWelcome, handlePairWelcome, sealAppFrame, openAppFrame } from "../src/crypto/handshake.js";
import { randomBytes, x25519DiffieHellman } from "../src/crypto/primitives.js";
import { generateKeyPairSync } from "node:crypto";

function genKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    pub: new Uint8Array(Buffer.from((publicKey.export({ format: "jwk" }) as any).x, "base64url")),
    priv: new Uint8Array(Buffer.from((privateKey.export({ format: "jwk" }) as any).d, "base64url")),
  };
}

describe("daemon WS loopback (pair + auth + open_session)", () => {
  let dir: string;
  let server: WsServer;
  let port: number;
  let allowlist: Allowlist;
  let id: ReturnType<typeof loadOrCreateIdentity>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "radius-int-"));
    id = loadOrCreateIdentity(dir);
    allowlist = new Allowlist(dir);
    port = 18000 + Math.floor(Math.random() * 1000);
    server = new WsServer({ port, identity: id, allowlist, appSupportDir: dir, serverName: "test" });
    await new Promise((r) => setTimeout(r, 100)); // wait for listen
  });
  afterAll(() => { server.close(); });

  test("pair then auth then open_session round-trip", async () => {
    // 1. Issue a token (simulating QR generation)
    const tok = issuePairingToken(dir);

    // 2. Phone creates ephemeral + device keypairs
    const eph = genKeypair();
    const device = genKeypair();

    // 3. WS connect for pairing
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => ws1.once("open", r));
    const helloWire = buildPairHello({
      ephPub: eph.pub, ephSk: eph.priv, srvPub: id.srvPub,
      token: tok.token, devicePub: device.pub, deviceName: "TestPhone",
    });
    ws1.send(helloWire);
    const welcomeWire = await new Promise<Buffer>((r) => ws1.once("message", (d) => r(d as Buffer)));
    const welcome = handlePairWelcome({ wire: new Uint8Array(welcomeWire), ephSk: eph.priv, srvPub: id.srvPub });
    expect(welcome.serverName).toBe("test");
    await new Promise((r) => ws1.once("close", r));

    // 4. New WS connect for auth
    const ws2 = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => ws2.once("open", r));
    const cc = randomBytes(32);
    const authHelloWire = buildAuthHello({
      devicePub: device.pub, deviceSk: device.priv, srvPub: id.srvPub, clientChallenge: cc,
    });
    ws2.send(authHelloWire);
    const awWire = await new Promise<Buffer>((r) => ws2.once("message", (d) => r(d as Buffer)));
    const aw = handleAuthWelcome({
      wire: new Uint8Array(awWire), deviceSk: device.priv, srvPub: id.srvPub, clientChallenge: cc,
    });

    // 5. Send open_session request as an app frame
    const req = { id: "req-1", type: "request", method: "list_sessions", params: {} };
    const reqWire = sealAppFrame({
      senderPub: device.pub, key: aw.kAppC2S, counter: 0,
      plaintext: new TextEncoder().encode(JSON.stringify(req)),
    });
    ws2.send(reqWire);
    const respWire = await new Promise<Buffer>((r) => ws2.once("message", (d) => r(d as Buffer)));
    const opened = openAppFrame({ wire: new Uint8Array(respWire), key: aw.kAppS2C, lastCounter: -1 });
    const resp = JSON.parse(new TextDecoder().decode(opened.plaintext));
    expect(resp.id).toBe("req-1");
    expect(resp.ok).toBe(true);

    ws2.close();
  }, 15000);
});
```

- [ ] **Step 4: Run the integration test**

Run: `npm run test -w @radius/daemon -- --run integration-loopback`
Expected: test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/daemon/src/dispatch.ts apps/radius/daemon/src/index.ts apps/radius/daemon/test/integration-loopback.test.ts
git commit -m "feat(radius/daemon): request dispatch + end-to-end loopback test"
```

---

# Phase 2 — CLI test client

The CLI lives at `apps/radius/cli`. It uses the daemon's source modules directly (workspace dep) so we don't duplicate crypto.

### Task 15: CLI scaffolding

**Files:**
- Create: `apps/radius/cli/package.json`
- Create: `apps/radius/cli/tsconfig.json`
- Create: `apps/radius/cli/src/index.ts`
- Modify: `package.json` (root) — add `apps/radius/cli` to `workspaces`

- [ ] **Step 1: Create `apps/radius/cli/package.json`**

```json
{
  "name": "@radius/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@radius/daemon": "*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Create `apps/radius/cli/tsconfig.json`**

```json
{
  "extends": "../daemon/tsconfig.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `apps/radius/cli/src/index.ts` (entry stub)**

```ts
import { pairCommand } from "./pair.js";
import { connectCommand } from "./connect.js";

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "pair": await pairCommand(rest); break;
  case "connect": await connectCommand(rest); break;
  default:
    console.log("usage: radius-cli pair <pairing-url>");
    console.log("       radius-cli connect <store-name> [--prompt <text>]");
    process.exit(1);
}
```

- [ ] **Step 4: Add to root workspaces**

Open root `package.json`, append `apps/radius/cli` to the workspaces array:

```json
  "workspaces": [
    "packages/*",
    "apps/radius/daemon",
    "apps/radius/cli"
  ],
```

Run: `npm install`

- [ ] **Step 5: Commit**

```bash
git add apps/radius/cli/ package.json package-lock.json
git commit -m "feat(radius/cli): scaffold CLI test client workspace"
```

---

### Task 16: CLI pair command

**Files:**
- Create: `apps/radius/cli/src/store.ts`
- Create: `apps/radius/cli/src/pair.ts`

- [ ] **Step 1: Implement `apps/radius/cli/src/store.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredDevice {
  name: string;            // CLI-side alias for this paired Mac
  serverId: string;
  srvPub: string;          // base64url
  host: string;
  port: number;
  ips: string[];
  devicePub: string;       // base64url
  deviceSk: string;        // base64url
  serverName: string;
}

const dir = join(homedir(), ".radius-cli");
mkdirSync(dir, { recursive: true });
const path = join(dir, "devices.json");

function load(): Record<string, StoredDevice> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, StoredDevice>;
}
function save(o: Record<string, StoredDevice>): void {
  writeFileSync(path, JSON.stringify(o, null, 2), { mode: 0o600 });
}

export function putDevice(d: StoredDevice): void { const o = load(); o[d.name] = d; save(o); }
export function getDevice(name: string): StoredDevice | undefined { return load()[name]; }
export function listDevices(): StoredDevice[] { return Object.values(load()); }
```

- [ ] **Step 2: Implement `apps/radius/cli/src/pair.ts`**

```ts
import { WebSocket } from "ws";
import { generateKeyPairSync } from "node:crypto";
import { buildPairHello, handlePairWelcome } from "@radius/daemon/src/crypto/handshake.js";
import { parsePairingUrl } from "@radius/daemon/src/pairing.js";
import { putDevice } from "./store.js";

function genKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    pub: new Uint8Array(Buffer.from((publicKey.export({ format: "jwk" }) as any).x, "base64url")),
    priv: new Uint8Array(Buffer.from((privateKey.export({ format: "jwk" }) as any).d, "base64url")),
  };
}

export async function pairCommand(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) { console.error("usage: radius-cli pair <pairing-url>"); process.exit(1); }
  const offer = parsePairingUrl(url);
  console.log(`Pairing to ${offer.name} at ${offer.host}:${offer.port}`);

  const eph = genKeypair();
  const device = genKeypair();
  const ws = new WebSocket(`ws://${offer.host}:${offer.port}`);
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", (e) => rej(e));
  });

  const helloWire = buildPairHello({
    ephPub: eph.pub, ephSk: eph.priv, srvPub: offer.srvPub,
    token: offer.token, devicePub: device.pub, deviceName: "Radius CLI",
  });
  ws.send(helloWire);

  const welcomeBuf = await new Promise<Buffer>((res) => ws.once("message", (d) => res(d as Buffer)));
  const welcome = handlePairWelcome({ wire: new Uint8Array(welcomeBuf), ephSk: eph.priv, srvPub: offer.srvPub });

  const alias = offer.name.toLowerCase().replace(/\W+/g, "-").replace(/^-+|-+$/g, "");
  putDevice({
    name: alias,
    serverId: welcome.serverId,
    serverName: welcome.serverName,
    srvPub: Buffer.from(offer.srvPub).toString("base64url"),
    host: offer.host, port: offer.port, ips: offer.ips,
    devicePub: Buffer.from(device.pub).toString("base64url"),
    deviceSk: Buffer.from(device.priv).toString("base64url"),
  });
  console.log(`Paired. Stored as alias '${alias}'.`);
  ws.close();
}
```

- [ ] **Step 3: Smoke test the pair command manually**

In one terminal:
```bash
cd apps/radius/daemon
rm -rf "$HOME/Library/Application Support/Radius"  # start fresh
npm run start -- --cwd "$(mktemp -d)" --issue-token
```
Copy the printed `radius://pair?...` URL.

In a second terminal:
```bash
cd apps/radius/cli
rm -rf "$HOME/.radius-cli"
npm run start -- pair 'radius://pair?p=...'   # paste URL
```
Expected: prints `Paired. Stored as alias 'radius-on-this-mac'.` Daemon log shows allowlist mutation. `~/.radius-cli/devices.json` exists with the device.

- [ ] **Step 4: Commit**

```bash
git add apps/radius/cli/src/pair.ts apps/radius/cli/src/store.ts
git commit -m "feat(radius/cli): pair command using paste-link"
```

---

### Task 17: CLI connect + prompt (streaming)

**Files:**
- Create: `apps/radius/cli/src/connect.ts`

- [ ] **Step 1: Implement `apps/radius/cli/src/connect.ts`**

```ts
import { WebSocket } from "ws";
import { parseArgs } from "node:util";
import {
  buildAuthHello, handleAuthWelcome, sealAppFrame, openAppFrame,
} from "@radius/daemon/src/crypto/handshake.js";
import { randomBytes } from "@radius/daemon/src/crypto/primitives.js";
import { getDevice } from "./store.js";

export async function connectCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { prompt: { type: "string" }, "session-path": { type: "string" } },
  });
  const alias = positionals[0];
  if (!alias) { console.error("usage: radius-cli connect <alias> [--prompt <text>] [--session-path <p>]"); process.exit(1); }
  const dev = getDevice(alias);
  if (!dev) { console.error(`no device named '${alias}'`); process.exit(1); }

  const srvPub = new Uint8Array(Buffer.from(dev.srvPub, "base64url"));
  const devicePub = new Uint8Array(Buffer.from(dev.devicePub, "base64url"));
  const deviceSk = new Uint8Array(Buffer.from(dev.deviceSk, "base64url"));

  const ws = new WebSocket(`ws://${dev.host}:${dev.port}`);
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", (e) => rej(e)); });

  const cc = randomBytes(32);
  ws.send(buildAuthHello({ devicePub, deviceSk, srvPub, clientChallenge: cc }));

  const awBuf = await new Promise<Buffer>((res) => ws.once("message", (d) => res(d as Buffer)));
  const aw = handleAuthWelcome({ wire: new Uint8Array(awBuf), deviceSk, srvPub, clientChallenge: cc });
  console.log(`Authenticated. sessionId=${aw.sessionId}`);

  let rxCounter = -1, txCounter = 0;
  const te = new TextEncoder(); const td = new TextDecoder();
  ws.on("message", (d) => {
    const opened = openAppFrame({ wire: new Uint8Array(d as Buffer), key: aw.kAppS2C, lastCounter: rxCounter });
    rxCounter = opened.counter;
    const env = JSON.parse(td.decode(opened.plaintext));
    if (env.type === "event" && env.topic === "session_event") {
      const e = env.data;
      if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
        process.stdout.write(e.assistantMessageEvent.delta ?? "");
      }
      if (e.type === "agent_end") { console.log("\n[agent_end]"); ws.close(); }
    } else if (env.type === "response") {
      if (!env.ok) console.error("[response error]", env.error);
    }
  });

  const send = (req: any) => {
    const wire = sealAppFrame({ senderPub: devicePub, key: aw.kAppC2S, counter: txCounter++, plaintext: te.encode(JSON.stringify(req)) });
    ws.send(wire);
  };

  const sessionPath = values["session-path"] ?? "default.jsonl";
  send({ id: "open-1", type: "request", method: "open_session", params: { sessionPath } });
  if (values.prompt) {
    send({ id: "prompt-1", type: "request", method: "prompt", params: { sessionPath, text: values.prompt } });
  }
}
```

- [ ] **Step 2: End-to-end smoke test against real Pi**

In one terminal (daemon, leave running):
```bash
cd apps/radius/daemon
TEST_CWD=$(mktemp -d)
npm run start -- --cwd "$TEST_CWD"
```

In another terminal (CLI client):
```bash
cd apps/radius/cli
SESSION_PATH="$TEST_CWD/test-session.jsonl"
npm run start -- connect radius-on-this-mac --session-path "$SESSION_PATH" --prompt "Write a haiku about LAN cables."
```

Expected: streaming text appears in the second terminal, ending with `[agent_end]`. The daemon spawns a real `pi --mode rpc` process. (Requires a working LLM provider API key in env.)

If the prompt times out or errors, check daemon stderr for Pi child errors. Verify Pi works standalone first: `pi -p "hello"`.

- [ ] **Step 3: Commit**

```bash
git add apps/radius/cli/src/connect.ts
git commit -m "feat(radius/cli): connect + prompt with streaming text output"
```

---

# Phase 3 — iOS thin slice

By the end of Phase 3, an iOS app on a real iPhone discovers the Mac via Bonjour, pairs against a paste-link, authenticates, sends a prompt, and shows streaming text. No QR scanner, no chat history, no file viewer, no settings.

### Task 18: Xcode project (via xcodegen)

**Files:**
- Create: `apps/radius/ios/project.yml`
- Create: `apps/radius/ios/Sources/Info.plist`
- Create: `apps/radius/ios/Sources/RadiusApp.swift`
- Create: `apps/radius/ios/README.md`

- [ ] **Step 1: Create `apps/radius/ios/project.yml`**

```yaml
name: RadiusForIOS
options:
  bundleIdPrefix: app.radius.mobile
  deploymentTarget:
    iOS: "17.0"
  developmentLanguage: en
settings:
  base:
    SWIFT_VERSION: "5.10"
    DEVELOPMENT_TEAM: ""    # set in Xcode signing UI
    IPHONEOS_DEPLOYMENT_TARGET: "17.0"
targets:
  RadiusForIOS:
    type: application
    platform: iOS
    sources:
      - Sources
    info:
      path: Sources/Info.plist
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: app.radius.mobile
        INFOPLIST_KEY_UILaunchScreen_Generation: "YES"
        INFOPLIST_KEY_UISupportedInterfaceOrientations: "UIInterfaceOrientationPortrait"
  RadiusForIOSTests:
    type: bundle.unit-test
    platform: iOS
    sources: Tests
    dependencies:
      - target: RadiusForIOS
```

- [ ] **Step 2: Create `apps/radius/ios/Sources/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Radius</string>
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
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>app.radius.mobile.pair</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>radius</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
```

- [ ] **Step 3: Create `apps/radius/ios/Sources/RadiusApp.swift`**

```swift
import SwiftUI

@main
struct RadiusApp: App {
    @State private var appState = AppState()
    var body: some Scene {
        WindowGroup {
            RootView().environment(appState)
        }
    }
}

struct RootView: View {
    @Environment(AppState.self) private var state
    var body: some View {
        NavigationStack {
            if state.paired == nil {
                DiscoveryView()
            } else {
                HomeView()
            }
        }
    }
}

// Placeholder until State/Views land in later tasks.
@Observable
final class AppState {
    var paired: PairedMac? = nil
}

struct PairedMac { /* filled in Task 21 */ }

struct DiscoveryView: View {
    var body: some View {
        Text("Discovery (Task 19)")
    }
}

struct HomeView: View {
    var body: some View {
        Text("Home (Task 23)")
    }
}
```

- [ ] **Step 4: Create `apps/radius/ios/README.md`**

```markdown
# Radius for iOS — MVP slice

## Generate Xcode project

```bash
brew install xcodegen     # one-time
cd apps/radius/ios
xcodegen generate
open RadiusForIOS.xcodeproj
```

Set the development team in Xcode signing UI before running on a device. Minimum target is iOS 17.

## Run

Build & run on a physical iPhone connected via Lightning/USB-C. Local Network permission prompt should appear on first launch.
```

- [ ] **Step 5: Generate and confirm the project builds**

Run:
```bash
cd apps/radius/ios
xcodegen generate
xcodebuild -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build 2>&1 | tail -20
```
Expected: build succeeds (warnings tolerated).

- [ ] **Step 6: Commit**

```bash
git add apps/radius/ios/project.yml apps/radius/ios/Sources/Info.plist apps/radius/ios/Sources/RadiusApp.swift apps/radius/ios/README.md
git commit -m "feat(radius/ios): scaffold Xcode project via xcodegen"
```

---

### Task 19: Swift crypto module + RFC vector parity tests

**Files:**
- Create: `apps/radius/ios/Sources/Net/Crypto.swift`
- Create: `apps/radius/ios/Tests/CryptoTests.swift`
- Modify: `apps/radius/ios/project.yml` (add Tests dependency)

- [ ] **Step 1: Implement `apps/radius/ios/Sources/Net/Crypto.swift`**

```swift
import CryptoKit
import Foundation

enum RadiusCrypto {
    enum Error: Swift.Error { case wrongLength, allZero, decryptFailed }

    static func x25519(privateKey: Data, publicKey: Data) throws -> Data {
        guard privateKey.count == 32, publicKey.count == 32 else { throw Error.wrongLength }
        let sk = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey)
        let pk = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKey)
        let ss = try sk.sharedSecretFromKeyAgreement(with: pk)
        let raw = ss.withUnsafeBytes { Data($0) }
        // RFC 7748 §7 small-subgroup defence
        if raw.allSatisfy({ $0 == 0 }) { throw Error.allZero }
        return raw
    }

    static func hkdfSHA256(ikm: Data, salt: Data, info: Data, length: Int) -> Data {
        // CryptoKit's HKDF<H>.deriveKey(inputKeyMaterial:salt:info:outputByteCount:)
        let inputKey = SymmetricKey(data: ikm)
        let derived = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: inputKey,
            salt: salt,
            info: info,
            outputByteCount: length
        )
        return derived.withUnsafeBytes { Data($0) }
    }

    static func chaCha20Poly1305Encrypt(key: Data, nonce: Data, aad: Data, plaintext: Data) throws -> (ciphertext: Data, tag: Data) {
        guard key.count == 32, nonce.count == 12 else { throw Error.wrongLength }
        let symKey = SymmetricKey(data: key)
        let nonceObj = try ChaChaPoly.Nonce(data: nonce)
        let sealed = try ChaChaPoly.seal(plaintext, using: symKey, nonce: nonceObj, authenticating: aad)
        // sealed.combined = nonce || ciphertext || tag. We carry the nonce in the frame header,
        // so we return ciphertext+tag as separate fields per spec §5.4.6.
        return (sealed.ciphertext, sealed.tag)
    }

    static func chaCha20Poly1305Decrypt(key: Data, nonce: Data, aad: Data, ciphertext: Data, tag: Data) throws -> Data {
        guard key.count == 32, nonce.count == 12, tag.count == 16 else { throw Error.wrongLength }
        let symKey = SymmetricKey(data: key)
        let nonceObj = try ChaChaPoly.Nonce(data: nonce)
        let box = try ChaChaPoly.SealedBox(nonce: nonceObj, ciphertext: ciphertext, tag: tag)
        return try ChaChaPoly.open(box, using: symKey, authenticating: aad)
    }

    static func randomBytes(_ count: Int) -> Data {
        var out = Data(count: count)
        out.withUnsafeMutableBytes { _ = SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        return out
    }

    // Hex helpers for tests
    static func hex(_ s: String) -> Data {
        var data = Data(capacity: s.count / 2)
        var idx = s.startIndex
        while idx < s.endIndex {
            let next = s.index(idx, offsetBy: 2)
            data.append(UInt8(s[idx..<next], radix: 16)!)
            idx = next
        }
        return data
    }
    static func toHex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
}
```

- [ ] **Step 2: Implement `apps/radius/ios/Tests/CryptoTests.swift`**

```swift
import Testing
import Foundation
@testable import RadiusForIOS

struct CryptoTests {
    @Test func x25519RFCVector() throws {
        // RFC 7748 §6.1
        let aliceSk = RadiusCrypto.hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
        let bobPub  = RadiusCrypto.hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f")
        let expected = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"
        let ss = try RadiusCrypto.x25519(privateKey: aliceSk, publicKey: bobPub)
        #expect(RadiusCrypto.toHex(ss) == expected)
    }

    @Test func hkdfRFCVectorA1() {
        let ikm = RadiusCrypto.hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b")
        let salt = RadiusCrypto.hex("000102030405060708090a0b0c")
        let info = RadiusCrypto.hex("f0f1f2f3f4f5f6f7f8f9")
        let okm = RadiusCrypto.hkdfSHA256(ikm: ikm, salt: salt, info: info, length: 42)
        #expect(RadiusCrypto.toHex(okm) == "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865")
    }

    @Test func chaCha20Poly1305RFCVector() throws {
        let key = RadiusCrypto.hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
        let nonce = RadiusCrypto.hex("070000004041424344454647")
        let aad = RadiusCrypto.hex("50515253c0c1c2c3c4c5c6c7")
        let pt = RadiusCrypto.hex("4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e")
        let (ct, tag) = try RadiusCrypto.chaCha20Poly1305Encrypt(key: key, nonce: nonce, aad: aad, plaintext: pt)
        #expect(RadiusCrypto.toHex(ct) == "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116")
        #expect(RadiusCrypto.toHex(tag) == "1ae10b594f09e26a7e902ecbd0600691")
    }
}
```

- [ ] **Step 3: Re-generate and build tests**

```bash
cd apps/radius/ios
xcodegen generate
xcodebuild test -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -30
```
Expected: 3 tests pass. This validates that **CryptoKit produces byte-identical output to `node:crypto` on the same RFC vectors** — Assumption A.

- [ ] **Step 4: Commit**

```bash
git add apps/radius/ios/Sources/Net/Crypto.swift apps/radius/ios/Tests/CryptoTests.swift
git commit -m "feat(radius/ios): CryptoKit wrappers + RFC vector parity with Node"
```

---

### Task 20: Swift frame codec + handshake

**Files:**
- Create: `apps/radius/ios/Sources/Net/Frame.swift`
- Create: `apps/radius/ios/Sources/Net/Handshake.swift`
- Create: `apps/radius/ios/Tests/FrameTests.swift`

- [ ] **Step 1: Implement `apps/radius/ios/Sources/Net/Frame.swift`**

```swift
import Foundation

enum FrameType: UInt8 {
    case pairHello = 0x01, pairWelcome = 0x02, authHello = 0x03, authWelcome = 0x04, app = 0x05
}

enum FrameError: Error { case tooShort, badType, decryptFailed, counterStale }

struct ParsedFrame { let type: FrameType; let senderPub: Data; let nonce: Data; let plaintext: Data }

enum FrameCodec {
    static let headerLen = 1 + 32 + 12
    static let tagLen = 16

    static func decodeHeader(_ wire: Data) throws -> (type: FrameType, senderPub: Data, nonce: Data, bodyOffset: Int) {
        guard wire.count >= headerLen + tagLen else { throw FrameError.tooShort }
        guard let t = FrameType(rawValue: wire[0]) else { throw FrameError.badType }
        let senderPub = wire.subdata(in: 1..<33)
        let nonce = wire.subdata(in: 33..<45)
        return (t, senderPub, nonce, headerLen)
    }

    static func encode(type: FrameType, senderPub: Data, nonce: Data, key: Data, plaintext: Data) throws -> Data {
        var aad = Data(capacity: 33); aad.append(type.rawValue); aad.append(senderPub)
        let (ct, tag) = try RadiusCrypto.chaCha20Poly1305Encrypt(key: key, nonce: nonce, aad: aad, plaintext: plaintext)
        var out = Data(capacity: headerLen + ct.count + tag.count)
        out.append(type.rawValue); out.append(senderPub); out.append(nonce); out.append(ct); out.append(tag)
        return out
    }

    static func parse(_ wire: Data, key: Data) throws -> ParsedFrame {
        let (t, sender, nonce, body) = try decodeHeader(wire)
        var aad = Data(capacity: 33); aad.append(t.rawValue); aad.append(sender)
        let ctEnd = wire.count - tagLen
        let ct = wire.subdata(in: body..<ctEnd)
        let tag = wire.subdata(in: ctEnd..<wire.count)
        let pt = try RadiusCrypto.chaCha20Poly1305Decrypt(key: key, nonce: nonce, aad: aad, ciphertext: ct, tag: tag)
        return ParsedFrame(type: t, senderPub: sender, nonce: nonce, plaintext: pt)
    }
}
```

- [ ] **Step 2: Implement `apps/radius/ios/Sources/Net/Handshake.swift`**

```swift
import Foundation

enum HKDFInfo {
    static let pairC2S = Data("radius-v1-pair-c2s".utf8)
    static let pairS2C = Data("radius-v1-pair-s2c".utf8)
    static let authC2S = Data("radius-v1-auth-c2s".utf8)
    static let authS2C = Data("radius-v1-auth-s2c".utf8)
    static let appC2S = Data("radius-v1-app-c2s".utf8)
    static let appS2C = Data("radius-v1-app-s2c".utf8)
}

enum RadiusKeys {
    static func pairC2S(ss: Data, nonce: Data) -> Data { RadiusCrypto.hkdfSHA256(ikm: ss, salt: nonce, info: HKDFInfo.pairC2S, length: 32) }
    static func pairS2C(ss: Data, nonce: Data) -> Data { RadiusCrypto.hkdfSHA256(ikm: ss, salt: nonce, info: HKDFInfo.pairS2C, length: 32) }
    static func authC2S(ss: Data, nonce: Data) -> Data { RadiusCrypto.hkdfSHA256(ikm: ss, salt: nonce, info: HKDFInfo.authC2S, length: 32) }
    static func authS2C(ss: Data, nonce: Data) -> Data { RadiusCrypto.hkdfSHA256(ikm: ss, salt: nonce, info: HKDFInfo.authS2C, length: 32) }
    static func appC2S(ss: Data, cc: Data, sc: Data) -> Data {
        var salt = Data(capacity: 64); salt.append(cc); salt.append(sc)
        return RadiusCrypto.hkdfSHA256(ikm: ss, salt: salt, info: HKDFInfo.appC2S, length: 32)
    }
    static func appS2C(ss: Data, cc: Data, sc: Data) -> Data {
        var salt = Data(capacity: 64); salt.append(cc); salt.append(sc)
        return RadiusCrypto.hkdfSHA256(ikm: ss, salt: salt, info: HKDFInfo.appS2C, length: 32)
    }
}

struct PairHelloPayload: Codable { let v: Int; let tok: String; let devicePub: String; let deviceName: String }
struct PairWelcomePayload: Codable { let v: Int; let serverId: String; let serverName: String }
struct AuthHelloPayload: Codable { let v: Int; let protocolVersion: Int; let clientChallenge: String }
struct AuthWelcomePayload: Codable { let v: Int; let protocolVersion: Int; let serverChallenge: String; let sessionId: String }

enum Handshake {
    static func buildPairHello(ephPub: Data, ephSk: Data, srvPub: Data, token: String, devicePub: Data, deviceName: String) throws -> Data {
        let ss = try RadiusCrypto.x25519(privateKey: ephSk, publicKey: srvPub)
        let nonce = RadiusCrypto.randomBytes(12)
        let key = RadiusKeys.pairC2S(ss: ss, nonce: nonce)
        let payload = PairHelloPayload(
            v: 1, tok: token,
            devicePub: devicePub.base64urlEncodedString(),
            deviceName: deviceName)
        let pt = try JSONEncoder().encode(payload)
        return try FrameCodec.encode(type: .pairHello, senderPub: ephPub, nonce: nonce, key: key, plaintext: pt)
    }

    static func handlePairWelcome(wire: Data, ephSk: Data, srvPub: Data) throws -> PairWelcomePayload {
        let (type, sender, _, _) = try FrameCodec.decodeHeader(wire)
        precondition(type == .pairWelcome); precondition(sender == srvPub)
        let ss = try RadiusCrypto.x25519(privateKey: ephSk, publicKey: srvPub)
        let nonce = wire.subdata(in: 33..<45)
        let key = RadiusKeys.pairS2C(ss: ss, nonce: nonce)
        let parsed = try FrameCodec.parse(wire, key: key)
        return try JSONDecoder().decode(PairWelcomePayload.self, from: parsed.plaintext)
    }

    static func buildAuthHello(devicePub: Data, deviceSk: Data, srvPub: Data, clientChallenge: Data) throws -> Data {
        let ss = try RadiusCrypto.x25519(privateKey: deviceSk, publicKey: srvPub)
        let nonce = RadiusCrypto.randomBytes(12)
        let key = RadiusKeys.authC2S(ss: ss, nonce: nonce)
        let payload = AuthHelloPayload(v: 1, protocolVersion: 1, clientChallenge: clientChallenge.base64urlEncodedString())
        let pt = try JSONEncoder().encode(payload)
        return try FrameCodec.encode(type: .authHello, senderPub: devicePub, nonce: nonce, key: key, plaintext: pt)
    }

    static func handleAuthWelcome(wire: Data, deviceSk: Data, srvPub: Data, clientChallenge: Data) throws -> (welcome: AuthWelcomePayload, kAppC2S: Data, kAppS2C: Data) {
        let (type, sender, nonce, _) = try FrameCodec.decodeHeader(wire)
        precondition(type == .authWelcome); precondition(sender == srvPub)
        let ss = try RadiusCrypto.x25519(privateKey: deviceSk, publicKey: srvPub)
        let key = RadiusKeys.authS2C(ss: ss, nonce: nonce)
        let parsed = try FrameCodec.parse(wire, key: key)
        let welcome = try JSONDecoder().decode(AuthWelcomePayload.self, from: parsed.plaintext)
        let sc = Data(base64urlEncoded: welcome.serverChallenge)!
        return (welcome, RadiusKeys.appC2S(ss: ss, cc: clientChallenge, sc: sc), RadiusKeys.appS2C(ss: ss, cc: clientChallenge, sc: sc))
    }

    static func sealApp(senderPub: Data, key: Data, counter: UInt64, plaintext: Data) throws -> Data {
        var nonce = Data(count: 12)
        let random4 = RadiusCrypto.randomBytes(4)
        nonce.replaceSubrange(0..<4, with: random4)
        // 8B big-endian counter at offset 4
        var c = counter.bigEndian
        let counterBytes = withUnsafeBytes(of: &c) { Data($0) }
        nonce.replaceSubrange(4..<12, with: counterBytes)
        return try FrameCodec.encode(type: .app, senderPub: senderPub, nonce: nonce, key: key, plaintext: plaintext)
    }

    static func openApp(wire: Data, key: Data, lastCounter: Int64) throws -> (plaintext: Data, counter: UInt64) {
        let nonce = wire.subdata(in: 33..<45)
        let counter = nonce.subdata(in: 4..<12).withUnsafeBytes { $0.load(as: UInt64.self).bigEndian }
        if Int64(counter) <= lastCounter { throw FrameError.counterStale }
        let parsed = try FrameCodec.parse(wire, key: key)
        return (parsed.plaintext, counter)
    }
}

// Base64url helpers
extension Data {
    func base64urlEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
                              .replacingOccurrences(of: "/", with: "_")
                              .trimmingCharacters(in: CharacterSet(charactersIn: "="))
    }
    init?(base64urlEncoded s: String) {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t.append("=") }
        guard let d = Data(base64Encoded: t) else { return nil }
        self = d
    }
}
```

- [ ] **Step 3: Implement `apps/radius/ios/Tests/FrameTests.swift`**

```swift
import Testing
import Foundation
@testable import RadiusForIOS

struct FrameTests {
    @Test func encodeParseRoundTrip() throws {
        let key = Data(repeating: 0xAA, count: 32)
        let sender = Data(repeating: 0xBB, count: 32)
        let nonce = Data(repeating: 0xCC, count: 12)
        let pt = Data("hello".utf8)
        let wire = try FrameCodec.encode(type: .app, senderPub: sender, nonce: nonce, key: key, plaintext: pt)
        let parsed = try FrameCodec.parse(wire, key: key)
        #expect(parsed.type == .app)
        #expect(parsed.senderPub == sender)
        #expect(parsed.nonce == nonce)
        #expect(parsed.plaintext == pt)
    }
}
```

- [ ] **Step 4: Build and run tests**

```bash
cd apps/radius/ios
xcodegen generate
xcodebuild test -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -10
```
Expected: 4 total tests pass (3 crypto + 1 frame).

- [ ] **Step 5: Commit**

```bash
git add apps/radius/ios/Sources/Net/Frame.swift apps/radius/ios/Sources/Net/Handshake.swift apps/radius/ios/Tests/FrameTests.swift
git commit -m "feat(radius/ios): frame codec + handshake (pair + auth + app)"
```

---

### Task 21: Cross-implementation conformance vector

A small JSON file written by Node, read by Swift tests, asserts byte equality of a complete app frame.

**Files:**
- Create: `apps/radius/daemon/test/cross-impl-vectors.test.ts` (writes `apps/radius/docs/cross-impl-vectors.json`)
- Modify: `apps/radius/ios/Tests/FrameTests.swift` (consume the vectors)

- [ ] **Step 1: Implement the Node generator + verifier**

```ts
// apps/radius/daemon/test/cross-impl-vectors.test.ts
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFrame, FrameType, parseFrame } from "../src/crypto/frame.js";

const docsDir = join(__dirname, "../../docs");

describe("cross-impl vectors", () => {
  test("emit a deterministic app frame fixture for Swift to verify", () => {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key[i] = i;
    const senderPub = new Uint8Array(32);
    for (let i = 0; i < 32; i++) senderPub[i] = 0xa0 | i;
    const nonce = new Uint8Array(12);
    for (let i = 0; i < 12; i++) nonce[i] = 0x70 + i;
    const plaintext = new TextEncoder().encode('{"hello":"world"}');

    const wire = encodeFrame(FrameType.App, senderPub, nonce, key, plaintext);

    // Self round-trip first.
    const parsed = parseFrame(wire, key);
    expect(new TextDecoder().decode(parsed.plaintext)).toBe('{"hello":"world"}');

    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      join(docsDir, "cross-impl-vectors.json"),
      JSON.stringify(
        {
          appFrame: {
            key: Buffer.from(key).toString("hex"),
            senderPub: Buffer.from(senderPub).toString("hex"),
            nonce: Buffer.from(nonce).toString("hex"),
            plaintext: Buffer.from(plaintext).toString("hex"),
            wire: Buffer.from(wire).toString("hex"),
          },
        },
        null,
        2,
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test to emit the fixture**

```bash
npm run test -w @radius/daemon -- --run cross-impl-vectors
```
Expected: test passes. `apps/radius/docs/cross-impl-vectors.json` is created.

- [ ] **Step 3: Add the JSON to the iOS test bundle as a resource**

Edit `apps/radius/ios/project.yml`. Under the `RadiusForIOSTests` target, add:

```yaml
  RadiusForIOSTests:
    type: bundle.unit-test
    platform: iOS
    sources:
      - Tests
    resources:
      - path: ../docs/cross-impl-vectors.json
    dependencies:
      - target: RadiusForIOS
```

- [ ] **Step 4: Extend `apps/radius/ios/Tests/FrameTests.swift` with the cross-impl test**

Append:

```swift
struct CrossImplTests {
    @Test func appFrameByteEqual() throws {
        let url = Bundle(for: TestMarker.self).url(forResource: "cross-impl-vectors", withExtension: "json")!
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let f = json["appFrame"] as! [String: String]
        let key = RadiusCrypto.hex(f["key"]!)
        let senderPub = RadiusCrypto.hex(f["senderPub"]!)
        let nonce = RadiusCrypto.hex(f["nonce"]!)
        let plaintext = RadiusCrypto.hex(f["plaintext"]!)
        let expectedWire = RadiusCrypto.hex(f["wire"]!)
        let actual = try FrameCodec.encode(type: .app, senderPub: senderPub, nonce: nonce, key: key, plaintext: plaintext)
        #expect(actual == expectedWire)
    }
}
// Anchor class so Bundle(for:) can locate the test bundle.
final class TestMarker {}
```

- [ ] **Step 5: Re-generate, run tests, and commit**

```bash
cd apps/radius/ios
xcodegen generate
xcodebuild test -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' 2>&1 | tail -10
```
Expected: 5 total tests pass (3 crypto + 2 frame including cross-impl).

```bash
git add apps/radius/daemon/test/cross-impl-vectors.test.ts apps/radius/docs/cross-impl-vectors.json apps/radius/ios/project.yml apps/radius/ios/Tests/FrameTests.swift
git commit -m "test(radius): cross-impl byte-equality fixture (Node → Swift)"
```

---

### Task 22: WebSocket client + identity persistence

**Files:**
- Create: `apps/radius/ios/Sources/Net/WSClient.swift`
- Create: `apps/radius/ios/Sources/State/Identity.swift`
- Create: `apps/radius/ios/Sources/State/PairedMac.swift`

- [ ] **Step 1: Implement `apps/radius/ios/Sources/Net/WSClient.swift`**

```swift
import Foundation

final class WSClient: NSObject, URLSessionWebSocketDelegate {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    var onOpen: (() -> Void)?
    var onClose: ((Int) -> Void)?
    var onBinary: ((Data) -> Void)?

    func connect(host: String, port: Int) {
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = false
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
        let url = URL(string: "ws://\(host):\(port)/")!
        let req = URLRequest(url: url, timeoutInterval: 10)
        task = session.webSocketTask(with: req)
        task?.resume()
        receive()
    }

    func send(_ data: Data) {
        task?.send(.data(data)) { err in if let e = err { print("ws send error: \(e)") } }
    }

    func close() {
        task?.cancel(with: .normalClosure, reason: nil)
    }

    private func receive() {
        task?.receive { [weak self] result in
            switch result {
            case .failure(let e): print("ws recv error: \(e)"); self?.onClose?(0)
            case .success(let m):
                switch m {
                case .data(let d): self?.onBinary?(d)
                case .string(let s): self?.onBinary?(Data(s.utf8))
                @unknown default: break
                }
                self?.receive()
            }
        }
    }

    func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol p: String?) {
        onOpen?()
    }
    func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        onClose?(code.rawValue)
    }
}
```

- [ ] **Step 2: Implement `apps/radius/ios/Sources/State/PairedMac.swift`**

```swift
import Foundation

struct PairedMac: Codable, Identifiable {
    var id: String { serverId }
    let serverId: String
    let serverName: String
    let srvPubBase64url: String
    let host: String
    let port: Int
    let ips: [String]
    let devicePubBase64url: String
    let deviceSkBase64url: String

    var srvPub: Data { Data(base64urlEncoded: srvPubBase64url)! }
    var devicePub: Data { Data(base64urlEncoded: devicePubBase64url)! }
    var deviceSk: Data { Data(base64urlEncoded: deviceSkBase64url)! }
}
```

- [ ] **Step 3: Implement `apps/radius/ios/Sources/State/Identity.swift`**

```swift
import Foundation
import Security

enum IdentityStore {
    private static let key = "app.radius.mobile.pairedMac"

    static func save(_ mac: PairedMac) throws {
        let data = try JSONEncoder().encode(mac)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemDelete(q as CFDictionary)
        let status = SecItemAdd(q as CFDictionary, nil)
        if status != errSecSuccess { throw NSError(domain: "IdentityStore", code: Int(status)) }
    }

    static func load() -> PairedMac? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
            return try? JSONDecoder().decode(PairedMac.self, from: data)
        }
        return nil
    }

    static func wipe() {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ] as CFDictionary)
    }
}
```

- [ ] **Step 4: Build to verify it compiles**

```bash
cd apps/radius/ios
xcodegen generate
xcodebuild -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/radius/ios/Sources/Net/WSClient.swift apps/radius/ios/Sources/State/Identity.swift apps/radius/ios/Sources/State/PairedMac.swift
git commit -m "feat(radius/ios): WS client + Keychain identity storage"
```

---

### Task 23: AppState + universal-link pair flow + reconnect

Owns: paired Mac state, current connection, observable run state. Handles `radius://pair?p=...` deep-links. Reconnects on foreground via `NWPathMonitor`.

**Files:**
- Create: `apps/radius/ios/Sources/State/AppState.swift` (replace placeholder)
- Modify: `apps/radius/ios/Sources/RadiusApp.swift` (handle `.onOpenURL`)
- Modify: `apps/radius/ios/Sources/Views/DiscoveryView.swift` (paste-link input)

- [ ] **Step 1: Replace `apps/radius/ios/Sources/State/AppState.swift`**

```swift
import Foundation
import Network
import SwiftUI

@Observable
@MainActor
final class AppState {
    var paired: PairedMac? = IdentityStore.load()
    var connection: ConnectionState? = nil
    var streamingText: String = ""
    var status: String = "idle"
    var lastError: String? = nil

    private let pathMonitor = NWPathMonitor()
    private let pathQueue = DispatchQueue(label: "radius.path")

    init() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                if path.status == .satisfied, self?.paired != nil, self?.connection == nil {
                    self?.connect()
                }
            }
        }
        pathMonitor.start(queue: pathQueue)
    }

    func pair(url: URL) async {
        let offer: PairingOffer
        do { offer = try PairingOffer.parse(url) }
        catch { lastError = "Invalid pairing link: \(error)"; return }
        status = "pairing"
        do {
            let mac = try await Pairing.pair(offer: offer)
            try IdentityStore.save(mac)
            paired = mac
            status = "paired"
            connect()
        } catch {
            lastError = "Pair failed: \(error)"
            status = "idle"
        }
    }

    func connect() {
        guard let mac = paired, connection == nil else { return }
        Task {
            do {
                let conn = try await ConnectionState.open(to: mac)
                connection = conn
                status = "connected"
            } catch {
                lastError = "Connect failed: \(error)"
                status = "idle"
            }
        }
    }

    func sendPrompt(_ text: String, sessionPath: String) {
        guard let conn = connection else { return }
        streamingText = ""
        conn.sendPrompt(text: text, sessionPath: sessionPath, onDelta: { [weak self] delta in
            Task { @MainActor in self?.streamingText += delta }
        }, onDone: { [weak self] in
            Task { @MainActor in self?.status = "connected" }
        })
        status = "streaming"
    }

    func unpair() {
        IdentityStore.wipe(); paired = nil; connection = nil; status = "idle"
    }
}
```

- [ ] **Step 2: Implement `apps/radius/ios/Sources/State/PairingOffer.swift`**

```swift
import Foundation

struct PairingOffer {
    let v: Int
    let name: String
    let host: String
    let port: Int
    let ips: [String]
    let srvPub: Data
    let token: String
    let expiresAt: Date

    enum Error: Swift.Error { case badScheme, malformed }

    static func parse(_ url: URL) throws -> PairingOffer {
        guard url.scheme == "radius", url.host == "pair",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let p = comps.queryItems?.first(where: { $0.name == "p" })?.value,
              let data = Data(base64urlEncoded: p) else { throw Error.badScheme }
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        return PairingOffer(
            v: json["v"] as! Int,
            name: json["name"] as! String,
            host: json["host"] as! String,
            port: json["port"] as! Int,
            ips: (json["ips"] as? [String]) ?? [],
            srvPub: Data(base64urlEncoded: json["srvPub"] as! String)!,
            token: json["tok"] as! String,
            expiresAt: Date(timeIntervalSince1970: TimeInterval(json["exp"] as! Int)))
    }
}
```

- [ ] **Step 3: Implement `apps/radius/ios/Sources/State/Pairing.swift`**

```swift
import CryptoKit
import Foundation
import UIKit

enum Pairing {
    static func pair(offer: PairingOffer) async throws -> PairedMac {
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let ephPub = eph.publicKey.rawRepresentation
        let ephSk = eph.rawRepresentation
        let device = Curve25519.KeyAgreement.PrivateKey()
        let devicePub = device.publicKey.rawRepresentation
        let deviceSk = device.rawRepresentation

        let ws = WSClient()
        return try await withCheckedThrowingContinuation { cont in
            var resumed = false
            func once(_ result: Result<PairedMac, Error>) {
                if resumed { return }; resumed = true; cont.resume(with: result)
            }
            ws.onOpen = {
                do {
                    let wire = try Handshake.buildPairHello(
                        ephPub: ephPub, ephSk: ephSk, srvPub: offer.srvPub,
                        token: offer.token, devicePub: devicePub, deviceName: UIDevice.current.name)
                    ws.send(wire)
                } catch { once(.failure(error)) }
            }
            ws.onBinary = { data in
                do {
                    let welcome = try Handshake.handlePairWelcome(wire: data, ephSk: ephSk, srvPub: offer.srvPub)
                    ws.close()
                    let mac = PairedMac(
                        serverId: welcome.serverId, serverName: welcome.serverName,
                        srvPubBase64url: offer.srvPub.base64urlEncodedString(),
                        host: offer.host, port: offer.port, ips: offer.ips,
                        devicePubBase64url: devicePub.base64urlEncodedString(),
                        deviceSkBase64url: deviceSk.base64urlEncodedString())
                    once(.success(mac))
                } catch { once(.failure(error)) }
            }
            ws.onClose = { code in if !resumed { once(.failure(NSError(domain: "Pairing", code: code))) } }
            ws.connect(host: offer.host, port: offer.port)
        }
    }
}
```

- [ ] **Step 4: Implement `apps/radius/ios/Sources/State/ConnectionState.swift`**

```swift
import Foundation

@MainActor
final class ConnectionState: ObservableObject {
    let mac: PairedMac
    private let ws = WSClient()
    private var kAppC2S: Data = Data()
    private var kAppS2C: Data = Data()
    private var rxCounter: Int64 = -1
    private var txCounter: UInt64 = 0
    private var requestId = 0
    private var deltaHandler: ((String) -> Void)? = nil
    private var doneHandler: (() -> Void)? = nil

    private init(mac: PairedMac) { self.mac = mac }

    static func open(to mac: PairedMac) async throws -> ConnectionState {
        let state = ConnectionState(mac: mac)
        try await state.authenticate(mac: mac)
        return state
    }

    private func authenticate(mac: PairedMac) async throws {
        let cc = RadiusCrypto.randomBytes(32)
        return try await withCheckedThrowingContinuation { cont in
            var resumed = false
            func once(_ r: Result<Void, Error>) { if resumed { return }; resumed = true; cont.resume(with: r) }
            ws.onOpen = {
                do {
                    let wire = try Handshake.buildAuthHello(
                        devicePub: mac.devicePub, deviceSk: mac.deviceSk, srvPub: mac.srvPub, clientChallenge: cc)
                    self.ws.send(wire)
                } catch { once(.failure(error)) }
            }
            ws.onBinary = { data in
                do {
                    let (_, c2s, s2c) = try Handshake.handleAuthWelcome(
                        wire: data, deviceSk: mac.deviceSk, srvPub: mac.srvPub, clientChallenge: cc)
                    self.kAppC2S = c2s; self.kAppS2C = s2c
                    // Subsequent messages are app frames; switch handler.
                    self.ws.onBinary = { [weak self] d in self?.handleApp(d) }
                    once(.success(()))
                } catch { once(.failure(error)) }
            }
            ws.onClose = { code in if !resumed { once(.failure(NSError(domain: "Connect", code: code))) } }
            ws.connect(host: mac.host, port: mac.port)
        }
    }

    private func handleApp(_ data: Data) {
        do {
            let (pt, counter) = try Handshake.openApp(wire: data, key: kAppS2C, lastCounter: rxCounter)
            rxCounter = Int64(counter)
            let env = try JSONSerialization.jsonObject(with: pt) as! [String: Any]
            if (env["type"] as? String) == "event" {
                if let d = env["data"] as? [String: Any] {
                    let t = d["type"] as? String
                    if t == "message_update", let ame = d["assistantMessageEvent"] as? [String: Any],
                       (ame["type"] as? String) == "text_delta",
                       let delta = ame["delta"] as? String {
                        deltaHandler?(delta)
                    } else if t == "agent_end" {
                        doneHandler?()
                    }
                }
            }
        } catch { print("frame error: \(error)") }
    }

    private func send(_ obj: [String: Any]) {
        let pt = try! JSONSerialization.data(withJSONObject: obj)
        do {
            let wire = try Handshake.sealApp(senderPub: mac.devicePub, key: kAppC2S, counter: txCounter, plaintext: pt)
            txCounter += 1
            ws.send(wire)
        } catch { print("seal error: \(error)") }
    }

    func sendPrompt(text: String, sessionPath: String, onDelta: @escaping (String) -> Void, onDone: @escaping () -> Void) {
        self.deltaHandler = onDelta
        self.doneHandler = onDone
        requestId += 1
        send(["id": "open-\(requestId)", "type": "request", "method": "open_session", "params": ["sessionPath": sessionPath]])
        requestId += 1
        send(["id": "p-\(requestId)", "type": "request", "method": "prompt", "params": ["sessionPath": sessionPath, "text": text]])
    }

    func abort(sessionPath: String) {
        requestId += 1
        send(["id": "a-\(requestId)", "type": "request", "method": "abort", "params": ["sessionPath": sessionPath]])
    }
}
```

- [ ] **Step 5: Replace `apps/radius/ios/Sources/RadiusApp.swift` to wire onOpenURL**

```swift
import SwiftUI

@main
struct RadiusApp: App {
    @State private var state = AppState()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(state)
                .onOpenURL { url in Task { await state.pair(url: url) } }
        }
    }
}

struct RootView: View {
    @Environment(AppState.self) private var state
    var body: some View {
        if state.paired == nil { DiscoveryView() } else { HomeView() }
    }
}
```

- [ ] **Step 6: Compile-check**

```bash
cd apps/radius/ios
xcodegen generate
xcodebuild -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build 2>&1 | tail -10
```
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/radius/ios/Sources/State/ apps/radius/ios/Sources/RadiusApp.swift
git commit -m "feat(radius/ios): AppState, pairing flow, authenticated WS connection"
```

---

### Task 24: Discovery view (NWBrowser + paste-link)

**Files:**
- Create: `apps/radius/ios/Sources/Net/Discovery.swift`
- Modify: `apps/radius/ios/Sources/Views/DiscoveryView.swift`

- [ ] **Step 1: Implement `apps/radius/ios/Sources/Net/Discovery.swift`**

```swift
import Network

@Observable
@MainActor
final class Discovery {
    var found: [(name: String, host: String, port: Int)] = []
    private var browser: NWBrowser?

    func start() {
        let params = NWParameters()
        params.includePeerToPeer = false
        let browser = NWBrowser(for: .bonjour(type: "_radius._tcp", domain: nil), using: params)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                self?.found = results.compactMap { r in
                    guard case .service(let name, _, _, _) = r.endpoint else { return nil }
                    // NWBrowser doesn't give host directly; resolve when needed via NWConnection.
                    return (name: name, host: "\(name).local", port: 7423)
                }
            }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() { browser?.cancel(); browser = nil; found = [] }
}
```

> The simple `name.local` resolve is correct for unicast mDNS on the same LAN. For corner cases we ship the paste-link fallback below.

- [ ] **Step 2: Replace `apps/radius/ios/Sources/Views/DiscoveryView.swift`**

```swift
import SwiftUI

struct DiscoveryView: View {
    @Environment(AppState.self) private var state
    @State private var discovery = Discovery()
    @State private var pasteText: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Find your Mac").font(.title2.bold())
            Text("Make sure Radius is running on the Mac.")
                .font(.subheadline).foregroundStyle(.secondary)

            if discovery.found.isEmpty {
                ProgressView().padding(.vertical)
                Text("Searching for Radius on this Wi-Fi…").foregroundStyle(.secondary)
            } else {
                ForEach(Array(discovery.found.enumerated()), id: \.offset) { _, m in
                    Button {
                        // Found Macs still need a pairing token; for MVP, ask the user
                        // to paste the link from the daemon terminal. NWBrowser proves discovery works.
                    } label: {
                        HStack {
                            Image(systemName: "macbook")
                            Text(m.name)
                            Spacer()
                            Text("\(m.host):\(m.port)").foregroundStyle(.secondary).font(.caption)
                        }
                    }
                }
            }

            Divider().padding(.vertical, 8)
            Text("Or paste a pairing link").font(.headline)
            TextField("radius://pair?p=…", text: $pasteText, axis: .vertical)
                .textInputAutocapitalization(.never)
                .textFieldStyle(.roundedBorder)
            Button("Pair") {
                if let url = URL(string: pasteText), url.scheme == "radius" {
                    Task { await state.pair(url: url) }
                }
            }.disabled(pasteText.isEmpty)

            if let err = state.lastError {
                Text(err).foregroundStyle(.red).font(.callout)
            }

            Spacer()
        }
        .padding()
        .onAppear { discovery.start() }
        .onDisappear { discovery.stop() }
    }
}
```

- [ ] **Step 3: Compile-check**

```bash
cd apps/radius/ios
xcodegen generate
xcodebuild -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/radius/ios/Sources/Net/Discovery.swift apps/radius/ios/Sources/Views/DiscoveryView.swift
git commit -m "feat(radius/ios): Bonjour discovery + paste-link pair entry"
```

---

### Task 25: Minimal chat view (streaming text)

**Files:**
- Modify: `apps/radius/ios/Sources/Views/HomeView.swift`
- Create: `apps/radius/ios/Sources/Views/ChatView.swift`

- [ ] **Step 1: Replace `apps/radius/ios/Sources/Views/HomeView.swift`**

```swift
import SwiftUI

struct HomeView: View {
    @Environment(AppState.self) private var state
    @State private var sessionPath = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Paired with \(state.paired?.serverName ?? "?")").font(.headline)
            TextField("Session file path on Mac (e.g. /tmp/foo/test.jsonl)", text: $sessionPath)
                .textInputAutocapitalization(.never)
                .textFieldStyle(.roundedBorder)
            NavigationLink("Open chat", value: sessionPath).disabled(sessionPath.isEmpty)
            Spacer()
            Button("Unpair", role: .destructive) { state.unpair() }
        }
        .padding()
        .navigationDestination(for: String.self) { path in ChatView(sessionPath: path) }
    }
}
```

- [ ] **Step 2: Implement `apps/radius/ios/Sources/Views/ChatView.swift`**

```swift
import SwiftUI

struct ChatView: View {
    @Environment(AppState.self) private var state
    let sessionPath: String
    @State private var composer = ""

    var body: some View {
        VStack {
            ScrollView { Text(state.streamingText).frame(maxWidth: .infinity, alignment: .leading).padding() }
            HStack {
                TextField("Ask Pi…", text: $composer, axis: .vertical).textFieldStyle(.roundedBorder)
                Button("Send") {
                    state.sendPrompt(composer, sessionPath: sessionPath)
                    composer = ""
                }.disabled(composer.isEmpty || state.connection == nil)
                Button("Stop") { state.connection?.abort(sessionPath: sessionPath) }
                    .disabled(state.status != "streaming")
            }
            .padding()
        }
        .navigationTitle("Chat").navigationBarTitleDisplayMode(.inline)
        .onAppear { if state.connection == nil { state.connect() } }
    }
}
```

- [ ] **Step 3: Build & manual smoke**

```bash
cd apps/radius/ios
xcodegen generate
xcodebuild -project RadiusForIOS.xcodeproj -scheme RadiusForIOS -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/radius/ios/Sources/Views/HomeView.swift apps/radius/ios/Sources/Views/ChatView.swift
git commit -m "feat(radius/ios): minimal home + streaming chat view"
```

---

# Phase 4 — Manual verification checklist

The unit/integration tests cover what's mechanically testable. This task produces a human-runnable checklist mapping every load-bearing assumption to a concrete repro step on real hardware.

### Task 26: Manual verification checklist

**Files:**
- Create: `apps/radius/docs/manual-verification-checklist.md`

- [ ] **Step 1: Write the checklist document**

````markdown
# Radius MVP — Manual Verification Checklist

Run through each section in order. Tick each box only after the success criterion is observed.
Items in **bold** are the load-bearing assumptions; sub-items are the concrete steps.

## Prerequisites
- Mac running this repo's checkout, on a Wi-Fi network.
- An iPhone on the same Wi-Fi network.
- Xcode-signed install of Radius for iOS on the iPhone (via cable).
- An LLM provider API key configured for Pi (e.g. `ANTHROPIC_API_KEY`).
- `~/Library/Application Support/Radius/` is empty (`rm -rf` if needed for a clean run).
- `~/.radius-cli/` is empty.

---

## A — Crypto interop (Swift ↔ Node)

- [ ] Run `npm run test -w @radius/daemon` — 30+ tests pass, including RFC vectors.
- [ ] Run `xcodebuild test … -scheme RadiusForIOS` — all crypto tests pass.
- [ ] The cross-impl test from Task 21 passes — Swift's `FrameCodec.encode` produces identical bytes to Node's, for the same key/nonce/aad/plaintext.

## B — Pair handshake

- [ ] Start daemon in terminal 1:
      `cd apps/radius/daemon && npm run start -- --cwd "$(mktemp -d)" --issue-token`
- [ ] In terminal 2 (CLI), paste the pair URL: `npm run start -- pair 'radius://pair?...'`
- [ ] CLI prints `Paired. Stored as alias …`.
- [ ] Daemon's `~/Library/Application Support/Radius/allowlist.json` now contains the device entry.

## C — Auth handshake & app-frame envelope (Assumptions C + O)

- [ ] Restart daemon (without `--issue-token`).
- [ ] CLI: `npm run start -- connect <alias>` succeeds and prints `Authenticated. sessionId=…`.
- [ ] No `4001` or `4003` close codes in daemon logs.

## D — Pi RPC LF-strict framing

- [ ] Unit test passes for U+2028 / U+2029 inside JSON strings (`lf-reader.test.ts`).
- [ ] End-to-end streaming below produces non-corrupt text in chats containing line-separator-class characters (try a prompt asking Pi to repeat the literal Unicode escape sequence `\u2028`).

## E — Pi RPC state machine

- [ ] CLI: `connect <alias> --prompt "say hi"` causes daemon to spawn exactly one `pi --mode rpc` child. Verify with `pgrep -af "pi --mode rpc"`.
- [ ] Send a second prompt before the first finishes — daemon returns `controller_locked` (visible in CLI's `[response error]` log).
- [ ] Wait for `[agent_end]`. The Pi child remains running (in `grace`); no second child spawns until the next prompt.

## F — Unified `open_session` returns delta + live snapshot

- [ ] Unit test `attacher.test.ts` passes (5 tests).
- [ ] In CLI: after first prompt completes, reconnect with `connect <alias>` again. The daemon's first `open_session` response includes the previous entries in `delta.entries`.

## G — LiveStateStore accuracy

- [ ] Unit test `live-state.test.ts` passes (6 tests).
- [ ] Manual: start a long prompt ("Write a 200-word essay"). Mid-stream, kill the WS by switching iPhone to airplane mode. Wait 5s. Disable airplane mode. Reopen the chat. `state.streamingText` resumes from the point reached, not from blank.

## H — Branch-aware delta semantics

- [ ] Unit test inside `attacher.test.ts`: "unknown lastEntryId triggers fullReload" passes.
- [ ] Manual (advanced): in a terminal run `pi --resume <session>` and `/fork` to a sibling branch. Reconnect on the phone with stale `lastEntryId`. The next `open_session` returns `fullReload: true`.

## I — Bonjour discovery from iOS

- [ ] Open Radius for iOS on the iPhone. Within 5 seconds, the Discovery view lists the Mac under "Searching…".
- [ ] Hostname matches `*.local`.
- [ ] If discovery does NOT appear after 30s, fall back to paste-link; this is acceptable but worth noting (mark as ⚠️).

## J — iOS Local Network permission UX

- [ ] **First launch** (after fresh install): system prompt appears asking to allow local network access, citing the description string `Radius needs to find your Mac on your local network to chat with Pi.`
- [ ] Tap **Allow** — discovery proceeds.
- [ ] Force-quit, re-launch — no second prompt.
- [ ] Go to Settings → Radius → Local Network → toggle off, return to app — Bonjour list goes empty within 10 seconds.
- [ ] Toggle back on — Bonjour list repopulates.

## K — WebSocket lifecycle across iOS backgrounding

- [ ] Start a streaming prompt. Press Home (background the app) within 1 second of seeing the first token.
- [ ] Wait 10 seconds. Re-foreground the app.
- [ ] Within 3 seconds of foregrounding, the app reconnects automatically (no user action), and the chat view shows the partial stream that was missed.
- [ ] Repeat with 60-second background. Reconnect still succeeds.

## L — End-to-end streaming

- [ ] On the iPhone, paste a pair link (from `--issue-token`), pair, enter session path, send "What's 2+2?".
- [ ] Tokens stream into the chat view incrementally (visible character-by-character or word-by-word).
- [ ] Stream completes; `Stop` button disables.

## M — Reconnect catches up state

- [ ] Send a long prompt. Mid-stream, force-quit the iOS app via app switcher.
- [ ] Re-launch. The chat view should show the entire stream up to the agent's final answer (catch-up via `open_session.liveState.currentAssistantPartial`).

## N — Pairing token single-use

- [ ] Pair successfully with the CLI.
- [ ] Try pairing the iPhone with the **same** URL.
- [ ] iPhone shows pair failure (token already consumed). Daemon logs `4004 bad token`.

## O — Wire format interop (already covered)

- [ ] Cross-impl byte-equality test (Task 21) passes.

---

## Exit criteria

- [ ] **All 15 sections above are checked** OR each unchecked item has a documented reason.
- [ ] No daemon stderr stack traces during normal operation.
- [ ] No 4xx close codes during normal operation.
- [ ] Result summary written to `apps/radius/docs/manual-verification-results.md` with date, network conditions, and any anomalies.

If everything ticks, the v3 design's load-bearing assumptions are validated and we can proceed to expanding the iOS UI and adding the Mac menubar app per spec §10 steps 3-5.
````

- [ ] **Step 2: Commit**

```bash
git add apps/radius/docs/manual-verification-checklist.md
git commit -m "docs(radius): manual verification checklist for MVP"
```

---

## Self-review notes

After completing all 26 tasks, the engineer should:

1. **Re-run the entire test suite** at root: `npm test -w @radius/daemon` — all unit + integration tests pass.
2. **Re-run all iOS tests**: `xcodebuild test -project apps/radius/ios/RadiusForIOS.xcodeproj -scheme RadiusForIOS …` — all crypto + frame + cross-impl tests pass.
3. **Walk through the manual checklist** end-to-end on real hardware.
4. **Write `apps/radius/docs/manual-verification-results.md`** documenting what passed, what didn't, network conditions, and any surprising behaviours.

A passing run of this MVP means:

- Crypto and wire format are interoperable across Swift and Node, byte-for-byte against RFC vectors.
- The unified `open_session` primitive carries enough state to make reconnect a non-event for the user.
- The Pi RPC supervisor state machine prevents the runaway-child failure mode.
- iOS Local Network permission + NWBrowser + URLSessionWebSocketTask backgrounding all work in our actual product context (not theoretically).

Anything that **fails** in Phase 4 is a load-bearing assumption that needs design revision before we build out the rest of the spec.
