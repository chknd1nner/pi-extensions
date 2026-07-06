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
    const authHeaders: Array<Record<string, string>> = [{}, { authorization: "Bearer wrong-token" }];
    for (const headers of authHeaders) {
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

  it("400 JSON (not a socket error) on oversized body; send not called", async () => {
    let sendCalls = 0;
    const base = await start(async () => {
      sendCalls += 1;
    });
    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(70 * 1024) }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "body too large" });
    expect(sendCalls).toBe(0);
  });

  it("401 generic body on wrong token even with a huge body (auth before body read)", async () => {
    let sendCalls = 0;
    const base = await start(async () => {
      sendCalls += 1;
    });
    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(70 * 1024) }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(sendCalls).toBe(0);
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
