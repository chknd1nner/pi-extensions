import type { ApplyResult, ApplyRuntimeContext, ConditionContext, LogEvent, NormalizedRule } from "./types";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function cloneRegexForMode(regex: RegExp, mode: "first" | "all"): RegExp {
  const stripped = regex.flags.replace(/g/g, "");
  const flags = mode === "all" ? `${stripped}g` : stripped;
  return new RegExp(regex.source, flags);
}

export function applyRulesToPrompt(
  systemPrompt: string,
  rules: NormalizedRule[],
  resolveReplacement: (rule: Exclude<NormalizedRule, { enabled: false }>) => string | null,
  runtime: ApplyRuntimeContext,
): ApplyResult {
  const events: LogEvent[] = [];
  const normalizedOriginal = normalizeLineEndings(systemPrompt);
  let nextPrompt = normalizedOriginal;

  for (const rule of rules) {
    if (rule.enabled === false) {
      events.push({ level: "info", message: "rule disabled", ruleId: rule.id });
      continue;
    }

    if (rule.condition) {
      const conditionContext: ConditionContext = {
        model: runtime.model,
        cwd: runtime.cwd,
        systemPrompt: nextPrompt,
        originalSystemPrompt: normalizedOriginal,
        env: runtime.env,
      };

      let conditionResult: unknown;
      try {
        conditionResult = rule.condition(conditionContext);
      } catch {
        events.push({ level: "warn", message: "condition threw", ruleId: rule.id });
        continue;
      }

      if (typeof conditionResult !== "boolean") {
        events.push({ level: "warn", message: "condition returned non-boolean", ruleId: rule.id });
        continue;
      }

      if (conditionResult === false) {
        events.push({ level: "info", message: "rule skipped by condition", ruleId: rule.id });
        continue;
      }
    }

    const resolvedReplacement = resolveReplacement(rule);
    if (resolvedReplacement === null) {
      events.push({ level: "warn", message: "replacement file not found", ruleId: rule.id });
      continue;
    }

    const replacement = normalizeLineEndings(resolvedReplacement);

    if (rule.type === "literal") {
      const target = normalizeLineEndings(rule.target);
      if (!nextPrompt.includes(target)) {
        events.push({ level: "warn", message: "rule did not match at application time", ruleId: rule.id });
        continue;
      }

      nextPrompt =
        rule.mode === "all"
          ? nextPrompt.split(target).join(replacement)
          : nextPrompt.replace(target, () => replacement);
      events.push({ level: "info", message: "rule applied", ruleId: rule.id });
      continue;
    }

    const matcher = cloneRegexForMode(rule.target, rule.mode);
    if (!matcher.test(nextPrompt)) {
      events.push({ level: "warn", message: "rule did not match at application time", ruleId: rule.id });
      continue;
    }

    nextPrompt = nextPrompt.replace(matcher, replacement);
    events.push({ level: "info", message: "rule applied", ruleId: rule.id });
  }

  return {
    changed: nextPrompt !== normalizedOriginal,
    systemPrompt: nextPrompt,
    events,
  };
}
