import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import replacePrompt from "../index";

type Handler = (event: any, ctx: any) => unknown | Promise<unknown>;

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalConditionValue = process.env.REPLACE_PROMPT_TEST_CONTEXT;
const originalUnrelatedValue = process.env.REPLACE_PROMPT_TEST_UNRELATED;

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalConditionValue === undefined) {
    delete process.env.REPLACE_PROMPT_TEST_CONTEXT;
  } else {
    process.env.REPLACE_PROMPT_TEST_CONTEXT = originalConditionValue;
  }
  if (originalUnrelatedValue === undefined) {
    delete process.env.REPLACE_PROMPT_TEST_UNRELATED;
  } else {
    process.env.REPLACE_PROMPT_TEST_UNRELATED = originalUnrelatedValue;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function configuredProject(config: string) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
  tempDirs.push(projectRoot, homeDir);
  process.env.HOME = homeDir;

  const configDir = path.join(projectRoot, ".pi/replace-prompt");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "rules.ts"), config);
  return { projectRoot, configDir };
}

function registerHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  replacePrompt({
    on(eventName: string, handler: Handler) {
      handlers[eventName] = handler;
    },
  } as any);
  return handlers;
}

function context(cwd: string, overrides: Record<string, unknown> = {}) {
  const { model, ...rest } = overrides;
  return {
    cwd,
    ...rest,
    model: {
      provider: "provider-a",
      api: "api-a",
      id: "model-a",
      ...(model as Record<string, unknown> | undefined),
    },
  };
}

async function transform(
  handler: Handler,
  systemPrompt: string,
  cwd: string,
  ctx = context(cwd),
) {
  return handler(
    { type: "before_agent_start", prompt: "test", systemPrompt, systemPromptOptions: {} },
    ctx,
  );
}

