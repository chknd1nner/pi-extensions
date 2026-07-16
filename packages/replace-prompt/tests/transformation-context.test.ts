import { describe, expect, it } from "vitest";
import {
  createModelKey,
  createTransformationContext,
  fingerprintEnvironment,
  sameTransformationContext,
} from "../transformation-context";

describe("transformation context identity", () => {
  it("includes provider, API family, and model ID in the model key", () => {
    const baseline = createModelKey({ provider: "provider-a", api: "api-a", id: "model-a" });

    expect(createModelKey({ provider: "provider-b", api: "api-a", id: "model-a" })).not.toBe(baseline);
    expect(createModelKey({ provider: "provider-a", api: "api-b", id: "model-a" })).not.toBe(baseline);
    expect(createModelKey({ provider: "provider-a", api: "api-a", id: "model-b" })).not.toBe(baseline);
    expect(createModelKey(undefined)).toBe(createModelKey(null));
  });

  it("fingerprints environment entries independently of insertion order", () => {
    const first = { BETA: "two", ALPHA: "one" } as NodeJS.ProcessEnv;
    const second = { ALPHA: "one", BETA: "two" } as NodeJS.ProcessEnv;

    expect(fingerprintEnvironment(first)).toBe(fingerprintEnvironment(second));
  });

  it("changes the environment fingerprint when a supported condition input changes", () => {
    const baseline = fingerprintEnvironment({ FEATURE: "on" } as NodeJS.ProcessEnv);

    expect(fingerprintEnvironment({ FEATURE: "off" } as NodeJS.ProcessEnv)).not.toBe(baseline);
    expect(fingerprintEnvironment({ FEATURE: "on", EXTRA: "1" } as NodeJS.ProcessEnv)).not.toBe(baseline);
  });

  it("returns an opaque SHA-256 digest rather than environment contents", () => {
    const fingerprint = fingerprintEnvironment({ TOKEN: "super-secret-value" } as NodeJS.ProcessEnv);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("TOKEN");
    expect(fingerprint).not.toContain("super-secret-value");
  });

  it("compares cwd, model, and environment as one identity", () => {
    const baseline = createTransformationContext(
      "/repo",
      { provider: "provider-a", api: "api-a", id: "model-a" },
      { FEATURE: "on" } as NodeJS.ProcessEnv,
    );

    expect(sameTransformationContext(baseline, { ...baseline })).toBe(true);
    expect(sameTransformationContext(baseline, { ...baseline, cwd: "/other" })).toBe(false);
    expect(sameTransformationContext(baseline, { ...baseline, modelKey: "other" })).toBe(false);
    expect(
      sameTransformationContext(baseline, { ...baseline, environmentFingerprint: "other" }),
    ).toBe(false);
  });
});
