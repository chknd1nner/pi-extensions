import { describe, expect, it } from "vitest";
import { PromptFallbackRestorer } from "../fallback-restoration";
import type { TransformationContextIdentity } from "../types";

const context: TransformationContextIdentity = {
  cwd: "/repo",
  modelKey: "model-key",
  environmentFingerprint: "environment-key",
};

function begin(restorer: PromptFallbackRestorer, source = "BP", result = "RP") {
  restorer.begin({ source, result, context });
}

describe("PromptFallbackRestorer", () => {
  it("learns one exact result path without changing the discovery payload", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    const payload = { system: [{ text: "RP" }], messages: [{ content: "hello" }] };

    expect(restorer.handleProviderPayload(payload, context)).toEqual({
      events: [{ level: "info", message: "provider prompt path learned" }],
    });
    expect(restorer.handleProviderPayload(payload, context)).toEqual({ events: [] });
  });

  it("repairs only the learned path and never reapplies replacement rules", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer, "foo", "foobar");
    restorer.handleProviderPayload({ system: { text: "foobar" } }, context);

    const userMessages = [{ content: "foo" }];
    const payload = { system: { text: "foo" }, messages: userMessages };
    const outcome = restorer.handleProviderPayload(payload, context);

    expect(outcome.events).toEqual([
      { level: "info", message: "provider fallback prompt restored" },
    ]);
    expect(outcome.replacement).toEqual({
      system: { text: "foobar" },
      messages: [{ content: "foo" }],
    });
    expect((outcome.replacement as typeof payload).messages).toBe(userMessages);
    expect((outcome.replacement as typeof payload).system.text).toBe("foobar");
    expect((outcome.replacement as typeof payload).system.text).not.toBe("foobarbar");
  });

  it("does not learn an ambiguous path and deduplicates its warning", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    const payload = { system: { text: "RP" }, messages: [{ content: "RP" }] };

    expect(restorer.handleProviderPayload(payload, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path discovery was ambiguous" }],
    });
    expect(restorer.handleProviderPayload(payload, context)).toEqual({ events: [] });
    expect(restorer.handleProviderPayload({ system: { text: "BP" } }, context)).toEqual({
      events: [],
    });
  });

  it("deduplicates the warning when no exact result path exists", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);

    expect(restorer.handleProviderPayload({ system: { text: "other" } }, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path was not found" }],
    });
    expect(restorer.handleProviderPayload({ system: { text: "other" } }, context)).toEqual({
      events: [],
    });
  });

  it("does not learn a path when the environment changes before discovery", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    const changedEnvironment = {
      ...context,
      environmentFingerprint: "changed-before-discovery",
    };

    expect(
      restorer.handleProviderPayload({ system: { text: "RP" } }, changedEnvironment),
    ).toEqual({ events: [] });
    expect(
      restorer.handleProviderPayload({ system: { text: "BP" } }, changedEnvironment),
    ).toEqual({ events: [] });
  });

  it("fails open when cwd, model, or environment identity differs", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    restorer.handleProviderPayload({ system: { text: "RP" } }, context);

    for (const mismatch of [
      { ...context, cwd: "/other" },
      { ...context, modelKey: "other-model" },
      { ...context, environmentFingerprint: "other-environment" },
    ]) {
      expect(restorer.handleProviderPayload({ system: { text: "BP" } }, mismatch)).toEqual({
        events: [],
      });
    }
  });

  it("fails open for a stale learned path and logs only one warning", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    restorer.handleProviderPayload({ system: { text: "RP" } }, context);

    expect(restorer.handleProviderPayload({ instructions: "BP" }, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path was stale" }],
    });
    expect(restorer.handleProviderPayload({ instructions: "BP" }, context)).toEqual({ events: [] });
  });

  it("clears state and replaces an older transformation when begin is called again", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer, "old BP", "old RP");
    restorer.handleProviderPayload({ system: "old RP" }, context);

    begin(restorer, "new BP", "new RP");
    expect(restorer.handleProviderPayload({ system: "new RP" }, context).events).toEqual([
      { level: "info", message: "provider prompt path learned" },
    ]);
    expect(restorer.handleProviderPayload({ system: "old BP" }, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path was stale" }],
    });

    restorer.clear();
    expect(restorer.handleProviderPayload({ system: "new BP" }, context)).toEqual({ events: [] });
  });
});