describe("provider fallback integration", () => {
  it("registers lifecycle, agent-start, and provider-boundary handlers", () => {
    const handlers = registerHandlers();

    expect(handlers.session_start).toEqual(expect.any(Function));
    expect(handlers.before_agent_start).toEqual(expect.any(Function));
    expect(handlers.before_provider_request).toEqual(expect.any(Function));
  });

  it("uses ctx.cwd as the authoritative config-discovery cwd", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const handlers = registerHandlers();

    expect(
      await handlers.before_agent_start(
        {
          type: "before_agent_start",
          prompt: "test",
          systemPrompt: "Hello",
          systemPromptOptions: {},
          cwd: path.join(projectRoot, "event-cwd-must-not-win"),
        },
        context(projectRoot),
      ),
    ).toEqual({ systemPrompt: "Hi" });
  });

  it("learns RP once and restores exact BP only at the learned path", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "grow-foo", type: "literal", target: "foo", replacement: "foobar" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    expect(await transform(handlers.before_agent_start, "foo", projectRoot, ctx)).toEqual({
      systemPrompt: "foobar",
    });

    const learnedPayload = {
      system: [{ text: "foobar" }],
      messages: [{ content: "hello" }],
    };
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: learnedPayload },
        ctx,
      ),
    ).toBeUndefined();

    const cacheControl = { type: "ephemeral" };
    const userMessages = [{ content: "foo" }];
    const fallbackPayload = {
      system: [{ text: "foo", cache_control: cacheControl }],
      messages: userMessages,
    };
    const repaired = await handlers.before_provider_request(
      { type: "before_provider_request", payload: fallbackPayload },
      ctx,
    );

    expect(repaired).toEqual({
      system: [{ text: "foobar", cache_control: cacheControl }],
      messages: [{ content: "foo" }],
    });
    expect((repaired as typeof fallbackPayload).messages).toBe(userMessages);
    expect((repaired as typeof fallbackPayload).system[0].cache_control).toBe(cacheControl);
    expect(fallbackPayload.system[0].text).toBe("foo");
  });

  it("clears an obsolete transformation after an unchanged agent start or new session", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Hi" } },
      ctx,
    );
    expect(await transform(handlers.before_agent_start, "No match", projectRoot, ctx)).toBeUndefined();
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Hi" } },
      ctx,
    );
    await handlers.session_start({ type: "session_start", reason: "resume" }, ctx);
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("skips path learning when an unrelated environment entry changes first", async () => {
    process.env.REPLACE_PROMPT_TEST_UNRELATED = "before";
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    process.env.REPLACE_PROMPT_TEST_UNRELATED = "after";

    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hi" } },
        ctx,
      ),
    ).toBeUndefined();
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("clears remembered state when configuration reload fails", async () => {
    const { projectRoot, configDir } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Hi" } },
      ctx,
    );

    fs.writeFileSync(path.join(configDir, "rules.ts"), "export default {");
    expect(await transform(handlers.before_agent_start, "Hello", projectRoot, ctx)).toBeUndefined();
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("returns a valid scope replacement but disables restoration when another scope fails", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const globalConfigDir = path.join(process.env.HOME!, ".pi/agent/replace-prompt");
    fs.mkdirSync(globalConfigDir, { recursive: true });
    fs.writeFileSync(path.join(globalConfigDir, "rules.ts"), "export default {");
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    expect(await transform(handlers.before_agent_start, "Hello", projectRoot, ctx)).toEqual({
      systemPrompt: "Hi",
    });
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hi" } },
        ctx,
      ),
    ).toBeUndefined();
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("clears learned state before a later agent start throws while logging", async () => {
    const { projectRoot, configDir } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Hi" } },
      ctx,
    );

    fs.writeFileSync(path.join(configDir, "rules.ts"), `export default {
      logging: { file: true },
      rules: [{ id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }]
    };`);
    fs.mkdirSync(path.join(configDir, "replace-prompt.log"));

    await expect(transform(handlers.before_agent_start, "Hello", projectRoot, ctx)).rejects.toThrow();
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("does not reuse a conditional result across model, cwd, or environment changes", async () => {
    process.env.REPLACE_PROMPT_TEST_CONTEXT = "enabled";
    const { projectRoot } = configuredProject(`export default { rules: [
      {
        id: "conditional-opening",
        type: "literal",
        target: "Hello",
        replacement: "Conditional hi",
        condition: (ctx) =>
          ctx.model === "model-a" &&
          ctx.cwd.includes("replace-prompt-project-") &&
          ctx.env.REPLACE_PROMPT_TEST_CONTEXT === "enabled"
      }
    ] };`);
    const handlers = registerHandlers();
    const originalContext = context(projectRoot);

    expect(
      await transform(handlers.before_agent_start, "Hello", projectRoot, originalContext),
    ).toEqual({ systemPrompt: "Conditional hi" });
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Conditional hi" } },
      originalContext,
    );

    const fallback = { type: "before_provider_request", payload: { system: "Hello" } };
    expect(
      await handlers.before_provider_request(
        fallback,
        context(projectRoot, { model: { id: "model-b" } }),
      ),
    ).toBeUndefined();
    expect(
      await handlers.before_provider_request(fallback, context(path.join(projectRoot, "other"))),
    ).toBeUndefined();

    process.env.REPLACE_PROMPT_TEST_CONTEXT = "disabled";
    expect(await handlers.before_provider_request(fallback, originalContext)).toBeUndefined();
  });

  it("treats assembled SYSTEM content as opaque while preserving exact CRLF and Unicode comparison", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "unicode-opening", type: "literal", target: "Hello\\n🌍", replacement: "Hi\\n🌍" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);
    const source = "Project SYSTEM.md persona\r\nHello\r\n🌍\r\n";
    const result = "Project SYSTEM.md persona\nHi\n🌍\n";

    expect(await transform(handlers.before_agent_start, source, projectRoot, ctx)).toEqual({
      systemPrompt: result,
    });
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { instructions: result } },
      ctx,
    );

    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { instructions: source } },
        ctx,
      ),
    ).toEqual({ instructions: result });
  });

  it("logs path learning and restoration without logging prompt contents", async () => {
    const { projectRoot, configDir } = configuredProject(`export default {
      logging: { file: true },
      rules: [
        {
          id: "secret-opening",
          type: "literal",
          target: "VERY_SECRET_BP",
          replacement: "VERY_SECRET_RP"
        }
      ]
    };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "VERY_SECRET_BP", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "VERY_SECRET_RP" } },
      ctx,
    );
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "VERY_SECRET_BP" } },
      ctx,
    );

    const logText = fs.readFileSync(path.join(configDir, "replace-prompt.log"), "utf8");
    expect(logText).toContain("[info] provider prompt path learned");
    expect(logText).toContain("[info] provider fallback prompt restored");
    expect(logText).not.toContain("VERY_SECRET_BP");
    expect(logText).not.toContain("VERY_SECRET_RP");
  });
});
