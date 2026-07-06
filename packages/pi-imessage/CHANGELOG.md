# Changelog

## v0.1.0 - 2026-07-06

- Initial release.
- `send_imessage` π tool: notify the user via iMessage from a dedicated agent identity; optional emoji prefix, automatic `host · project` provenance line.
- Dependency-free Node (≥18) HTTP relay for an always-on Mac: bearer-token auth, field limits, sanitized error codes, Tailscale-only bind, 64KB body cap.
- Staged Air setup (`configure` → `smoke-send` → `install-agent`) enforcing TCC Automation authorization before launchd load; KeepAlive LaunchAgent.
- README runbook: single owning account, troubleshooting table, FileVault/auto-login trade-off.

