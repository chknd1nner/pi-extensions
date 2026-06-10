# Paseo live state recovery vs Radius `get_live_session_state`

## 1. TL;DR
Paseo does **not** have a single live-state recovery RPC like the proposed `get_live_session_state`. It keeps one `Session` object per WS client, reuses that session across brief reconnects, and recovers UI state by combining snapshot/list RPCs (`fetch_agents`, `fetch_workspaces`) with paged timeline catch-up (`fetch_agent_timeline_request`). Live `agent_stream` is for immediacy only. The recoverable state is mostly agent metadata (`AgentSnapshotPayload`) plus `pendingPermissions`; partial assistant/tool output lives in an in-memory coalescer and is not exposed as a reconnect snapshot. So Radius’s proposal is a **hybrid improvement**, not a copy of Paseo.

## 2. Subscription model
- WS connection → one `Session` object; on reconnect with the same `clientId`, the server reattaches the socket to the existing `Session` instead of creating a new one (`packages/server/src/server/websocket-server.ts:837-856`, `packages/server/src/server/websocket-server.ts:987-1034`).
- If the last socket drops, the server keeps the session alive for a reconnect grace period, then cleans it up if nobody returns (`packages/server/src/server/websocket-server.ts:1171-1220`).
- `Session` subscribes to `AgentManager` with `replayState:false`, so it does **not** get a persisted per-client replay buffer from the manager; it gets live events only (`packages/server/src/server/session.ts:1292-1358`).
- `AgentManager` itself is a shared publisher with a subscriber set; its `subscribe()` can replay current `agent_state` snapshots, but that replay is disabled by `Session` (`packages/server/src/server/agent/agent-manager.ts:572-606`, `packages/server/src/server/agent/agent-manager.ts:3360-3388`).
- For directory/agent lists, the client opts into live updates by passing `subscribe` on the first page only; the server returns a `subscriptionId` and buffers bootstrap updates per session until the snapshot response is sent (`packages/client/src/daemon-client.ts:1660-1700`, `packages/server/src/server/session.ts:6866-6899`, `packages/server/src/server/session.ts:6993-7042`, `packages/app/src/runtime/host-runtime.ts:1888-1904`).

## 3. Reconnect / catchup mechanism
Paseo’s reconnect flow is **snapshot + live resume**, not transport replay:

1. Client reconnects with the same `clientId` in `hello`.
2. Server reuses the existing session, updates app version / client capabilities, and sends `server_info` again (`packages/server/src/server/websocket-server.ts:987-1018`).
3. If the session survived the grace window, the same in-memory subscriptions remain attached; if not, a new session is created and rehydrated from disk (`packages/server/src/server/websocket-server.ts:1171-1220`, `packages/server/src/server/websocket-server.ts:1023-1034`).
4. Client rehydrates lists with `fetch_workspaces_request` / `fetch_agents_request` (optionally `subscribe`) and catches up agent timelines with `fetch_agent_timeline_request` (`packages/server/src/server/session.ts:6866-7042`, `packages/server/src/server/session.ts:7635-7710`).
5. On the app side, resume uses `planResumeTimelineSync(...)` and then either a tail fetch or an `after` catch-up page; if `hasNewer` is still true, it keeps paging until complete (`docs/timeline-sync.md:1-37`, `packages/app/src/timeline/timeline-sync-plan.ts:54-62`, `packages/app/src/contexts/session-context.tsx:781-796`).

Exact wire types in play: `hello` → `status(server_info)` → `fetch_agents_request` / `fetch_workspaces_request` → `fetch_*_response` → `agent_stream` / `workspace_update` live messages (`packages/server/src/server/websocket-server.ts:987-1034`, `packages/server/src/server/session.ts:1297-1358`, `packages/server/src/server/session.ts:6866-7042`, `packages/server/src/server/session.ts:7635-7710`).

## 4. Live state representation
Paseo has a **snapshot of agent metadata**, but not a single unified “live run state” object for reconnects.

What it *does* have:
- `AgentSnapshotPayload` / `agent_state` includes lifecycle, `currentModeId`, `availableModes`, `pendingPermissions`, `runtimeInfo`, `lastUsage`, `lastError`, `requiresAttention`, and `attentionReason` (`packages/protocol/src/messages.ts:652-670`, `packages/server/src/server/agent/agent-manager.ts:3193-3219`).
- Pi’s own RPC runtime has `get_state` with `isStreaming`, `isCompacting`, queue modes, `messageCount`, and `pendingMessageCount`, but Paseo only consumes a subset of that through provider runtime info; it does not surface a Paseo-level `get_state` RPC (`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md:162-190`, `packages/server/src/server/agent/providers/pi/rpc-types.ts:59-87`, `packages/server/src/server/agent/providers/pi/agent.ts:1060-1072`).

What it does **not** have:
- a wire object for partial assistant head text,
- active tool execution output buffers,
- steer/follow-up queue contents,
- a dedicated “current leaf entry id” field for live recovery,
- or a session-wide `get_live_session_state` equivalent.

## 5. Per-event-type handling
| Type | Paseo behavior | Reconnect story |
|---|---|---|
| Partial assistant messages | Pi emits `message_update` with `text_delta`; Paseo turns that into `timeline` `assistant_message` deltas and the `AgentStreamCoalescer` merges adjacent text within a 60ms window (`packages/server/src/server/agent/providers/pi/agent.ts:1699-1723`, `packages/server/src/server/agent/agent-stream-coalescer.ts:1-174`). | If the delta was flushed into a timeline row, `fetch_agent_timeline_request` recovers it. If it was still only in the coalescer buffer when the client disconnected, there is no dedicated live-state replay. |
| Partial tool output | Pi emits `tool_execution_update` with `partialResult`; Paseo maps that to a running `tool_call` timeline item and coalesces by `callId` (`packages/server/src/server/agent/providers/pi/agent.ts:1607-1637`, `packages/server/src/server/agent/agent-stream-coalescer.ts:148-174`). | Same as above: recoverable once persisted to timeline,