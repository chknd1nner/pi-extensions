import { spawnSync } from "node:child_process";

export interface HeadingInfo {
  slug: string;
  text: string;
  level: number;
  line: number;
  container: string;        // "section" | "block_quote" | "list_item" | …
  addressable: boolean;     // true only for real document sections (top-level headings)
  collides_with?: number;   // line of the first heading sharing this slug, if any
}
export interface ValidateIssue {
  kind: string;             // e.g. "slug-collision"
  line: number;
  message: string;
  severity: string;         // "error" | "warning" | "info"
  slug?: string;
  text?: string;
  collides_with_line?: number;
  collides_with_text?: string;
}
export interface ValidateResult { file: string; issues: ValidateIssue[]; valid: boolean; }

const MDEDIT = "mdedit";
const NOT_FOUND =
  "mdedit CLI not found on PATH. pi-anchor-resolver delegates heading/anchor identity to mdedit; " +
  "build it from ~/Documents/Projects/mdedit (`cargo install --path .`) and ensure ~/.cargo/bin is on PATH.";

function run(args: string[], okStatuses: number[]): string {
  const r = spawnSync(MDEDIT, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(NOT_FOUND);
    throw r.error;
  }
  if (!okStatuses.includes(r.status ?? -1)) {
    throw new Error(`mdedit ${args.join(" ")} failed (exit ${r.status}): ${r.stderr.trim()}`);
  }
  return r.stdout;
}

// One-time capability probe. mdedit is an unversioned single local build, so we feature-detect
// the `headings … --json` surface rather than gate on --version (see Global Constraints).
let checked = false;
export function ensureMdedit(): void {
  if (checked) return;
  const r = spawnSync(MDEDIT, ["headings", "--help"], { encoding: "utf8" });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(NOT_FOUND);
    throw r.error;
  }
  if ((r.status ?? -1) !== 0 || !/--json/.test(`${r.stdout}${r.stderr}`)) {
    throw new Error(`${NOT_FOUND}\n(mdedit is present but lacks \`headings … --json\`; rebuild it.)`);
  }
  checked = true;
}

export function mdeditHeadings(docPath: string): HeadingInfo[] {
  return JSON.parse(run(["headings", docPath, "--json"], [0])) as HeadingInfo[];
}

// `mdedit validate` exits 0 when clean and 5 when it reports issues (error- OR warning-severity); BOTH
// print the JSON report to stdout, so accept either status.
export function mdeditValidate(docPath: string): ValidateResult {
  return JSON.parse(run(["validate", docPath, "--json"], [0, 5])) as ValidateResult;
}
