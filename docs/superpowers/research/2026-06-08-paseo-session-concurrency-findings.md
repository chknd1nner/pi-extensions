# Paseo session concurrency findings

> Worker `w3` · model `openai-codex/gpt-5.4-mini` · thinking high · 2026-06-08

## Architecture summary
Paseo is local client-server: the daemon runs on the user's machine, manages agent processes, and streams agent output over WebSocket to mobile/CLI/desktop clients; the desktop app can also spawn the daemon as a subprocess. Agent state is the daemon's source of truth and is broadcast to all subscribers. `docs/architecture.md:3-5,231-235,263-267,127-129`

## Session ownership model
Paseo owns the daemon-side agent record/timeline in `$PASEO_HOME/agents/...json`, but not the provider's session artifact. Provider ownership is delegated:
- Claude: SDK resume uses `sessionId`/`resume`, with transcripts in `~/.claude/projects/{cwd}/{session-id}.jsonl`
- Codex: resumes via provider `thread/resume`
- Pi: passes the native session file directly to `runtime.startSession({ session: sessionFile })`
- OpenCode: resumes by provider session id on its server/runtime

`docs/architecture.md:235,245-251`
`packages/server/src/server/agent/providers/claude/agent.ts:2573-2577,2624-2626,3904-3908,3977-3999`
`packages/server/src/server/agent/providers/codex-app-server-agent.ts:2988-2990,3301-3303,5455-5465`
`packages/server/src/server/agent/providers/pi/agent.ts:1892-1912`
`packages/server/src/server/agent/providers/opencode-agent.ts:1327-1360`

## Concurrency handling
There is **no session-level lock/claim/takeover** in the agent/session code. The only real arbitration is per-agent turn state:
- `streamAgent()` rejects if the agent already has an active run: `Agent ${agentId} already has an active run`
- user/message paths call `sendPromptToAgent(..., { replaceRunning: true })`, so a new prompt **interrupts/replaces** the in-flight run rather than waiting
- `AgentManager` subscribes the underlying provider session once and broadcasts events to all subscribers, so multiple clients can watch the same agent concurrently

`packages/server/src/server/agent/agent-manager.ts:559-574,836-871,1475-1507,1615-1638,2419-2424,3388-3390`
`packages/server/src/server/agent/agent-prompt.ts:18-48,208-210`
`packages/server/src/server/session.ts:3024-3029,7770-7775,8809-8813`

## Gaps / unhandled cases
- No read-only fallback.
- No cross-process lock for a provider session file/runtime.
- If the same provider session is resumed in an external desktop TUI, Paseo does not claim or evict it; behavior depends on the provider/runtime.
- The only explicit lock in the repo is the daemon PID lock (`paseo.pid`), not a session lock.

`docs/data-model.md:424`
`packages/server/src/server/pid-lock.ts:95-97`

## File references
- `docs/architecture.md:3-5,127-129,231-235,245-251,263-267`
- `packages/server/src/server/agent/agent-manager.ts:559-574,836-871,1475-1507,1615-1638,2246-2249,2419-2424,3388-3390`
- `packages/server/src/server/agent/agent-prompt.ts:18-48,208-210`
- `packages/server/src/server/session.ts:1847-1850,3024-3029,3197-3233,7770-7775,8809-8813`
- `packages/server/src/server/agent/providers/claude/agent.ts:2046-2058,2573-2577,2624-2626,3904-3908,3977-3999`
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts:2988-2990,3301-3303,5455-5465`
- `packages/server/src/server/agent/providers/pi/agent.ts:1892-1912`
- `packages/server/src/server/agent/providers/opencode-agent.ts:1327-1360`
- `docs/data-model.md:424`
- `packages/server/src/server/pid-lock.ts:95-97`
