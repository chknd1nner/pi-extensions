export interface CodeAnchor { language: string; rule: Record<string, unknown>; files: string[]; }
export interface BehaviorAnchor { raw: string; path: string; testName: string; }
export type Anchor =
  | { kind: "code"; label: string; code: CodeAnchor }
  | { kind: "behavior"; label: string; behavior: BehaviorAnchor };
export interface AnchorRegistry { sections: Map<string, Anchor[]>; }
export interface ResolvedLocation { file: string; startLine: number; endLine: number; symbol?: string; }
export interface ResolvedSection { type: "code" | "behavior" | "mixed"; locations: ResolvedLocation[]; }
export interface ParseError { file: string; line: number; }
export interface AnchorResolution { section: string; anchor: Anchor; locations: ResolvedLocation[]; parseErrors?: ParseError[]; }
export interface DriftReport {
  dangling: Array<{ section: string; anchor: string }>;
  loose: Array<{ section: string; anchor: string; count: number }>;
  unresolvedBehavior: Array<{ section: string; id: string }>;
  unparseable: Array<{ section: string; anchor: string; file: string; line: number }>;
}
export interface ResolveResult { responseId: string; sections: Record<string, ResolvedSection>; drift: DriftReport; }
export type ResolveMode = "full" | "changed" | "section";
