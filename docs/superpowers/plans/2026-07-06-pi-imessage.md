# pi-imessage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use delegate-driven-development (recommended in this repo) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A π custom tool `send_imessage` that lets any agent on the MacBook Pro send the user a real iMessage from a dedicated agent identity, via a small HTTP service on the MacBook Air.

**Architecture:** One package `packages/pi-imessage/` containing (a) a plain-Node HTTP service (`server/`, ESM `.mjs`, no build step) deployed to the Air that sends via `osascript` → Messages.app, and (b) a π extension (`extension/`) registering the `send_imessage` tool that POSTs to the service over Tailscale. Spec: `docs/superpowers/specs/2026-07-06-pi-imessage-notify-design.md` — read it before starting any task.

**Tech Stack:** TypeScript (extension), plain Node ESM (server, no dependencies), vitest, launchd, AppleScript via osascript.

## Global Constraints

- Message format: line 1 = `{emoji} {message}` (single space; emoji optional → just `{message}`), line 2 = `[{context}]` (omitted when no context).
- Field limits: `message` non-empty after trim, ≤ 4000 chars; `emoji` ≤ 16 chars; `context` ≤ 200 chars. Violations → HTTP 400. Newlines in `message` pass through.
- Server binds `config.host` (setup writes the Air's Tailscale IP; never default to `0.0.0.0`).
- Server config: `~/.config/imsg-server/config.json` → `{ token, recipient, port, host }`, perms 600.
- Pro config: `~/.config/imsg/config.json` → `{ url, token }`, perms 600. Stable interface (future CLI shares it).
- Never log tokens or `Authorization` headers. 401 body is generic: `{"ok":false,"error":"unauthorized"}`.
- osascript stderr goes to local logs only; HTTP 502 bodies carry ONLY whitelisted sanitized codes: `AUTOMATION_NOT_AUTHORIZED`, `MESSAGES_UNAVAILABLE`, `SEND_FAILED` (anything else maps to `SEND_FAILED`).
- Recipient and message are passed to AppleScript as `osascript` argv — never interpolated into script source.
- Recipient validated as phone-like (`+`/digits, ≥ 5 digits) or email-like at setup and startup.
- `setup.sh` is staged: `configure` → `smoke-send` → `install-agent`; bare invocation prints usage only.
- Server files are dependency-free plain Node ≥ 18 (`node:` builtins only) so the Air needs no `npm install`. Do not use `AbortSignal.any()` anywhere (arrived mid-Node-18); use explicit `AbortController` wiring.
- Package conventions per AGENTS.md: own `package.json` with π manifest, `keywords: ["pi-package"]`, π packages in `peerDependencies` as `"*"`, no per-package lockfile, tests via root workspace. Local-path dogfood entries in `.pi/settings.json` are NOT committed.
- Run tests with `npm test -w pi-imessage`, typecheck with `npm run typecheck -w pi-imessage` (from repo root).

## File Structure

Matches the spec's repo layout exactly:

```
packages/pi-imessage/
  package.json              # π manifest → ./extension/index.ts
  tsconfig.json
  README.md                 # install + Air setup runbook (Task 7)
  extension/
    index.ts                # registers send_imessage (Task 7)
    lib.ts                  # Pro-side pure logic: config, context, send (Task 6)
    tests/
      lib.test.ts           # Task 6
      index.test.ts         # Task 7
  server/
    lib.mjs                 # validation + composition + config load (Tasks 1, 4)
    send.mjs                # osascript invocation + error classification (Task 2)
    server.mjs              # HTTP handler factory (Task 3)
    imsg-server.mjs         # entry point + --smoke-send (Task 4)
    setup.sh                # staged setup (Task 5)
    com.familyos.imsg-server.plist.template  # (Task 5)
    tests/
      server-lib.test.ts    # Tasks 1, 4
      server-send.test.ts   # Task 2
      server-http.test.ts   # Task 3
```

---

### Task 1: Package scaffolding + server validation/composition library

**Files:**
- Create: `packages/pi-imessage/package.json`
- Create: `packages/pi-imessage/tsconfig.json`
- Create: `packages/pi-imessage/server/lib.mjs`
- Test: `packages/pi-imessage/server/tests/server-lib.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (from `server/lib.mjs`, all named exports):
  - `validatePayload(body: unknown) → { ok: true, value: { message, emoji?, context? } } | { ok: false, error: string }`
  - `composeText({ message, emoji?, context? }) → string`
  - `validateRecipient(recipient: string) → boolean`
  - `tokenMatches(authorizationHeader: string | undefined, token: string) → boolean`

- [ ] **Step 1: Create package scaffolding**

`packages/pi-imessage/package.json`:

```json
{
  "name": "pi-imessage",
  "version": "0.1.0",
  "description": "Pi extension exposing a send_imessage tool that notifies the user via a self-hosted iMessage relay on an always-on Mac.",
  "keywords": ["pi-package", "pi-extension", "imessage", "notifications"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/chknd1nner/pi-extensions.git",
    "directory": "packages/pi-imessage"
  },
  "type": "module",
  "files": ["extension", "server", "README.md"],
  "pi": {
    "extensions": ["./extension/index.ts"]
  },
  "scripts": {
    "test": "vitest run --cache=false",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

`packages/pi-imessage/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowJs": true,
    "types": ["node"]
  },
  "include": ["extension/**/*.ts", "server/tests/**/*.ts"]
}
```

Run: `npm install` (repo root, links the workspace).

- [ ] **Step 2: Write failing tests**

`packages/pi-imessage/server/tests/server-lib.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { composeText, tokenMatches, validatePayload, validateRecipient } from "../lib.mjs";

describe("validatePayload", () => {
  it("accepts a minimal valid payload", () => {
    const r = validatePayload({ message: "hi" });
    expect(r).toEqual({ ok: true, value: { message: "hi" } });
  });
  it("accepts emoji and context", () => {
    const r = validatePayload({ message: "hi", emoji: "✅", context: "mbp · repo" });
    expect(r).toEqual({ ok: true, value: { message: "hi", emoji: "✅", context: "mbp · repo" } });
  });
  it("rejects non-object bodies", () => {
    expect(validatePayload(null).ok).toBe(false);
    expect(validatePayload("x").ok).toBe(false);
  });
  it("rejects missing/empty/whitespace message", () => {
    expect(validatePayload({}).ok).toBe(false);
    expect(validatePayload({ message: "   " }).ok).toBe(false);
    expect(validatePayload({ message: 7 }).ok).toBe(false);
  });
  it("enforces max lengths (message 4000, emoji 16, context 200)", () => {
    expect(validatePayload({ message: "x".repeat(4001) }).ok).toBe(false);
    expect(validatePayload({ message: "x".repeat(4000) }).ok).toBe(true);
    expect(validatePayload({ message: "hi", emoji: "e".repeat(17) }).ok).toBe(false);
    expect(validatePayload({ message: "hi", context: "c".repeat(201) }).ok).toBe(false);
  });
  it("rejects non-string emoji/context", () => {
    expect(validatePayload({ message: "hi", emoji: 5 }).ok).toBe(false);
    expect(validatePayload({ message: "hi", context: [] }).ok).toBe(false);
  });
  it("preserves newlines in message", () => {
    const r = validatePayload({ message: "a\nb" });
    expect(r).toEqual({ ok: true, value: { message: "a\nb" } });
  });
});

describe("composeText", () => {
  it("message only", () => {
    expect(composeText({ message: "done" })).toBe("done");
  });
  it("emoji prefix with single space", () => {
    expect(composeText({ message: "done", emoji: "✅" })).toBe("✅ done");
  });
  it("context suffix on second line in brackets", () => {
    expect(composeText({ message: "done", context: "mbp · repo" })).toBe("done\n[mbp · repo]");
  });
  it("all fields", () => {
    expect(composeText({ message: "done", emoji: "✅", context: "mbp · repo" })).toBe(
      "✅ done\n[mbp · repo]",
    );
  });
});

describe("validateRecipient", () => {
  it("accepts phone-like values", () => {
    expect(validateRecipient("+61412345678")).toBe(true);
    expect(validateRecipient("0412 345 678")).toBe(true);
  });
  it("accepts email-like values", () => {
    expect(validateRecipient("agent@icloud.com")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(validateRecipient("")).toBe(false);
    expect(validateRecipient("tell app \"Finder\"")).toBe(false);
    expect(validateRecipient("123")).toBe(false);
  });
});

describe("tokenMatches", () => {
  it("matches a correct bearer token", () => {
    expect(tokenMatches("Bearer sekret", "sekret")).toBe(true);
  });
  it("rejects wrong token, wrong scheme, missing header", () => {
    expect(tokenMatches("Bearer nope", "sekret")).toBe(false);
    expect(tokenMatches("Basic sekret", "sekret")).toBe(false);
    expect(tokenMatches(undefined, "sekret")).toBe(false);
  });
  it("rejects length-mismatched tokens without throwing", () => {
    expect(tokenMatches("Bearer s", "sekret")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w pi-imessage`
Expected: FAIL — cannot resolve `../lib.mjs`.

- [ ] **Step 4: Implement `server/lib.mjs`**

```javascript
// Pure logic for imsg-server: payload validation, message composition,
// recipient validation, constant-time token comparison.
// Dependency-free: node builtins only (runs on the Air without npm install).
import { timingSafeEqual } from "node:crypto";

export const LIMITS = { message: 4000, emoji: 16, context: 200 };

export function validatePayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const { message, emoji, context } = body;
  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, error: "message must be a non-empty string" };
  }
  if (message.length > LIMITS.message) {
    return { ok: false, error: `message exceeds ${LIMITS.message} chars` };
  }
  const value = { message };
  if (emoji !== undefined) {
    if (typeof emoji !== "string" || emoji.length === 0 || emoji.length > LIMITS.emoji) {
      return { ok: false, error: `emoji must be a string of 1-${LIMITS.emoji} chars` };
    }
    value.emoji = emoji;
  }
  if (context !== undefined) {
    if (typeof context !== "string" || context.length > LIMITS.context) {
      return { ok: false, error: `context must be a string of at most ${LIMITS.context} chars` };
    }
    value.context = context;
  }
  return { ok: true, value };
}

export function composeText({ message, emoji, context }) {
  const line1 = emoji ? `${emoji} ${message}` : message;
  return context ? `${line1}\n[${context}]` : line1;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateRecipient(recipient) {
  if (typeof recipient !== "string" || recipient.length === 0) return false;
  if (EMAIL_RE.test(recipient)) return true;
  const digits = recipient.replace(/[\s()-]/g, "");
  return /^\+?\d{5,15}$/.test(digits);
}

export function tokenMatches(authorizationHeader, token) {
  if (typeof authorizationHeader !== "string") return false;
  if (!authorizationHeader.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(token);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w pi-imessage`
Expected: PASS (all server-lib tests).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-imessage package-lock.json
git commit -m "feat(pi-imessage): scaffold package and server validation/composition lib"
```

---

### Task 2: osascript sender with sanitized error classification

**Files:**
- Create: `packages/pi-imessage/server/send.mjs`
- Test: `packages/pi-imessage/server/tests/server-send.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (from `server/send.mjs`):
  - `sendMessage({ recipient: string, text: string }, execFileFn?) → Promise<void>` — resolves on success; rejects with `SendError`.
  - `class SendError extends Error { code: "AUTOMATION_NOT_AUTHORIZED" | "MESSAGES_UNAVAILABLE" | "SEND_FAILED"; localDetail: string }` — `localDetail` (raw stderr) is for local logging only, never for HTTP responses.
  - `SEND_SCRIPT` — the AppleScript source (exported for tests to assert argv-passing).

- [ ] **Step 1: Write failing tests**

`packages/pi-imessage/server/tests/server-send.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { SEND_SCRIPT, SendError, sendMessage } from "../send.mjs";

type ExecCb = (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void;

function fakeExec(stderr: string, fail: boolean) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fn = (cmd: string, args: string[], _opts: unknown, cb: ExecCb) => {
    calls.push({ cmd, args });
    cb(fail ? Object.assign(new Error("exit 1"), { code: 1 }) : null, "", stderr);
  };
  return { fn, calls };
}

describe("sendMessage", () => {
  it("invokes osascript with script + recipient + text as argv (no interpolation)", async () => {
    const { fn, calls } = fakeExec("", false);
    await sendMessage({ recipient: "agent@icloud.com", text: "✅ hi\n[mbp · repo]" }, fn as never);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("osascript");
    expect(calls[0].args).toEqual(["-e", SEND_SCRIPT, "agent@icloud.com", "✅ hi\n[mbp · repo]"]);
    expect(SEND_SCRIPT).toContain("on run argv");
    expect(SEND_SCRIPT).not.toContain("agent@icloud.com");
  });

  it("classifies TCC -1743 as AUTOMATION_NOT_AUTHORIZED", async () => {
    const { fn } = fakeExec("execution error: Not authorized to send Apple events to Messages. (-1743)", true);
    const err = await sendMessage({ recipient: "a@b.co", text: "x" }, fn as never).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.code).toBe("AUTOMATION_NOT_AUTHORIZED");
    expect(err.localDetail).toContain("-1743");
  });

  it("classifies missing iMessage account as MESSAGES_UNAVAILABLE", async () => {
    const { fn } = fakeExec("execution error: Messages got an error: Can’t get 1st account whose service type = iMessage. (-1728)", true);
    const err = await sendMessage({ recipient: "a@b.co", text: "x" }, fn as never).catch((e) => e);
    expect(err.code).toBe("MESSAGES_UNAVAILABLE");
  });

  it("classifies anything else as SEND_FAILED and keeps stderr out of message", async () => {
    const { fn } = fakeExec("some /Users/secret/path exploded", true);
    const err = await sendMessage({ recipient: "a@b.co", text: "x" }, fn as never).catch((e) => e);
    expect(err.code).toBe("SEND_FAILED");
    expect(err.message).not.toContain("/Users/secret");
    expect(err.localDetail).toContain("/Users/secret");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-imessage`
Expected: FAIL — cannot resolve `../send.mjs`.

- [ ] **Step 3: Implement `server/send.mjs`**

```javascript
// Sends an iMessage via osascript. Message text and recipient are passed as
// osascript argv (never interpolated into script source) to prevent
// AppleScript injection. Errors are classified into sanitized codes; raw
// stderr is preserved on SendError.localDetail for LOCAL logging only.
import { execFile } from "node:child_process";

export const SEND_SCRIPT = `on run argv
  set recipientAddr to item 1 of argv
  set msgText to item 2 of argv
  tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetParticipant to participant recipientAddr of targetService
    send msgText to targetParticipant
  end tell
end run`;

export class SendError extends Error {
  constructor(code, localDetail) {
    super(`iMessage send failed: ${code}`);
    this.name = "SendError";
    this.code = code;
    this.localDetail = localDetail;
  }
}

function classify(stderr) {
  if (/-1743|not authori[sz]ed/i.test(stderr)) return "AUTOMATION_NOT_AUTHORIZED";
  if (/service type|-1728|isn.t running|application .Messages./i.test(stderr)) {
    return "MESSAGES_UNAVAILABLE";
  }
  return "SEND_FAILED";
}

export function sendMessage({ recipient, text }, execFileFn = execFile) {
  return new Promise((resolve, reject) => {
    execFileFn(
      "osascript",
      ["-e", SEND_SCRIPT, recipient, text],
      { timeout: 30_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new SendError(classify(stderr ?? ""), stderr ?? String(error)));
        } else {
          resolve();
        }
      },
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w pi-imessage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-imessage/server/send.mjs packages/pi-imessage/server/tests/server-send.test.ts
git commit -m "feat(pi-imessage): osascript sender with sanitized error classification"
```

---

### Task 3: HTTP handler (auth, /health, /send)

**Files:**
- Create: `packages/pi-imessage/server/server.mjs`
- Test: `packages/pi-imessage/server/tests/server-http.test.ts`

**Interfaces:**
- Consumes: `validatePayload`, `composeText`, `tokenMatches` from `server/lib.mjs` (Task 1); `SendError` shape from Task 2.
- Produces (from `server/server.mjs`):
  - `createHandler(config: { token: string, recipient: string }, deps: { send: ({recipient, text}) => Promise<void>, log?: (line: string) => void }) → (req, res) => void` — a plain `node:http` request listener. Entry point (Task 4) wires it to `http.createServer` and the real `sendMessage`.
  - 502 error codes are whitelisted: any `err.code` outside `AUTOMATION_NOT_AUTHORIZED` / `MESSAGES_UNAVAILABLE` / `SEND_FAILED` is coerced to `SEND_FAILED` before hitting the wire.

- [ ] **Step 1: Write failing tests**

`packages/pi-imessage/server/tests/server-http.test.ts`:

```typescript
import http from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../server.mjs";

class FakeSendError extends Error {
  code = "AUTOMATION_NOT_AUTHORIZED";
  localDetail = "raw stderr with /Users/secret";
}

let server: http.Server | undefined;
const logged: string[] = [];

async function start(sendImpl: (args: { recipient: string; text: string }) => Promise<void>) {
  const handler = createHandler(
    { token: "sekret", recipient: "agent@icloud.com" },
    { send: sendImpl, log: (l: string) => logged.push(l) },
  );
  server = http.createServer(handler);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => {
  logged.length = 0;
});

afterEach(
  () =>
    new Promise<void>((r) => {
      if (!server) return r();
      server.close(() => r());
      server = undefined;
    }),
);

describe("GET /health", () => {
  it("returns 200 ok without auth", async () => {
    const base = await start(async () => {});
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /send", () => {
  it("sends composed text to configured recipient", async () => {
    const sent: Array<{ recipient: string; text: string }> = [];
    const base = await start(async (a) => void sent.push(a));
    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({ message: "done", emoji: "✅", context: "mbp · repo" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toEqual([{ recipient: "agent@icloud.com", text: "✅ done\n[mbp · repo]" }]);
  });

  it("401 generic body on missing/wrong token; token never logged", async () => {
    const base = await start(async () => {});
    for (const headers of [{}, { authorization: "Bearer wrong-token" }]) {
      const res = await fetch(`${base}/send`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    }
    expect(logged.join("\n")).not.toContain("wrong-token");
    expect(logged.join("\n")).not.toContain("sekret");
  });

  it("400 on invalid JSON and on constraint violations", async () => {
    const base = await start(async () => {});
    const bad = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: "{not json",
    });
    expect(bad.status).toBe(400);
    const tooLong = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(4001) }),
    });
    expect(tooLong.status).toBe(400);
  });

  it("502 with sanitized code on send failure; stderr only in local log", async () => {
    const base = await start(async () => {
      throw new FakeSendError("boom");
    });
    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "AUTOMATION_NOT_AUTHORIZED" });
    expect(logged.join("\n")).toContain("/Users/secret");
  });

  it("coerces unknown error codes to SEND_FAILED (whitelist)", async () => {
    const base = await start(async () => {
      throw Object.assign(new Error("boom"), { code: "ESECRET_INTERNAL" });
    });
    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "SEND_FAILED" });
  });

  it("404 elsewhere", async () => {
    const base = await start(async () => {});
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-imessage`
Expected: FAIL — cannot resolve `../server.mjs`.

- [ ] **Step 3: Implement `server/server.mjs`**

```javascript
// HTTP request handler for imsg-server. No framework. Never logs tokens or
// Authorization headers; 401 bodies are generic; osascript detail goes to
// the local log only; 502 codes are whitelisted.
import { composeText, tokenMatches, validatePayload } from "./lib.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const SANITIZED_CODES = new Set(["AUTOMATION_NOT_AUTHORIZED", "MESSAGES_UNAVAILABLE", "SEND_FAILED"]);

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createHandler(config, deps) {
  const log = deps.log ?? ((line) => console.error(line));

  return (req, res) => {
    void handle(req, res).catch((err) => {
      log(`unhandled handler error: ${err?.stack ?? err}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal" });
    });
  };

  async function handle(req, res) {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/send") {
      if (!tokenMatches(req.headers.authorization, config.token)) {
        return json(res, 401, { ok: false, error: "unauthorized" });
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { ok: false, error: "invalid JSON body" });
      }
      const result = validatePayload(body);
      if (!result.ok) return json(res, 400, { ok: false, error: result.error });

      const text = composeText(result.value);
      try {
        await deps.send({ recipient: config.recipient, text });
      } catch (err) {
        const code = SANITIZED_CODES.has(err?.code) ? err.code : "SEND_FAILED";
        log(`send failed (${code}): ${err?.localDetail ?? err?.message ?? err}`);
        return json(res, 502, { ok: false, error: code });
      }
      log(`sent notification (${text.length} chars)`);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: "not found" });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w pi-imessage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-imessage/server/server.mjs packages/pi-imessage/server/tests/server-http.test.ts
