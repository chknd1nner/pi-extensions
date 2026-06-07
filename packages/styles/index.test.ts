import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerStyles, defaultStyleRoots } from "./index";

type Notification = { message: string; type?: string };
type SelectCall = { title: string; options: string[] };

type Harness = {
  dir: string;
  entries: any[];
  notifications: Notification[];
  statuses: Map<string, string | undefined>;
  commands: Map<string, any>;
  handlers: Map<string, any>;
  selectCalls: SelectCall[];
  ctx: any;
  write(rel: string, text: string): void;
  chooseNext(option: string): void;
  runCommand(args: string): Promise<void>;
  triggerSessionStart(): Promise<void>;
  triggerBeforeProviderRequest(payload: any): Promise<any>;
};

const tempDirs: string[] = [];

function createHarness(model = { id: "claude-sonnet-4-5", api: "anthropic-messages" }): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-styles-index-"));
  tempDirs.push(dir);

  const entries: any[] = [];
  const notifications: Notification[] = [];
  const statuses = new Map<string, string | undefined>();
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  const selectCalls: SelectCall[] = [];
  let nextSelection: string | undefined;

  const ctx: any = {
    model,
    sessionManager: {
      getBranch: () => entries,
    },
    ui: {
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      notify: (message: string, type?: string) => notifications.push({ message, type }),
      select: async (title: string, options: string[]) => {
        selectCalls.push({ title, options });
        return nextSelection ?? options[0];
      },
      input: async () => "new style",
      editor: async (_title: string, seed: string) => seed,
      confirm: async () => true,
    },
  };

  const pi: any = {
    on: (name: string, handler: any) => handlers.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
  };

  registerStyles(pi, { styleDir: dir });

  return {
    dir,
    entries,
    notifications,
    statuses,
    commands,
    handlers,
    selectCalls,
    ctx,
    write(rel: string, text: string) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, "utf8");
    },
    chooseNext(option: string) {
      nextSelection = option;
    },
    async runCommand(args: string) {
      await commands.get("style").handler(args, ctx);
    },
    async triggerSessionStart() {
      await handlers.get("session_start")({}, ctx);
    },
    async triggerBeforeProviderRequest(payload: any) {
      return handlers.get("before_provider_request")({ payload }, ctx);
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("styles extension mode restoration", () => {
  it("restores a manual variant-folder style without requiring <name>.md", async () => {
    const h = createHarness();
    h.write("thought/default.md", "Default thought style");
    h.entries.push({ type: "custom", customType: "styles:active", data: { name: "thought" } });

    await h.triggerSessionStart();

    expect(h.statuses.get("style")).toBe("style: thought");

    const payload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(payload);

    expect(payload.messages[0].content.at(-1)).toEqual({
      type: "text",
      text: "Default thought style",
    });
  });

  it("restores auto mode and shows style: auto before the first request", async () => {
    const h = createHarness();
    h.entries.push({ type: "custom", customType: "styles:active", data: { auto: true } });

    await h.triggerSessionStart();

    expect(h.statuses.get("style")).toBe("style: auto");
  });
});

describe("styles extension commands", () => {
  it("/style auto persists auto mode and confirms it in the footer immediately", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.write("_config.json", JSON.stringify({ auto: [{ model: "claude-sonnet-4-5", style: "concise" }] }));

    await h.runCommand("auto");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { auto: true } });
    expect(h.statuses.get("style")).toBe("style: auto");
    expect(h.notifications.at(-1)).toEqual({ message: "Auto style mode enabled.", type: "info" });
  });

  it("reserved direct arguments are commands even when same-named style files exist", async () => {
    const h = createHarness();
    h.write("auto.md", "This style cannot be selected by direct /style auto");

    await h.runCommand("auto");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { auto: true } });
    expect(h.statuses.get("style")).toBe("style: auto");
  });

  it("/style off persists off mode and clears the footer", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");

    await h.runCommand("concise");
    await h.runCommand("off");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { name: null } });
    expect(h.statuses.get("style")).toBeUndefined();
  });

  it("does not keep autocomplete active for exact auto/off arguments", () => {
    const h = createHarness();
    const completions = h.commands.get("style").getArgumentCompletions;

    expect(completions("au")).toEqual([{ value: "auto", label: "auto (choose style by model)" }]);
    expect(completions("of")).toEqual([{ value: "off", label: "off (turn off)" }]);
    expect(completions("auto")).toBeNull();
    expect(completions("off")).toBeNull();
  });

  it("/style picker activates a style by its displayed label and marks the current mode", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.write("thought-catalyst/default.md", "Think deeply");
    h.chooseNext("  thought-catalyst");

    await h.runCommand("");

    expect(h.selectCalls[0]).toEqual({
      title: "Output style",
      options: [
        "  concise",
        "  thought-catalyst",
        "  Auto (choose style by model)",
        "✓ None (turn off styles)",
        "➕  Create new style…",
      ],
    });
    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { name: "thought-catalyst" } });
    expect(h.statuses.get("style")).toBe("style: thought-catalyst");
  });

  it("/style picker auto action persists auto mode", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.chooseNext("  Auto (choose style by model)");

    await h.runCommand("");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { auto: true } });
    expect(h.statuses.get("style")).toBe("style: auto");
  });

  it("/style picker create action writes and activates a simple style", async () => {
    const h = createHarness();
    h.chooseNext("➕  Create new style…");

    await h.runCommand("");

    expect(fs.existsSync(path.join(h.dir, "new-style.md"))).toBe(true);
    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { name: "new-style" } });
    expect(h.statuses.get("style")).toBe("style: new-style");
  });
});

