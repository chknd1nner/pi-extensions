# Handoff: pi-imessage — next up, the light CLI wrapper

**Date:** 2026-07-06
**Status of prior work:** COMPLETE — merged to `main`, **released as v0.1.0 and installed globally**, deployed, verified end-to-end
**Next goal:** a light CLI wrapper (`imsg`) so shell scripts, cron jobs, and non-π tools can send the same iMessage notifications

## What exists (deployed and working)

`packages/pi-imessage/` — a π package with two halves:

- **Pro side (this machine):** π extension registering the `send_imessage` tool.
  - `extension/index.ts` — tool registration (message required; emoji optional, maxLength 16).
  - `extension/lib.ts` — the reusable core: `loadProConfig(path)`, `defaultConfigPath()`
    (`$IMSG_CONFIG` override → `~/.config/imsg/config.json`), `computeContext(hostname, cwd)`
    (`{short host} · {basename(cwd)}`), `sendNotification({config, message, emoji?, context, fetchFn?, signal?})`
    (10 s timeout via explicit AbortController — `AbortSignal.any()` is banned; success is
    exactly HTTP 200 + `{"ok":true}`; all failures throw "NOT delivered" errors with actionable hints).
- **Air side (`familyos-server`):** dependency-free plain-Node HTTP service (`server/*.mjs`),
  running under launchd as `com.familyos.imsg-server`, bound to the Tailscale IP
  (100.99.196.91:8787), sending via osascript → Messages.app.

**Deployment facts:**
- Agent identity: `familyosagent@gmail.com`, signed into Messages on the Air.
- Air owning account: `familyosadmin` (NOT `familyos-admin` — docs were corrected).
- Server installed at `~/imsg-server` on the Air; config `~/.config/imsg-server/config.json` (600).
- Pro config exists and works: `~/.config/imsg/config.json` (600) = `{"url":"http://familyos-server:8787","token":"…"}`.
- FileVault is ON → no auto-login; after a reboot the service is down until someone logs
  in as `familyosadmin`, then everything resumes automatically (verified: launchd RunAtLoad,
  KeepAlive, TCC Automation grant all survive reboot).
- E2E verified twice, including post-reboot; health check via MagicDNS name works.

**Release & install (2026-07-06, post-merge):**
- Published to the mirror repo via `scripts/release-bundle.sh`: https://github.com/chknd1nner/pi-imessage, tag `v0.1.0` (monorepo tag `pi-imessage-v0.1.0`, release commit `8e221ee` on `main`). Tags unsigned (no signing key configured yet).
- **Installed globally**: `git:github.com/chknd1nner/pi-imessage@v0.1.0` in `~/.pi/agent/settings.json` — every π session on the Pro has `send_imessage`. Verified with a live send from a plain session in `/tmp`.
- Note the pin: future releases require re-running `pi install git:github.com/chknd1nner/pi-imessage@v0.x.y` to update the global entry.

**Design docs:**
- Spec: `docs/superpowers/specs/2026-07-06-pi-imessage-notify-design.md`
- Plan (executed, all 8 tasks done): `docs/superpowers/plans/2026-07-06-pi-imessage.md`
- Consumer docs/runbook: `packages/pi-imessage/README.md`

## Next goal: the light CLI wrapper

The spec's roadmap names this as the first follow-on. Intent (from the original design
discussion): a tiny `imsg` command so anything on the Pro — shell scripts, cron, Makefiles,
other tools — can send a notification without going through a π session.

Design constraints already settled:
- **Reuse the stable interfaces.** The Pro config file (`~/.config/imsg/config.json`) was
  explicitly designed as a stable contract shared by the extension and any future CLI.
  Same for the HTTP API (`POST /send` with bearer token, `{message, emoji?, context?}`).
  The server needs ZERO changes.
- **Reuse `extension/lib.ts`.** `loadProConfig` / `defaultConfigPath` / `computeContext` /
  `sendNotification` are exactly the functions a CLI needs. Don't duplicate them.
- Sensible shape (not yet designed — needs a brainstorm pass): something like
  `imsg "message"` with optional `-e emoji`, context auto-computed from hostname+cwd
  as the extension does; exit 0 on delivered, nonzero + stderr hint on failure.
- Open questions for brainstorming: distribution (bin entry in the pi-imessage package
  vs. standalone script vs. compiled), TS execution for a CLI (the extension runs under
  π's TS loader; a CLI invoked from shell doesn't), flag surface (`--context` override?
  `--url`/`--token` overrides? stdin piping?). Note the release workflow implication:
  if the CLI ships inside the pi-imessage package, adding it is a MINOR bump (v0.2.0)
  released via `skills/releasing-a-bundle/SKILL.md` + `scripts/release-bundle.sh`, and
  the global install pin must be bumped afterwards.

## Repo conventions that bit us (respect them)

- `AGENTS.md` is authoritative: workspace root owns installs, no per-package lockfiles,
  π deps as `"*"` peerDependencies, `keywords: ["pi-package"]`.
- Local-path dogfood entries in `.pi/settings.json` must NOT be committed. (Resolved:
  the user chose publish-to-mirror + global install — see "Release & install" above.
  No project-local settings entry exists or is needed.)
- `npm test -w pi-imessage` (48 tests) and `npm run typecheck -w pi-imessage` must stay green.
- tsconfig includes `extension/**/*.ts` and `server/tests/**/*.ts`; server runtime files
  are plain `.mjs` (Node ≥ 18, node: builtins only — no npm install on the Air).

## Process notes (what worked)

Delegate-driven development with cross-model lanes worked well: odd tasks Fable-5
implement / GPT-5.5 review, even tasks swapped; 7 tasks, 2 legitimate review FAILs
(64KB-cap socket reset; launchd-before-smoke-send ordering), both fixed in one cycle.
Spec and plan each went through gpt-5.5 review loops to APPROVED before execution.
Recommended for the CLI too: brainstorm → spec → gpt-5.5 review → plan → review →
ticket_shard → delegate workers with a frozen context pack.

## Working state / user prefs

- One-way notify only for MVP-era features; two-way replies are future work beyond the CLI.
- Typing indicators permanently rejected (private API / SIP).
- User watches model quota; check before long delegate runs and prefer lanes that
  spread load across anthropic + openai-codex.
