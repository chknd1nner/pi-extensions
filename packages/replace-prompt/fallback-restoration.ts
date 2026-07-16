import { findExactStringPaths, getValueAtPath, replaceValueAtPath } from "./payload-path";
import { sameTransformationContext } from "./transformation-context";
import type { LogEvent, PromptPath, TransformationContextIdentity } from "./types";

export type BeginTransformationInput = {
  source: string;
  result: string;
  context: TransformationContextIdentity;
};

export type ProviderPayloadOutcome = {
  replacement?: unknown;
  events: LogEvent[];
};

type ActiveTransformation = BeginTransformationInput & {
  promptPath?: PromptPath;
  discoveryWarningLogged: boolean;
  stalePathWarningLogged: boolean;
};

export class PromptFallbackRestorer {
  private active: ActiveTransformation | null = null;

  begin(input: BeginTransformationInput): void {
    this.active = {
      ...input,
      context: { ...input.context },
      discoveryWarningLogged: false,
      stalePathWarningLogged: false,
    };
  }

  clear(): void {
    this.active = null;
  }

  handleProviderPayload(
    payload: unknown,
    context: TransformationContextIdentity,
  ): ProviderPayloadOutcome {
    const active = this.active;
    if (!active || !sameTransformationContext(active.context, context)) {
      return { events: [] };
    }

    if (active.promptPath === undefined) {
      const matches = findExactStringPaths(payload, active.result);
      const [promptPath] = matches;
      if (matches.length === 1 && promptPath !== undefined) {
        active.promptPath = promptPath;
        return {
          events: [{ level: "info", message: "provider prompt path learned" }],
        };
      }

      if (active.discoveryWarningLogged) {
        return { events: [] };
      }

      active.discoveryWarningLogged = true;
      return {
        events: [
          {
            level: "warn",
            message:
              matches.length === 0
                ? "provider prompt path was not found"
                : "provider prompt path discovery was ambiguous",
          },
        ],
      };
    }

    const lookup = getValueAtPath(payload, active.promptPath);
    if (!lookup.found || (lookup.value !== active.source && lookup.value !== active.result)) {
      if (active.stalePathWarningLogged) {
        return { events: [] };
      }

      active.stalePathWarningLogged = true;
      return {
        events: [{ level: "warn", message: "provider prompt path was stale" }],
      };
    }

    if (lookup.value === active.result) {
      return { events: [] };
    }

    const replacement = replaceValueAtPath(
      payload,
      active.promptPath,
      active.source,
      active.result,
    );
    if (!replacement.changed) {
      return { events: [] };
    }

    return {
      replacement: replacement.value,
      events: [{ level: "info", message: "provider fallback prompt restored" }],
    };
  }
}