describe("defaultStyleRoots", () => {
  it("returns project and home in priority order at the canonical paths", () => {
    expect(defaultStyleRoots("/repo", "/home/u")).toEqual([
      { dir: path.join("/repo", ".pi", "styles"), scope: "project" },
      { dir: path.join("/home/u", ".pi", "agent", "styles"), scope: "home" },
    ]);
  });
});

describe("styles extension layered discovery via styleRoots option", () => {
  it("discovers project and home styles together, with project shadowing same name", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-styles-proj-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-styles-home-"));
    tempDirs.push(projectDir, homeDir);

    fs.writeFileSync(path.join(projectDir, "concise.md"), "PROJECT", "utf8");
    fs.writeFileSync(path.join(homeDir, "concise.md"), "HOME", "utf8");
    fs.writeFileSync(path.join(homeDir, "verbose.md"), "HOME verbose", "utf8");

    const entries: any[] = [];
    const notifications: any[] = [];
    const statuses = new Map<string, string | undefined>();
    const handlers = new Map<string, any>();
    const commands = new Map<string, any>();
    const selectCalls: { title: string; options: string[] }[] = [];

    const ctx: any = {
      model: { id: "claude-sonnet-4-5", api: "anthropic-messages" },
      sessionManager: { getBranch: () => entries },
      ui: {
        setStatus: (k: string, v: string | undefined) => statuses.set(k, v),
        notify: (m: string, t?: string) => notifications.push({ message: m, type: t }),
        select: async (title: string, options: string[]) => {
          selectCalls.push({ title, options });
          return options[0];
        },
      },
    };
    const pi: any = {
      on: (n: string, h: any) => handlers.set(n, h),
      registerCommand: (n: string, c: any) => commands.set(n, c),
      appendEntry: (t: string, d: unknown) => entries.push({ type: "custom", customType: t, data: d }),
    };

    registerStyles(pi, {
      styleRoots: [
        { dir: projectDir, scope: "project" },
        { dir: homeDir, scope: "home" },
      ],
    });

    // Project /style concise must resolve to PROJECT (not HOME).
    await commands.get("style").handler("concise", ctx);
    const payload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await handlers.get("before_provider_request")({ payload }, ctx);
    expect(payload.messages[0].content.at(-1).text).toBe("PROJECT");

    // Picker must show both project's concise (winning) and home's verbose, tagged with scope.
    await commands.get("style").handler("", ctx);
    const opts = selectCalls.at(-1)!.options;
    expect(opts.some((o) => /concise.*\(project\)/.test(o))).toBe(true);
    expect(opts.some((o) => /verbose.*\(home\)/.test(o))).toBe(true);
    // 'concise' from home must NOT also appear as a separate entry.
    expect(opts.filter((o) => /\bconcise\b/.test(o))).toHaveLength(1);
  });
});

describe("styles extension request-time resolution", () => {
  it("injects exact manual model-ID variants and falls back to default.md", async () => {
    const h = createHarness();
    h.write("thought/default.md", "Default thought style");
    h.write("thought/claude-sonnet-4-5.md", "Claude thought style");

    await h.runCommand("thought");

    const payload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(payload);

    expect(payload.messages[0].content.at(-1).text).toBe(
      "Claude thought style",
    );

    h.ctx.model = { id: "openrouter/claude", api: "anthropic-messages" };
    const fallbackPayload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(fallbackPayload);

    expect(fallbackPayload.messages[0].content.at(-1).text).toBe(
      "Default thought style",
    );
  });

  it("auto mode resolves on each request, updates footer, and injects the resolved style", async () => {
    const h = createHarness({ id: "gpt-5.4", api: "openai-responses" });
    h.write("concise.md", "Be concise");
    h.write("_config.json", JSON.stringify({ auto: [{ model: ["gpt-5.4", "gpt-5.4-mini"], style: "concise" }] }));

    await h.runCommand("auto");

    const payload: any = { input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }] };
    await h.triggerBeforeProviderRequest(payload);

    expect(h.statuses.get("style")).toBe("style: concise (auto)");
    expect(h.notifications).toContainEqual({ message: "Auto style resolved to 'concise'.", type: "info" });
    expect(payload.input.at(-1)).toEqual({
      role: "user",
      content: [{ type: "input_text", text: "Be concise" }],
    });
  });

  it("auto mode with no matching config keeps style: auto and injects nothing", async () => {
    const h = createHarness();
    h.write("_config.json", JSON.stringify({ auto: [{ model: "gpt-5.4", style: "concise" }] }));

    await h.runCommand("auto");

    const payload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(payload);

    expect(h.statuses.get("style")).toBe("style: auto");
    expect(payload.messages[0].content).toEqual([{ type: "text", text: "Hello" }]);
  });
});