git commit -m "feat(pi-imessage): HTTP handler with auth, /health, /send"
```

---

### Task 4: Server config loading + entry point with --smoke-send

**Files:**
- Modify: `packages/pi-imessage/server/lib.mjs` (add `loadServerConfig`)
- Create: `packages/pi-imessage/server/imsg-server.mjs`
- Test: `packages/pi-imessage/server/tests/server-lib.test.ts` (append)

**Interfaces:**
- Consumes: `validateRecipient` (Task 1), `createHandler` (Task 3), `sendMessage` (Task 2).
- Produces:
  - `loadServerConfig(path: string) → { token, recipient, port, host }` — throws `Error` with a human-readable message on missing file, invalid JSON, missing/invalid fields, or invalid recipient. Defaults: `port` 8787 if absent. `host` is REQUIRED (no default — the spec forbids implicit wide binds).
  - `server/imsg-server.mjs` — executable entry: `node imsg-server.mjs` starts the HTTP server; `node imsg-server.mjs --smoke-send [text]` sends one message through the exact production code path and exits 0/1. Config path: `$IMSG_SERVER_CONFIG` override or `~/.config/imsg-server/config.json` (override exists for tests/setup.sh).

- [ ] **Step 1: Append failing tests to `server/tests/server-lib.test.ts`**

```typescript
// Add loadServerConfig to the existing import from "../lib.mjs", and add
// these imports at top of file:
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("loadServerConfig", () => {
  function writeConfig(value: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imsg-"));
    const p = path.join(dir, "config.json");
    fs.writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value));
    return p;
  }

  it("loads a valid config and defaults port to 8787", () => {
    const p = writeConfig({ token: "t".repeat(64), recipient: "a@b.co", host: "100.99.196.91" });
    expect(loadServerConfig(p)).toEqual({
      token: "t".repeat(64),
      recipient: "a@b.co",
      host: "100.99.196.91",
      port: 8787,
    });
  });
  it("throws readable errors for missing file, bad JSON, missing fields", () => {
    expect(() => loadServerConfig("/nonexistent/config.json")).toThrow(/not found|no such/i);
    expect(() => loadServerConfig(writeConfig("{oops"))).toThrow(/invalid JSON/i);
    expect(() => loadServerConfig(writeConfig({ recipient: "a@b.co", host: "h" }))).toThrow(/token/i);
    expect(() => loadServerConfig(writeConfig({ token: "t", host: "h" }))).toThrow(/recipient/i);
    expect(() => loadServerConfig(writeConfig({ token: "t", recipient: "a@b.co" }))).toThrow(/host/i);
  });
  it("rejects invalid recipient at load time", () => {
    const p = writeConfig({ token: "t", recipient: "tell app", host: "h" });
    expect(() => loadServerConfig(p)).toThrow(/recipient/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-imessage`
Expected: FAIL — `loadServerConfig` is not exported.

- [ ] **Step 3: Implement `loadServerConfig` (append to `server/lib.mjs`)**

```javascript
import { readFileSync } from "node:fs";

export function loadServerConfig(configPath) {
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`config not found at ${configPath} — run setup.sh configure`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${configPath}`);
  }
  const { token, recipient, host } = parsed;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`config missing "token" (${configPath})`);
  }
  if (typeof recipient !== "string" || !validateRecipient(recipient)) {
    throw new Error(`config "recipient" missing or not phone/email-like (${configPath})`);
  }
  if (typeof host !== "string" || host.length === 0) {
    throw new Error(`config missing "host" — bind address is required, never defaults to 0.0.0.0 (${configPath})`);
  }
  const port = parsed.port ?? 8787;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`config "port" must be an integer 1-65535 (${configPath})`);
  }
  return { token, recipient, host, port };
}
```

(Move the `import { readFileSync } ...` to the top of the file with the other imports.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w pi-imessage`
Expected: PASS.

- [ ] **Step 5: Implement `server/imsg-server.mjs` (entry point — thin wiring, covered by the smoke tests in Task 5's runbook rather than unit tests)**

```javascript
#!/usr/bin/env node
// imsg-server entry point.
//   node imsg-server.mjs                       start HTTP server
//   node imsg-server.mjs --smoke-send [text]   send one message via the
//                                              production code path, exit 0/1
// Config: $IMSG_SERVER_CONFIG or ~/.config/imsg-server/config.json
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { composeText, loadServerConfig } from "./lib.mjs";
import { sendMessage } from "./send.mjs";
import { createHandler } from "./server.mjs";

const configPath =
  process.env.IMSG_SERVER_CONFIG ??
  path.join(os.homedir(), ".config", "imsg-server", "config.json");

let config;
try {
  config = loadServerConfig(configPath);
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}

const [, , flag, ...rest] = process.argv;

if (flag === "--smoke-send") {
  const text = composeText({
    message: rest.join(" ") || "imsg-server smoke test",
    emoji: "🔧",
    context: `smoke-send · ${os.hostname().split(".")[0]}`,
  });
  try {
    await sendMessage({ recipient: config.recipient, text });
    console.log("smoke-send OK");
    process.exit(0);
  } catch (err) {
    console.error(`smoke-send FAILED (${err.code ?? "unknown"})`);
    console.error(err.localDetail ?? err.message);
    process.exit(1);
  }
}

const handler = createHandler(config, { send: sendMessage });
const server = http.createServer(handler);
server.listen(config.port, config.host, () => {
  console.error(`imsg-server listening on ${config.host}:${config.port}`);
});
```

- [ ] **Step 6: Verify entry point manually (no Messages needed)**

```bash
cd packages/pi-imessage/server
IMSG_SERVER_CONFIG=/nonexistent node imsg-server.mjs; echo "exit=$?"
```

Expected: `config not found at /nonexistent — run setup.sh configure`, `exit=1`.

```bash
TMP=$(mktemp -d) && printf '{"token":"t123456","recipient":"a@b.co","host":"127.0.0.1","port":18787}' > "$TMP/config.json"
IMSG_SERVER_CONFIG="$TMP/config.json" node imsg-server.mjs &
sleep 1 && curl -s http://127.0.0.1:18787/health && kill %1
```

Expected: `{"ok":true}`.

- [ ] **Step 7: Run full test suite and commit**

Run: `npm test -w pi-imessage` — Expected: PASS.

```bash
git add packages/pi-imessage/server/lib.mjs packages/pi-imessage/server/imsg-server.mjs packages/pi-imessage/server/tests/server-lib.test.ts
git commit -m "feat(pi-imessage): server config loading and entry point with --smoke-send"
```

---

### Task 5: setup.sh (staged) + launchd plist template

**Files:**
- Create: `packages/pi-imessage/server/setup.sh` (mode 755)
- Create: `packages/pi-imessage/server/com.familyos.imsg-server.plist.template`

**Interfaces:**
- Consumes: `imsg-server.mjs --smoke-send` (Task 4), `validateRecipient`/`loadServerConfig` from `server/lib.mjs`.
- Produces: the deploy/authorization workflow documented in the spec: `configure` → `smoke-send` → `install-agent`. No exports.

- [ ] **Step 1: Create the plist template**

`packages/pi-imessage/server/com.familyos.imsg-server.plist.template` — placeholders `__NODE__`, `__SERVER__`, `__HOME__` are substituted (XML-escaped) by `setup.sh install-agent`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.familyos.imsg-server</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE__</string>
    <string>__SERVER__</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>__HOME__/Library/Logs/imsg-server/out.log</string>
  <key>StandardErrorPath</key>
  <string>__HOME__/Library/Logs/imsg-server/err.log</string>
</dict>
</plist>
```

- [ ] **Step 2: Create `setup.sh`**

```bash
#!/bin/bash
# Staged setup for imsg-server. Run ON THE MACBOOK AIR, as the single owning
# account (the permanently-logged-in server account), IN A GUI SESSION.
# Stages MUST run in order: configure -> smoke-send -> install-agent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/imsg-server"
CONFIG="$CONFIG_DIR/config.json"
PLIST_LABEL="com.familyos.imsg-server"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

usage() {
  cat <<'EOF'
Usage: setup.sh <stage>   (run stages in order, on the Air, in a GUI session)

  configure      Generate token, write ~/.config/imsg-server/config.json (600).
  smoke-send     Send a test iMessage interactively. Approve the macOS
                 Automation prompt when it appears. MUST succeed before
                 install-agent. Troubleshooting: tccutil reset AppleEvents
  install-agent  Install + load the launchd agent, then verify via HTTP.

Prerequisite: Messages is signed into the agent Apple ID on this machine.
EOF
}

configure() {
  mkdir -p "$CONFIG_DIR"
  local token host recipient
  token=$(openssl rand -hex 32)
  host=$(tailscale ip -4 2>/dev/null | head -1 || true)
  if [ -z "$host" ]; then
    read -r -p "Tailscale IP of this machine (bind address): " host
  fi
  if [ -z "$host" ]; then
    echo "error: bind host must not be empty (never binds 0.0.0.0 implicitly)" >&2
    exit 1
  fi
  read -r -p "Recipient (your phone number or Apple ID email): " recipient
  IMSG_TOKEN="$token" IMSG_HOST="$host" IMSG_RECIPIENT="$recipient" node --input-type=module -e '
    const { validateRecipient } = await import(process.argv[1]);
    const { IMSG_TOKEN: token, IMSG_HOST: host, IMSG_RECIPIENT: recipient } = process.env;
    if (!validateRecipient(recipient)) { console.error("recipient is not phone/email-like"); process.exit(1); }
    const fs = await import("node:fs");
    fs.writeFileSync(process.argv[2], JSON.stringify({ token, recipient, host, port: 8787 }, null, 2) + "\n", { mode: 0o600 });
  ' "$SCRIPT_DIR/lib.mjs" "$CONFIG"
  chmod 600 "$CONFIG"
  echo "Config written to $CONFIG"
  echo
  echo "Token (paste into ~/.config/imsg/config.json on the Pro):"
  echo "$token"
  echo
  echo "Next: ./setup.sh smoke-send"
}

smoke_send() {
  echo "Sending test message via the production code path..."
  echo "If a macOS prompt appears (Terminal wants to control Messages), APPROVE it."
  node "$SCRIPT_DIR/imsg-server.mjs" --smoke-send "setup smoke test"
  echo
  echo "Verify System Settings > Privacy & Security > Automation shows the grant."
  echo "Next: ./setup.sh install-agent"
}

install_agent() {
  local node_path
  node_path=$(command -v node)
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/imsg-server"
  IMSG_NODE="$node_path" IMSG_SERVER="$SCRIPT_DIR/imsg-server.mjs" node --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs";
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let t = readFileSync(process.argv[1], "utf8");
    t = t.replace("__NODE__", esc(process.env.IMSG_NODE))
         .replace("__SERVER__", esc(process.env.IMSG_SERVER))
         .replaceAll("__HOME__", esc(process.env.HOME));
    writeFileSync(process.argv[2], t);
  ' "$SCRIPT_DIR/$PLIST_LABEL.plist.template" "$PLIST_DEST"
  launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
  echo "LaunchAgent loaded. Verifying via HTTP (launchd context)..."
  sleep 2
  node --input-type=module -e '
    const { loadServerConfig } = await import(process.argv[1]);
    const c = loadServerConfig(process.argv[2]);
    const res = await fetch(`http://${c.host}:${c.port}/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: "install-agent verification", emoji: "🔧", context: "setup.sh install-agent" }),
    });
    const body = await res.json();
    if (!body.ok) { console.error("HTTP smoke test FAILED:", res.status, JSON.stringify(body)); process.exit(1); }
    console.log("HTTP smoke test OK — setup complete.");
  ' "$SCRIPT_DIR/lib.mjs" "$CONFIG"
}

case "${1:-}" in
  configure) configure ;;
  smoke-send) smoke_send ;;
  install-agent) install_agent ;;
  *) usage ;;
