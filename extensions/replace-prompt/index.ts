import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { applyRulesToPrompt } from "./apply-rules";
import { appendLog } from "./logging";
import { loadScopeConfig, selectLogPath } from "./load-config";
import { mergeScopeConfigs } from "./merge-rules";
import { resolveReplacementText } from "./resolve-replacement";

function getScopeDirs(cwd: string) {
  const globalDir = process.env.HOME
    ? path.join(process.env.HOME, ".pi/agent/extensions/replace-prompt")
    : null;
  const projectDir = path.join(cwd, ".pi/extensions/replace-prompt");

  return {
    globalDir,
    projectDir,
  };
}

export default function replacePrompt(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event: any) => {
    const cwd = event.cwd ?? process.cwd();
    const installedDirs = getScopeDirs(cwd);

    const globalConfig = installedDirs.globalDir
      ? await loadScopeConfig("global", installedDirs.globalDir).catch(() => null)
      : null;
    const projectConfig = await loadScopeConfig("project", installedDirs.projectDir).catch(() => null);
    const merged = mergeScopeConfigs(globalConfig, projectConfig, installedDirs);

    if (merged.rules.length === 0) {
      return undefined;
    }

    const result = applyRulesToPrompt(event.systemPrompt ?? "", merged.rules, (rule) =>
      resolveReplacementText(rule, {
        globalDir: merged.globalDir,
        projectDir: merged.projectDir,
      }),
    );

    if (merged.logging.file) {
      appendLog(
        selectLogPath({
          projectDir: merged.projectDir,
          globalDir: merged.globalDir,
        }),
        result.events,
      );
    }

    if (!result.changed) {
      return undefined;
    }

    return { systemPrompt: result.systemPrompt };
  });
}
