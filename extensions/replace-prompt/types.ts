export type RuleMode = "first" | "all";
export type ScopeName = "global" | "project";

export type ReplacementSource =
  | { kind: "inline"; value: string }
  | { kind: "file"; value: string };

export type DisableRule = {
  id: string;
  enabled: false;
};

export type NormalizedLiteralRule = {
  id: string;
  enabled: true;
  type: "literal";
  target: string;
  replacementSource: ReplacementSource;
  mode: RuleMode;
  sourceScope: ScopeName;
};

export type NormalizedRegexRule = {
  id: string;
  enabled: true;
  type: "regex";
  target: RegExp;
  replacementSource: ReplacementSource;
  mode: RuleMode;
  sourceScope: ScopeName;
};

export type NormalizedRule = DisableRule | NormalizedLiteralRule | NormalizedRegexRule;

export type ScopeConfig = {
  scope: ScopeName;
  baseDir: string;
  logging: { file: boolean };
  rules: NormalizedRule[];
};

export type MergedConfig = {
  logging: { file: boolean };
  rules: NormalizedRule[];
  projectDir: string | null;
  globalDir: string | null;
  logBaseDir: string | null;
};