esac
```

- [ ] **Step 3: Verify script mechanics (Pro-side, no Messages involved)**

```bash
chmod +x packages/pi-imessage/server/setup.sh
bash -n packages/pi-imessage/server/setup.sh && echo "syntax OK"
packages/pi-imessage/server/setup.sh            # bare invocation
```

Expected: `syntax OK`, then the usage text (bare invocation does nothing else).

- [ ] **Step 4: Commit**

```bash
git add packages/pi-imessage/server/setup.sh packages/pi-imessage/server/com.familyos.imsg-server.plist.template
git commit -m "feat(pi-imessage): staged setup script and launchd plist template"
```

---

### Task 6: Pro-side extension library

**Files:**
- Create: `packages/pi-imessage/extension/lib.ts`
- Test: `packages/pi-imessage/extension/tests/lib.test.ts`

**Interfaces:**
- Consumes: server HTTP API contract (Task 3): `POST {url}/send` with bearer token, body `{ message, emoji?, context? }`, responses `{ok:true}` / `{ok:false,error}`.
- Produces (from `extension/lib.ts`):
  - `loadProConfig(configPath: string) → { url: string, token: string }` — throws with setup hint on any problem.
  - `defaultConfigPath() → string` — `$IMSG_CONFIG` override, else `~/.config/imsg/config.json`.
  - `computeContext(hostname: string, cwd: string) → string` — `{short hostname lowercase} · {basename(cwd)}`.
  - `sendNotification(args: { config: {url, token}, message: string, emoji?: string, context: string, fetchFn?: typeof fetch, signal?: AbortSignal }) → Promise<void>` — resolves only on exactly `200 {"ok":true}` (a 201 or other 2xx is treated as failure), throws `Error` with actionable message otherwise. 10 s timeout via explicit `AbortController` (no `AbortSignal.any()`).

- [ ] **Step 1: Write failing tests**

`packages/pi-imessage/extension/tests/lib.test.ts`:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeContext, defaultConfigPath, loadProConfig, sendNotification } from "../lib.js";

describe("computeContext", () => {
  it("short lowercase hostname · basename(cwd)", () => {
    expect(computeContext("MacBook-Pro.local", "/Users/m/Projects/pi-extensions")).toBe(
      "macbook-pro · pi-extensions",
    );
    expect(computeContext("familyos-server", "/tmp/x")).toBe("familyos-server · x");
  });
});

describe("defaultConfigPath", () => {
  afterEach(() => {
    delete process.env.IMSG_CONFIG;
  });
  it("defaults to ~/.config/imsg/config.json", () => {
    expect(defaultConfigPath()).toBe(path.join(os.homedir(), ".config", "imsg", "config.json"));
  });
  it("honours $IMSG_CONFIG override", () => {
    process.env.IMSG_CONFIG = "/tmp/override.json";
    expect(defaultConfigPath()).toBe("/tmp/override.json");
  });
});

describe("loadProConfig", () => {
  function write(value: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imsg-pro-"));
    const p = path.join(dir, "config.json");
    fs.writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value));
    return p;
  }
  it("loads url and token", () => {
    const p = write({ url: "http://familyos-server:8787", token: "t" });
    expect(loadProConfig(p)).toEqual({ url: "http://familyos-server:8787", token: "t" });
  });
  it("throws with setup hint when missing or malformed", () => {
    expect(() => loadProConfig("/nonexistent/c.json")).toThrow(/setup|config/i);
    expect(() => loadProConfig(write("{bad"))).toThrow(/invalid JSON/i);
    expect(() => loadProConfig(write({ url: "http://x" }))).toThrow(/token/i);
    expect(() => loadProConfig(write({ token: "t" }))).toThrow(/url/i);
  });
});

describe("sendNotification", () => {
  const config = { url: "http://air:8787", token: "sekret" };

  it("POSTs payload with bearer token and resolves on 200 ok:true", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetchFn = (async (input: string, init: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await sendNotification({ config, message: "done", emoji: "✅", context: "mbp · repo", fetchFn });
    expect(calls[0].input).toBe("http://air:8787/send");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sekret");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      message: "done",
      emoji: "✅",
      context: "mbp · repo",
    });
  });

  it("omits emoji field when not provided", async () => {
    let body = "";
    const fetchFn = (async (_i: string, init: RequestInit) => {
      body = init.body as string;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await sendNotification({ config, message: "done", context: "c", fetchFn });
    expect(JSON.parse(body)).toEqual({ message: "done", context: "c" });
  });

  it("throws when a 200 response lacks ok:true", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ ok: false, error: "weird" }), { status: 200 })) as typeof fetch;
    await expect(
      sendNotification({ config, message: "m", context: "c", fetchFn }),
    ).rejects.toThrow(/NOT delivered/i);
  });

  it("throws on non-200 2xx even with ok:true (contract is 200 exactly)", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 201 })) as typeof fetch;
    await expect(
      sendNotification({ config, message: "m", context: "c", fetchFn }),
    ).rejects.toThrow(/NOT delivered/i);
  });

  it("throws NOT delivered with hint on 401", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 })) as typeof fetch;
    await expect(
      sendNotification({ config, message: "m", context: "c", fetchFn }),
    ).rejects.toThrow(/NOT delivered.*token/i);
  });

  it("throws NOT delivered with server error code on 502", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ ok: false, error: "MESSAGES_UNAVAILABLE" }), { status: 502 })) as typeof fetch;
    await expect(
      sendNotification({ config, message: "m", context: "c", fetchFn }),
    ).rejects.toThrow(/NOT delivered.*MESSAGES_UNAVAILABLE/);
  });

  it("throws NOT delivered when server unreachable", async () => {
    const fetchFn = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(
      sendNotification({ config, message: "m", context: "c", fetchFn }),
    ).rejects.toThrow(/NOT delivered.*unreachable/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-imessage`
