import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyRulesToPrompt } from "./apply-rules";
import { PromptFallbackRestorer } from "./fallback-restoration";
import { appendLog } from "./logging";
import { loadScopeConfig, selectLogPath } from "./load-config";
import { mergeScopeConfigs } from "./merge-rules";
import { resolveReplacementText } from "./resolve-replacement";
import { createTransformationContext } from "./transformation-context";

function getScopeDirs(cwd: string) {
  const globalCandidate = process.env.HOME
    ? path.join(process.env.HOME, ".pi/agent/replace-prompt")
    : null;
  const projectCandidate = path.join(cwd, ".pi/replace-prompt");

  return {
    globalDir: globalCandidate && fs.existsSync(globalCandidate) ? globalCandidate : null,
    projectDir: fs.existsSync(projectCandidate) ? projectCandidate : null,
  };
}

export default function replacePrompt(pi: ExtensionAPI) {
  const restorer = new PromptFallbackRestorer();
  let providerLogPath: string | null = null;

  pi.on("session_start", () => {
    restorer.clear();
    providerLogPath = null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    restorer.clear();
    providerLogPath = null;

    const cwd = ctx.cwd;
    const installedDirs = getScopeDirs(cwd);
    let scopeLoadFailed = false;

    const globalConfig = installedDirs.globalDir
      ? await loadScopeConfig("global", installedDirs.globalDir).catch(() => {
          scopeLoadFailed = true;
          return null;
        })
      : null;
    const projectConfig = installedDirs.projectDir
      ? await loadScopeConfig("project", installedDirs.projectDir).catch(() => {
          scopeLoadFailed = true;
          return null;
        })
      : null;
    const merged = mergeScopeConfigs(globalConfig, projectConfig, installedDirs);

    const basePrompt = event.systemPrompt ?? "";
    const result =
      merged.rules.length === 0
        ? { changed: false, systemPrompt: basePrompt, events: [] }
        : applyRulesToPrompt(
            basePrompt,
            merged.rules,
            (rule) =>
              resolveReplacementText(rule, {
                globalDir: merged.globalDir,
                projectDir: merged.projectDir,
              }),
            {
              cwd,
              model: ctx.model?.id,
              env: process.env,
            },
          );

    const allEvents = [...merged.events, ...result.events];
    const logPath = merged.logging.file
      ? selectLogPath({
          projectDir: merged.projectDir,
          globalDir: merged.globalDir,
        })
      : null;

    if (logPath) {
      appendLog(logPath, allEvents);
    }

    if (!result.changed) {
      return undefined;
    }

    if (!scopeLoadFailed) {
      restorer.begin({
        source: basePrompt,
        result: result.systemPrompt,
        context: createTransformationContext(cwd, ctx.model, process.env),
      });
      providerLogPath = logPath;
    }

    return { systemPrompt: result.systemPrompt };
  });

  pi.on("before_provider_request", (event, ctx) => {
    const outcome = restorer.handleProviderPayload(
      event.payload,
      createTransformationContext(ctx.cwd, ctx.model, process.env),
    );

    if (providerLogPath) {
      appendLog(providerLogPath, outcome.events);
    }

    return outcome.replacement;
  });
}
