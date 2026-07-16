import { createHash } from "node:crypto";
import type { TransformationContextIdentity } from "./types";

export type ModelIdentityInput =
  | {
      provider?: unknown;
      api?: unknown;
      id?: unknown;
    }
  | null
  | undefined;

function stringPart(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createModelKey(model: ModelIdentityInput): string {
  return JSON.stringify([
    stringPart(model?.provider),
    stringPart(model?.api),
    stringPart(model?.id),
  ]);
}

export function fingerprintEnvironment(env: NodeJS.ProcessEnv): string {
  const entries = Object.keys(env)
    .sort()
    .flatMap((key) => {
      const value = env[key];
      return value === undefined ? [] : [[key, value] as const];
    });

  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

export function createTransformationContext(
  cwd: string,
  model: ModelIdentityInput,
  env: NodeJS.ProcessEnv,
): TransformationContextIdentity {
  return {
    cwd,
    modelKey: createModelKey(model),
    environmentFingerprint: fingerprintEnvironment(env),
  };
}

export function sameTransformationContext(
  left: TransformationContextIdentity,
  right: TransformationContextIdentity,
): boolean {
  return (
    left.cwd === right.cwd &&
    left.modelKey === right.modelKey &&
    left.environmentFingerprint === right.environmentFingerprint
  );
}