Expected: FAIL — cannot resolve `../lib.js`.

- [ ] **Step 3: Implement `extension/lib.ts`**

```typescript
// Pro-side logic for the send_imessage tool: config loading, context
// computation, and HTTP delivery to imsg-server on the Air.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface ProConfig {
  url: string;
  token: string;
}

export function defaultConfigPath(): string {
  return process.env.IMSG_CONFIG ?? join(homedir(), ".config", "imsg", "config.json");
}

export function loadProConfig(configPath: string): ProConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(
      `imsg config not found at ${configPath}. Setup: create it with {"url":"http://<air-host>:8787","token":"<token from setup.sh configure>"} and chmod 600.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${configPath}`);
  }
  const { url, token } = parsed as Partial<ProConfig>;
  if (typeof url !== "string" || url.length === 0) throw new Error(`config missing "url" (${configPath})`);
  if (typeof token !== "string" || token.length === 0) throw new Error(`config missing "token" (${configPath})`);
  return { url, token };
}

export function computeContext(hostname: string, cwd: string): string {
  const shortHost = hostname.split(".")[0].toLowerCase();
  return `${shortHost} · ${basename(cwd)}`;
}

export async function sendNotification(args: {
  config: ProConfig;
  message: string;
  emoji?: string;
  context: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  const { config, message, emoji, context } = args;
  const fetchFn = args.fetchFn ?? fetch;

  // Explicit AbortController: 10s timeout + optional upstream signal.
  // (AbortSignal.any() deliberately avoided — see Global Constraints.)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout after 10s")), 10_000);
  const onUpstreamAbort = () => controller.abort(args.signal?.reason);
  if (args.signal?.aborted) controller.abort(args.signal.reason);
  args.signal?.addEventListener("abort", onUpstreamAbort, { once: true });

  const body: Record<string, string> = { message, context };
  if (emoji !== undefined) body.emoji = emoji;

  try {
    let res: Response;
    try {
      res = await fetchFn(`${config.url.replace(/\/$/, "")}/send`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `iMessage notification NOT delivered: server unreachable at ${config.url} (${err instanceof Error ? err.message : String(err)}). Is the Air online and imsg-server running?`,
      );
    }
    if (res.status === 401) {
      throw new Error(
        "iMessage notification NOT delivered: server rejected the token (401). Check that the token in ~/.config/imsg/config.json matches the Air's config.",
      );
    }
    let responseOk = false;
    let code = `HTTP ${res.status}`;
    try {
      const parsed = (await res.json()) as { ok?: boolean; error?: string };
      responseOk = res.status === 200 && parsed.ok === true;
      if (parsed.error) code = parsed.error;
    } catch {
      // keep HTTP status as the code
    }
    if (!responseOk) {
      throw new Error(`iMessage notification NOT delivered: ${code}`);
    }
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onUpstreamAbort);
  }
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npm test -w pi-imessage && npm run typecheck -w pi-imessage`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-imessage/extension/lib.ts packages/pi-imessage/extension/tests/lib.test.ts
git commit -m "feat(pi-imessage): pro-side config, context, and delivery library"
```

---

### Task 7: Extension entry, README, dogfood wiring

**Files:**
- Create: `packages/pi-imessage/extension/index.ts`
- Create: `packages/pi-imessage/README.md`
- Test: `packages/pi-imessage/extension/tests/index.test.ts`

**Interfaces:**
- Consumes: everything from `extension/lib.ts` (Task 6).
- Produces: the `send_imessage` tool visible to π agents. Default export: `(pi: ExtensionAPI) => void`.

- [ ] **Step 1: Write failing tests**

`packages/pi-imessage/extension/tests/index.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import registerExtension from "../index.js";

