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
