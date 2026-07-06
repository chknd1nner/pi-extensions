# pi-imessage

A π extension that gives any agent on your main machine a `send_imessage` tool: a
one-way notification channel that delivers a real iMessage to your phone — sent from a
dedicated "agent" Apple ID, not from your own account. Intended for messages like
"job done", "input needed", or "build failed". The tool talks over Tailscale to a tiny
dependency-free Node HTTP service (`imsg-server`) running on an always-on Mac (in this
runbook: a MacBook Air), which drives Messages.app via `osascript`.

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

Agents can never choose the recipient — the recipient is configured server-side on the
Air. This is a notify-the-owner tool, not a general iMessage gateway.

## Install (Pro side)

1. Add the package to your π settings (`.pi/settings.json` in a project, or global
   settings). During local development a local-path entry works:

   ```json
   {
     "packages": ["../packages/pi-imessage"]
   }
   ```

   Once published to a git mirror, prefer the mirror spec:

   ```json
   {
     "packages": ["git:github.com/chknd1nner/pi-imessage@v0.1.0"]
   }
   ```

2. Create the client config at `~/.config/imsg/config.json`:

   ```json
   {
     "url": "http://familyos-server:8787",
     "token": "<token printed by setup.sh configure on the Air>"
   }
   ```

   Use your Air's Tailscale MagicDNS name (or its raw Tailscale IP, e.g.
   `http://100.99.196.91:8787`, if name resolution fails). Then:

   ```bash
   chmod 600 ~/.config/imsg/config.json
   ```

   This file is a stable interface — a future CLI wrapper will read the same file.

If the config is missing or malformed, the tool fails with a clear setup hint rather
than silently dropping the notification. Any delivery failure (server unreachable,
bad token, Messages error) surfaces as a tool **error** saying the notification was
NOT delivered, so the agent knows to tell you in-session.

## Air setup runbook

### One owning account

TCC Automation grants, LaunchAgents, the Messages iMessage sign-in, and the service
config are all **per-user** on macOS. One account on the Air — `familyosadmin`, the
permanently logged-in server account — must own the entire setup: the Messages sign-in,
all `setup.sh` stages, the LaunchAgent, and `~/.config/imsg-server/`. The service runs
only while that account holds a GUI session (staying logged in behind fast user
switching is fine; a full logout stops it). The Air should auto-login to this account
and be kept awake (e.g. with Amphetamine). Changing the owning account means redoing
the Messages sign-in and all three setup stages as the new user.

### Steps

1. **Create the agent Apple ID** (manual — needs phone-number verification). This is
   the identity your notifications will appear to come from.

2. **Sign Messages into the agent Apple ID** on the Air, as `familyosadmin`:
   Messages → Settings → iMessage → sign in. This sign-in is independent of the
   machine's iCloud account — the Air's iCloud stays on your own account.

3. **Deploy the server** to the Air as `familyosadmin` (git clone this repo, or copy
   just the server directory):

   ```bash
   scp -r packages/pi-imessage/server familyos-server:~/imsg-server
   ```

   Requires Node ≥ 18 on the Air (`node --version`). No `npm install` is needed — the
   server uses only `node:` builtins.

4. **Run the staged setup** on the Air, **in the logged-in GUI session**, in this
   exact order (running bare `./setup.sh` prints these stages and does nothing else):

   1. `./setup.sh configure` — generates a bearer token, prompts for and validates
      the recipient (your phone number or Apple ID email), and writes
      `~/.config/imsg-server/config.json` with `600` perms, bound to the Air's
      Tailscale IP (never `0.0.0.0`). It prints the token — paste it into
      `~/.config/imsg/config.json` on the Pro. This stage does not touch launchd.

   2. `./setup.sh smoke-send` — sends a test iMessage through the exact production
      code path, interactively from the GUI session. **This is the deterministic
      Automation-authorization step**: approve the macOS prompt ("Terminal wants to
      control Messages") when it appears. Headless (launchd-only) first runs are not
      guaranteed to ever show a prompt — they can just fail with TCC error `-1743` —
      which is why this stage must succeed *before* installing the agent. Afterwards,
      verify System Settings → Privacy & Security → Automation shows the controller
      allowed for Messages.

   3. `./setup.sh install-agent` — installs and loads the launchd user LaunchAgent
      (`com.familyos.imsg-server`, with `KeepAlive`), then runs a second smoke test
      through the HTTP endpoint to confirm the launchd context is also authorized.
      Expect "HTTP smoke test OK" and a second iMessage on your phone.

5. **Add the agent Apple ID to Contacts** (name + avatar) on your devices, so the
   notifications show up nicely.

## Troubleshooting

| Error code (HTTP 502 / tool error) | Meaning | Fix |
|---|---|---|
| `AUTOMATION_NOT_AUTHORIZED` | The server process is not allowed to control Messages (TCC `-1743`) | Redo `./setup.sh smoke-send` in the GUI session and approve the prompt; check System Settings → Privacy & Security → Automation |
| `MESSAGES_UNAVAILABLE` | Messages has no iMessage account signed in, or isn't available | Sign Messages into the agent Apple ID (Messages → Settings → iMessage) as `familyosadmin` |
| `SEND_FAILED` | Generic osascript/send failure | Check `~/Library/Logs/imsg-server/err.log` on the Air |

Additional notes:

- To clear a botched Automation grant and start over:
  `tccutil reset AppleEvents` (then redo `smoke-send`).
- Raw osascript stderr is written only to the Air-local logs
  (`~/Library/Logs/imsg-server/`), never returned over HTTP. Logs never contain the
  token or `Authorization` headers.
- Automation grants survive reboots, but may be reset by macOS major upgrades or by
  the Node binary changing (the grant attaches to the responsible process). If sends
  start failing with `AUTOMATION_NOT_AUTHORIZED` after an upgrade, redo `smoke-send`.
- Tool error "server unreachable": check the Air is online on the tailnet
  (`curl http://familyos-server:8787/health` should return `{"ok":true}`) and that
  the LaunchAgent is loaded (`launchctl print gui/$(id -u)/com.familyos.imsg-server`).
- Tool error mentioning the token (401): the token in `~/.config/imsg/config.json`
  on the Pro must match the one in `~/.config/imsg-server/config.json` on the Air.

## Message format

Line 1 is `{emoji} {message}` (emoji optional; single space after it when present).
Line 2 is `[{context}]`, where context is computed automatically as
`{short hostname} · {basename(cwd)}`. Example — the tool call
`send_imessage({ message: "test suite passed", emoji: "✅" })` from a π session in
`~/Projects/pi-extensions` on `MacBook-Pro.local` arrives as:

```
✅ test suite passed
[macbook-pro · pi-extensions]
```

## Out of scope / roadmap

- **Two-way replies** — a future feature: the Air service would grow a read-only
  `chat.db` (SQLite) reader and a `/replies` endpoint. Known costs (Full Disk Access
  grant, undocumented schema churn across macOS versions, reply correlation) are
  acknowledged; the HTTP-service architecture was chosen so this bolts on without
  rework.
- **CLI wrapper** (`imsg "text"`) for non-π consumers — a thin curl-equivalent over
  the same `/send` endpoint, reading the same `~/.config/imsg/config.json`, which is
  therefore treated as a stable interface.
- **Typing indicators** — explicitly rejected: they require private-API injection
  with SIP disabled. Revisit only if two-way replies land and it still seems worth it.
- **Multiple or agent-chosen recipients** — deliberately excluded; the recipient is
  fixed server-side.