// Minimal structural fake of ExtensionAPI — we only use registerTool.
interface ToolDef {
  name: string;
  description: string;
  parameters: {
    required?: string[];
    properties: Record<string, { maxLength?: number }>;
  };
  execute: (
    toolCallId: string,
    params: { message: string; emoji?: string },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ) => Promise<unknown>;
}

function capture(): ToolDef[] {
  const tools: ToolDef[] = [];
  const fakePi = { registerTool: (def: ToolDef) => void tools.push(def) };
  registerExtension(fakePi as never);
  return tools;
}

afterEach(() => {
  delete process.env.IMSG_CONFIG;
});

describe("extension registration", () => {
  it("registers exactly one tool: send_imessage", () => {
    const tools = capture();
    expect(tools.map((t) => t.name)).toEqual(["send_imessage"]);
  });

  it("requires message, emoji optional with maxLength 16", () => {
    const [tool] = capture();
    expect(tool.parameters.required).toEqual(["message"]);
    expect(tool.parameters.properties.emoji.maxLength).toBe(16);
  });

  it("execute rejects with setup hint when config is missing", async () => {
    process.env.IMSG_CONFIG = "/nonexistent/imsg-config.json";
    const [tool] = capture();
    const err = await tool
      .execute("id1", { message: "hi" }, undefined, undefined, { cwd: "/tmp/x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/config not found|Setup/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-imessage`
Expected: FAIL — cannot resolve `../index.js`.

- [ ] **Step 3: Implement `extension/index.ts`**

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import { Type } from "typebox";
import { computeContext, defaultConfigPath, loadProConfig, sendNotification } from "./lib.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "send_imessage",
    label: "Send iMessage",
    description:
      "Send the user a push notification via iMessage (delivered from the household agent identity). " +
      "Use when: a long-running job finishes, you need user input to proceed and the user may be away from the machine, " +
      "or something failed that is worth interrupting the user for. Do NOT use for routine progress updates. " +
      "Keep the message short and self-contained; provenance (host · project) is appended automatically.",
    promptSnippet: "Notify the user via iMessage when a job finishes, fails, or needs their input",
    parameters: Type.Object({
      message: Type.String({
        description: "The notification text. Short, self-contained, no markdown.",
      }),
      emoji: Type.Optional(
        Type.String({
          maxLength: 16,
          description:
            "Optional single status emoji prefixed to the message, e.g. ✅ done, ⏸️ input needed, ❌ failed. Omit if no status glyph fits.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const config = loadProConfig(defaultConfigPath());
      const context = computeContext(os.hostname(), ctx.cwd);
      await sendNotification({
        config,
        message: params.message,
        emoji: params.emoji,
        context,
        signal,
      });
      return {
        content: [{ type: "text", text: `iMessage sent (${context})` }],
        details: {},
      };
    },
  });
}
```

Note: errors thrown by `loadProConfig`/`sendNotification` propagate out of `execute` — that is π's documented way to mark the tool result as failed (`isError: true`), so the agent sees "NOT delivered" and can tell the user in-session.

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npm test -w pi-imessage && npm run typecheck -w pi-imessage`
Expected: both PASS.

- [ ] **Step 5: Write `README.md`**

Content requirements (write actual prose, structured as):

1. **What it is** — one paragraph; the architecture diagram from the spec.
2. **Install (Pro side)** — π package spec for `.pi/settings.json` or global settings; creating `~/.config/imsg/config.json` (`{"url":"http://<air-tailscale-name-or-ip>:8787","token":"..."}`; `chmod 600`).
3. **Air setup runbook** — copied faithfully from the spec's "Single owning account" and "Manual setup steps" sections: one owning account (`familyosadmin`); create agent Apple ID; sign Messages into it (Messages → Settings → iMessage — independent of machine iCloud); deploy `server/` to the Air (git clone or scp); `./setup.sh configure` → `./setup.sh smoke-send` (approve Automation prompt, verify in System Settings → Privacy & Security → Automation) → `./setup.sh install-agent`; add agent Apple ID to Contacts.
4. **Troubleshooting** — `tccutil reset AppleEvents`; error-code table (`AUTOMATION_NOT_AUTHORIZED` → redo smoke-send; `MESSAGES_UNAVAILABLE` → Messages not signed in / not running; `SEND_FAILED` → check `~/Library/Logs/imsg-server/err.log`); note that logs never contain tokens; grants survive reboot but may reset on macOS major upgrades or Node binary changes.
5. **Message format** — the emoji/message/context format with one example.
6. **Out of scope / roadmap** — two-way replies, CLI wrapper (config file is a stable interface), typing indicators (explicitly rejected: private API/SIP).

- [ ] **Step 6: Dogfood verification (NOT committed)**

Per AGENTS.md, local-path entries are for hot-loop development only and must not be committed. Verify without touching `.pi/settings.json` in git:

```bash
pi -e packages/pi-imessage/extension/index.ts
```

In the scratch session: confirm `send_imessage` appears in the tools list, then ask the agent to call it. Without `~/.config/imsg/config.json` present it must return a tool error containing the setup hint (validates the error path end-to-end without any server). If you add a local-path entry to `.pi/settings.json` for ongoing dogfooding, leave it uncommitted (or commit only after the package is published to a git mirror, switching the entry to the mirror spec).

- [ ] **Step 7: Commit**

```bash
git add packages/pi-imessage/extension/index.ts packages/pi-imessage/extension/tests/index.test.ts packages/pi-imessage/README.md
git commit -m "feat(pi-imessage): register send_imessage tool, README runbook"
```

---

### Task 8: Deployment & end-to-end verification (manual, with the user)

This task is a checklist executed with the user present — it cannot be fully delegated because it involves Apple ID creation, GUI prompts on the Air, and the user's phone.

**Files:** none (operational).

- [ ] **Step 1: Pre-flight (Pro).** `npm test -w pi-imessage && npm run typecheck -w pi-imessage` — all green.
- [ ] **Step 2 (user): Create agent Apple ID.** Verify with phone number.
- [ ] **Step 3 (user, on Air as `familyosadmin`):** Messages → Settings → iMessage → sign in with agent Apple ID.
- [ ] **Step 4: Deploy `server/` to the Air** (as `familyosadmin`): `scp -r packages/pi-imessage/server familyos-server:~/imsg-server` (or git clone). Requires Node ≥ 18 on the Air (`node --version`).
- [ ] **Step 5 (user, on Air GUI session):** `./setup.sh configure` — note the printed token.
- [ ] **Step 6 (user, on Air GUI session):** `./setup.sh smoke-send` — approve the Automation prompt; confirm test iMessage arrives on the user's phone from the agent identity; verify the grant in System Settings → Privacy & Security → Automation.
- [ ] **Step 7 (user, on Air):** `./setup.sh install-agent` — confirm "HTTP smoke test OK" and a second iMessage arrives (proves the launchd context is authorized).
- [ ] **Step 8 (Pro):** Create `~/.config/imsg/config.json` with `{"url":"http://familyos-server:8787","token":"<from step 5>"}`, `chmod 600`. (Try MagicDNS name first; fall back to `http://100.99.196.91:8787` if name resolution fails.)
- [ ] **Step 9 (Pro):** `curl -s http://familyos-server:8787/health` → `{"ok":true}`.
- [ ] **Step 10 (Pro):** In a π session with the package loaded, ask the agent to send a test notification via `send_imessage` → message arrives on phone with emoji prefix and `[macbook-pro · pi-extensions]` suffix.
- [ ] **Step 11 (user):** Add the agent Apple ID to Contacts with a name + avatar.
- [ ] **Step 12:** Reboot the Air; after auto-login, `curl /health` from the Pro succeeds and one more end-to-end send works (proves reboot persistence).
