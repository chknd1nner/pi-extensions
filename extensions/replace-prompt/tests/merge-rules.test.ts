import { describe, expect, it } from "vitest";
import { mergeScopeConfigs } from "../merge-rules";
import type { ScopeConfig } from "../types";

const globalConfig: ScopeConfig = {
  scope: "global",
  baseDir: "/home/.pi/agent/extensions/replace-prompt",
  logging: { file: false },
  rules: [
    {
      id: "replace-opening",
      enabled: true,
      type: "literal",
      target: "A",
      replacementSource: { kind: "inline", value: "B" },
      mode: "first",
      sourceScope: "global",
    },
    {
      id: "keep-second",
      enabled: true,
      type: "literal",
      target: "X",
      replacementSource: { kind: "inline", value: "Y" },
      mode: "first",
      sourceScope: "global",
    },
  ],
};

const projectConfig: ScopeConfig = {
  scope: "project",
  baseDir: "/repo/.pi/extensions/replace-prompt",
  logging: { file: true },
  rules: [
    { id: "replace-opening", enabled: false },
    {
      id: "append-third",
      enabled: true,
      type: "literal",
      target: "M",
      replacementSource: { kind: "inline", value: "N" },
      mode: "all",
      sourceScope: "project",
    },
  ],
};

describe("mergeScopeConfigs", () => {
  it("keeps inherited order, applies project override in place, and appends project-only rules", () => {
    const merged = mergeScopeConfigs(globalConfig, projectConfig, {
      projectDir: "/repo/.pi/extensions/replace-prompt",
      globalDir: "/home/.pi/agent/extensions/replace-prompt",
    });
    expect(merged.rules.map((rule) => rule.id)).toEqual([
      "replace-opening",
      "keep-second",
      "append-third",
    ]);
    expect(merged.rules[0]).toEqual({ id: "replace-opening", enabled: false });
    expect(merged.logging.file).toBe(true);
    expect(merged.logBaseDir).toBe("/repo/.pi/extensions/replace-prompt");
  });

  it("inherits global logging when project logging is unset", () => {
    const merged = mergeScopeConfigs(
      {
        ...globalConfig,
        logging: { file: true },
      },
      {
        ...projectConfig,
        logging: {},
      },
      {
        projectDir: "/repo/.pi/extensions/replace-prompt",
        globalDir: "/home/.pi/agent/extensions/replace-prompt",
      },
    );

    expect(merged.logging.file).toBe(true);
  });

  it("keeps the most specific installed directory for logging even when no project rules file exists", () => {
    const merged = mergeScopeConfigs(globalConfig, null, {
      projectDir: "/repo/.pi/extensions/replace-prompt",
      globalDir: "/home/.pi/agent/extensions/replace-prompt",
    });

    expect(merged.projectDir).toBe("/repo/.pi/extensions/replace-prompt");
    expect(merged.globalDir).toBe("/home/.pi/agent/extensions/replace-prompt");
    expect(merged.logBaseDir).toBe("/repo/.pi/extensions/replace-prompt");
  });

  it("returns global order when no project config exists", () => {
    const merged = mergeScopeConfigs(globalConfig, null, {
      projectDir: null,
      globalDir: "/home/.pi/agent/extensions/replace-prompt",
    });
    expect(merged.rules.map((rule) => rule.id)).toEqual([
      "replace-opening",
      "keep-second",
    ]);
    expect(merged.logBaseDir).toBe("/home/.pi/agent/extensions/replace-prompt");
  });
});
