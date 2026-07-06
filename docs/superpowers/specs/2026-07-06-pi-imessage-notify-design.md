# pi-imessage: Agent → iMessage Notification Tool — Design

**Date:** 2026-07-06
**Status:** Approved (pending spec review)

## Goal

Give any π agent running on the MacBook Pro a `send_imessage` tool that sends the user a
real iMessage — appearing to come from a dedicated "agent" identity, not from the user's
own account — for notifications like "job done", "input needed", or "build failed".

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Sender identity | Dedicated Apple ID signed into **Messages on the MacBook Air only** (Messages → Settings → iMessage sign-in is independent of the machine's iCloud account). The Air's iCloud stays on the user's own account. |
| Direction | **One-way notify only (MVP).** Two-way replies are a future feature; the design must not preclude them. |
| Transport | HTTP over **Tailscale**. Pro reaches the Air at `http://familyos-server:8787` (MagicDNS; raw Tailscale IP `100.99.196.91` as documented fallback). |
| Consumers | **π agents only (MVP)** via a π custom tool. A CLI wrapper is a trivial future addition since the HTTP API is the universal layer. |
| Message format | `{emoji }{message}` on line 1 (emoji optional, freeform, single space after when present), `[{context}]` on line 2. |
| Secrets | Shared bearer token generated at setup time (`openssl rand -hex 32` equivalent), stored in plain config files with `600` perms on both machines. Keychain/env-var rejected as disproportionate friction for the threat model (token blast radius: someone on the tailnet can send the user an iMessage). |
| Backend build-vs-buy | Custom minimal Node service (Approach 1). BlueBubbles rejected: heavyweight Electron relay ecosystem of which only one endpoint would be used. Typing indicators explicitly out of scope (require SIP-off private-API injection). |

## Architecture

```
MacBook Pro (agents)                    MacBook Air (familyos-server)
┌─────────────────────┐   Tailscale    ┌──────────────────────────────┐
│ π package:          │   HTTP POST    │ imsg-server (Node, launchd)  │
│ pi-imessage         │ ─────────────► │  POST /send  (bearer token)  │
│  tool: send_imessage│ familyos-server│   └─► osascript ─► Messages  │
└─────────────────────┘     :8787      │        (agent Apple ID)      │
                                       └──────────────┬───────────────┘
                                                      ▼ iMessage
                                              User's phone / devices
```

## Repo layout

Everything lives in one package in this monorepo:

```
packages/pi-imessage/
  package.json            # π manifest → extension entry; keywords: ["pi-package"]
  tsconfig.json
  README.md               # install spec + Air setup runbook
  extension/
    index.ts              # registers send_imessage tool
    tests/
  server/
    imsg-server.mjs       # plain Node, no framework, no build step
    setup.sh              # generates token, writes config, installs launchd plist
    com.user.imsg-server.plist  # template
    tests/
```

The `server/` directory is deployed to the Air by copying (git clone or scp); it is not
part of the π extension load path. Plain `.mjs` so the Air needs only a Node runtime, no
build step.

## Component: Air-side service (`imsg-server`)

- Plain Node `http` server, no framework. Binds to a configurable `host`, **default: the
  Air's Tailscale IP** (`100.99.196.91`) — not `0.0.0.0` — so the service is unreachable
  from the plain LAN and the bearer token is a second layer, not the only one. Setup
  documents how to widen to `0.0.0.0` (with the LAN-exposure caveat) if ever needed.
- **`POST /send`** — requires `Authorization: Bearer <token>`.
  Body (JSON): `{ "message": string (required), "emoji": string (optional), "context": string (optional) }`.
  - Composes final text:
    - Line 1: `emoji + " " + message` if `emoji` present, else `message`.
    - Line 2: `"[" + context + "]"` if `context` present, else omitted.
  - Field constraints: `message` must be a non-empty string after trim, max 4000 chars;
    `emoji` max 16 chars (treated as a short freeform prefix — true single-emoji
    validation is not enforceable and not attempted); `context` max 200 chars. Newlines
    in `message` pass through as-is. Violations → `400`.
  - Sends via `osascript` to the **recipient configured server-side**. Agents cannot
    choose the recipient — this is a notify-the-owner tool, not a general iMessage
    gateway.
  - AppleScript shape (modern macOS — the legacy `buddy`/`service` idiom is brittle):
    ```applescript
    on run argv
      set recipientAddr to item 1 of argv
      set msgText to item 2 of argv
      tell application "Messages"
        set targetService to 1st account whose service type = iMessage
        set targetParticipant to participant recipientAddr of targetService
        send msgText to targetParticipant
      end tell
    end run
    ```
    Both message **and recipient** are passed as `osascript` argv — never interpolated
    into script source — preventing AppleScript injection from either field. Must be
    validated end-to-end manually on the Air's actual macOS version.
  - Recipient is additionally validated at setup and startup as phone-like
    (`+`/digits) or email-like text; anything else is rejected with a config error.
  - Responses: `200 {"ok":true}`; `401` bad/missing token (generic body, no detail);
    `400` malformed body / constraint violations; `502 {"ok":false,"error":"<sanitized
    error code/summary>"}` when osascript fails. Raw osascript stderr is written **only
    to the local server log**, never returned to callers (it can leak account/contact/
    path details to anyone holding the token). Distinct sanitized errors for "Messages
    not signed in / unavailable" vs "automation not authorized" vs generic send failure.
- **`GET /health`** — unauthenticated, returns `200 {"ok":true}`. Liveness only; leaks
  no config or version data, and the Tailscale-only bind limits who can see it at all.
- Logging hygiene: the server never logs the token, `Authorization` headers, or full
  config contents. Logs go to files declared in the launchd plist
  (`StandardOutPath`/`StandardErrorPath` under `~/Library/Logs/imsg-server/`).
- Config: `~/.config/imsg-server/config.json` → `{ "token": string, "recipient": string, "port": number, "host": string }`
  (`recipient` = user's Apple ID email or phone number). File perms `600`.
- Process management: launchd **user LaunchAgent** (not a daemon) with `KeepAlive` and
  `ThrottleInterval` (e.g. 10 s). Constraint: LaunchAgents run only within a logged-in
  GUI session — acceptable because the Air auto-logs-in and Amphetamine keeps it awake;
  the spec makes this dependency explicit. Plist declares stdout/stderr log paths.
- `setup.sh` (run on the Air): generates token, writes config (prompting for and
  validating recipient), installs + loads the plist, prints the token for pasting into
  the Pro config. Also provides `setup.sh --smoke-send`, which invokes **the exact same
  send code path** interactively from the logged-in session — this is the deterministic
  first-run Automation authorization step (see below).

### Manual setup steps (documented in README, cannot be scripted)

1. Create the agent Apple ID (needs phone-number verification).
2. On the Air: Messages → Settings → iMessage → sign in with the agent Apple ID.
3. **Interactive Automation authorization (required — launchd-only first-run is not
   guaranteed to work):** headless processes may get TCC error `-1743` without any
   prompt ever appearing, and granted consent attaches to the *responsible process*
   (Terminal, node, osascript — whichever initiated it). So: run
   `setup.sh --smoke-send` from Terminal **in the logged-in GUI session** before
   loading the LaunchAgent, approve the Automation prompt, then verify System
   Settings → Privacy & Security → Automation shows the controller allowed for
   Messages. Troubleshooting doc includes `tccutil reset AppleEvents` to clear a
   botched grant. Only after the smoke-send succeeds is the LaunchAgent loaded, and a
   second smoke test is run through the HTTP endpoint to confirm the launchd context
   is also authorized.
4. Add the agent Apple ID to Contacts (name + avatar) on the user's devices.

## Component: π extension (`send_imessage` tool)

- Registers one custom tool, `send_imessage`:
  - `message` (string, required) — the notification text.
  - `emoji` (string, optional) — short status-glyph prefix, intended as a single emoji
    (e.g. ✅ ⏸️ ❌), max 16 chars best-effort; omit when no status glyph is warranted.
- Tool behaviour:
  1. Reads `~/.config/imsg/config.json` → `{ "url": string, "token": string }`.
     Missing/unreadable config → clear tool error explaining setup.
  2. Computes `context` deterministically: `{short hostname} · {basename(cwd)}`
     (e.g. `macbook-pro · pi-extensions`).
  3. `POST {url}/send` with bearer token and `{ message, emoji?, context }`.
     Timeout ~10 s.
  4. Success → tool result "message sent". Failure (unreachable, 401, 4xx/5xx, timeout)
     → tool **error** with the reason, so the agent knows the notification did not go
     out and can surface that in-session.
- Tool description tells the model when to use it (long job finished, input needed,
  failure worth interrupting the user for) and when not to (routine progress).

## Error handling summary

| Failure | Surfaced as |
|---|---|
| Pro config missing/malformed | Tool error with setup hint |
| Air unreachable / timeout | Tool error ("notification NOT delivered") |
| 401 | Tool error (token mismatch hint) |
| osascript/Messages failure | 502 with sanitized error code → tool error (details in Air-local log only) |
| Messages not signed in / automation not authorized | Distinct sanitized 502 errors → tool error naming the likely fix |

## Testing

- **Server** (vitest, runs on the Pro in this repo): unit tests for message composition
  (emoji/context permutations), auth handling, request validation, and osascript argv
  construction — child-process invocation mocked. Manual end-to-end test after
  deployment to the Air.
- **Extension** (vitest): context computation, payload construction, config
  missing/error paths — `fetch` mocked. Follows existing package test conventions
  (root workspace, `npm test -w pi-imessage`).

## Package conventions (per AGENTS.md)

- Own `package.json` with π manifest and `keywords: ["pi-package"]`; π-provided packages
  in `peerDependencies` as `"*"`; no runtime third-party deps anticipated.
- Dogfood via local-path entry in `.pi/settings.json` during development; switch to the
  published git mirror when stabilised.
- No per-package lockfile; root workspace owns installs.

## Explicitly out of scope (future features)

1. **Two-way replies** — Air service grows a `chat.db` (SQLite) reader + `/replies`
   endpoint. Known costs acknowledged now: Full Disk Access grant for the service
   process, strictly read-only SQLite access, tolerance for undocumented schema changes
   across macOS versions, and correlation metadata to match replies to requests. The
   HTTP-service architecture is chosen specifically so this bolts on without rework.
2. **CLI wrapper** (`imsg "text"`) for non-π consumers — thin curl-equivalent over the
   same endpoint, reading the **same Pro config file** (`~/.config/imsg/config.json`),
   which is therefore treated as a stable interface.
3. **Typing indicators** — private API / SIP-off territory; revisit only if two-way
   lands and it still seems worth it.
4. **Multiple recipients / agent-chosen recipients** — deliberately excluded.
