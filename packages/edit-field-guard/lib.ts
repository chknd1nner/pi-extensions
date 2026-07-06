/**
 * Pure, dependency-free sanitiser for `edit` tool arguments.
 *
 * The built-in `edit` tool schema is `{ path, edits: [{ oldText, newText }] }`
 * with `additionalProperties: false` on BOTH the root object and each edit
 * entry. Schema validation runs BEFORE the `tool_call` extension hook, so a
 * stray field (the classic `newText2` / `newText3`, a typo like `newTex`, or a
 * numbered pair `oldText2`/`newText2`) makes the whole call fail validation —
 * which costs a full re-send of every byte of `oldText`/`newText`.
 *
 * This module repairs such inputs into the canonical shape and reports exactly
 * what was changed so the caller can warn the agent.
 *
 * It is deliberately framework-free so it can be unit-tested in isolation.
 */

export interface EditEntry {
	oldText: string;
	newText: string;
}

export interface CanonicalEditInput {
	path: string;
	edits: EditEntry[];
}

export interface SanitizeResult {
	/** Canonical input ready for the real edit tool, or undefined if unrecoverable. */
	input?: CanonicalEditInput;
	/** Human-readable description of every repair performed. Empty = input was already valid. */
	repairs: string[];
	/** Set when the input cannot be coerced into a usable edit call. */
	error?: string;
}

const PATH_KEYS = new Set(["path", "file_path", "filepath", "file", "filename"]);

// Bare-word aliases (no old/new prefix) that nonetheless mean "the text to find".
const OLD_ALIASES = new Set(["search", "find", "from", "before", "target", "match", "original", "source"]);
// Bare-word aliases that mean "the replacement text".
const NEW_ALIASES = new Set(["replacement", "replace", "replacewith", "to", "after", "updated"]);

type FieldKind = "old" | "new" | "path" | "unknown";

interface Classified {
	kind: FieldKind;
	/** 1-based index parsed from a trailing number suffix (`newText2` -> 2). Defaults to 1. */
	index: number;
}

/** Classify a single object key into old/new/path/unknown plus its numeric suffix. */
export function classifyKey(rawKey: string): Classified {
	const lower = rawKey.trim().toLowerCase();
	const numMatch = lower.match(/(\d+)$/);
	const index = numMatch ? Number.parseInt(numMatch[1], 10) : 1;
	// Strip a trailing number and any separators so "old_text", "new-text 2" normalise.
	const base = lower.replace(/\d+$/, "").replace(/[\s_-]/g, "");

	if (PATH_KEYS.has(lower) || PATH_KEYS.has(base)) return { kind: "path", index: 0 };
	if (base.startsWith("old") || OLD_ALIASES.has(base)) return { kind: "old", index };
	if (base.startsWith("new") || NEW_ALIASES.has(base)) return { kind: "new", index };
	return { kind: "unknown", index };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn one (possibly malformed) edit entry into zero or more canonical entries.
 * Pairs old/new values by their numeric suffix so `{oldText, newText, oldText2,
 * newText2}` expands into two edits.
 */
interface KeyedValue {
	key: string;
	value: string;
}

/** True for canonical or numbered-canonical keys like oldText, newText, oldText2. */
function isCanonicalLike(key: string): boolean {
	return /^(old|new)text\d*$/i.test(key.replace(/[\s_-]/g, ""));
}

function buildEditsFromItem(item: unknown, repairs: string[], label: string): EditEntry[] {
	if (typeof item === "string") {
		repairs.push(`${label}: received a bare string instead of an {oldText, newText} object; dropped it.`);
		return [];
	}
	if (!isRecord(item)) {
		repairs.push(`${label}: entry was not an object; dropped it.`);
		return [];
	}

	const olds = new Map<number, KeyedValue>();
	const news = new Map<number, KeyedValue>();
	const unknownKeys: string[] = [];

	for (const [key, value] of Object.entries(item)) {
		const c = classifyKey(key);
		if (c.kind === "old" && typeof value === "string") olds.set(c.index, { key, value });
		else if (c.kind === "new" && typeof value === "string") news.set(c.index, { key, value });
		else unknownKeys.push(key); // path-kind, unknown, or non-string old/new
	}

	const indices = [...new Set([...olds.keys(), ...news.keys()])].sort((a, b) => a - b);
	const out: EditEntry[] = [];
	const usedKeys: string[] = [];
	let unpairedNew: KeyedValue[] = [];
	let unpairedOld: KeyedValue[] = [];

	// Pair strictly by numeric index — an oldText2 belongs with a newText2, never
	// with the base oldText (that would attempt an invalid double-replace).
	for (const i of indices) {
		const o = olds.get(i);
		const n = news.get(i);
		if (o && n) {
			out.push({ oldText: o.value, newText: n.value });
			usedKeys.push(o.key, n.key);
		} else if (n) {
			unpairedNew.push(n);
		} else if (o) {
			unpairedOld.push(o);
		}
	}

	// Suffix mismatch on a single edit, e.g. { oldText, newText2 }: pair the lone
	// old with the lone new even though their indices differ.
	if (out.length === 0 && olds.size === 1 && news.size === 1) {
		const o = [...olds.values()][0];
		const n = [...news.values()][0];
		out.push({ oldText: o.value, newText: n.value });
		usedKeys.push(o.key, n.key);
		unpairedOld = [];
		unpairedNew = [];
	}

	if (unknownKeys.length > 0) {
		repairs.push(`${label}: dropped non-conforming field(s): ${unknownKeys.map((k) => `\`${k}\``).join(", ")}.`);
	}

	// Used keys that aren't plain oldText/newText are typos/aliases worth flagging,
	// except numbered keys that drove a legitimate expansion (reported below).
	const expanded = out.length > 1;
	const typoKeys = usedKeys.filter((k) => k !== "oldText" && k !== "newText" && !(expanded && isCanonicalLike(k)));
	if (typoKeys.length > 0) {
		repairs.push(`${label}: remapped misnamed field(s) ${typoKeys.map((k) => `\`${k}\``).join(", ")} -> oldText/newText.`);
	}

	if (expanded) {
		repairs.push(`${label}: expanded numbered fields into ${out.length} separate edits.`);
	}

	const orphans = [...unpairedNew, ...unpairedOld];
	if (orphans.length > 0) {
		repairs.push(
			`${label}: dropped ${orphans.length} field(s) with no matching counterpart: ${orphans.map((o) => `\`${o.key}\``).join(", ")}.`,
		);
	}

	return out;
}

/**
 * Coerce arbitrary `edit` tool input into the canonical `{ path, edits }` shape.
 * Never throws. Returns `repairs` describing each change; an empty list means
 * the input was already valid and untouched.
 */
export function sanitizeEditInput(rawInput: unknown): SanitizeResult {
	const repairs: string[] = [];

	if (!isRecord(rawInput)) {
		return { repairs, error: "edit input must be an object with `path` and `edits`." };
	}

	// --- resolve path (accept file_path and friends) ---
	let path: string | undefined;
	for (const [key, value] of Object.entries(rawInput)) {
		if (classifyKey(key).kind === "path" && typeof value === "string") {
			path = value;
			if (key !== "path") repairs.push(`Remapped \`${key}\` -> \`path\`.`);
			break;
		}
	}
	if (path === undefined) {
		return { repairs, error: "edit input is missing a string `path`." };
	}

	// --- resolve edits ---
	let editsValue: unknown = rawInput.edits;

	// Some models emit edits as a JSON string. Match built-in behaviour.
	if (typeof editsValue === "string") {
		try {
			const parsed = JSON.parse(editsValue);
			if (Array.isArray(parsed)) {
				editsValue = parsed;
				repairs.push("Parsed `edits` from a JSON string into an array.");
			}
		} catch {
			/* fall through; handled below */
		}
	}

	const edits: EditEntry[] = [];

	if (Array.isArray(editsValue)) {
		editsValue.forEach((item, i) => {
			edits.push(...buildEditsFromItem(item, repairs, `edits[${i}]`));
		});
	} else if (editsValue !== undefined) {
		// edits present but not an array/object we understand -> try to salvage as a single item.
		edits.push(...buildEditsFromItem(editsValue, repairs, "edits"));
	}

	// Legacy / fallback: top-level oldText/newText (and numbered variants) at the root.
	const rootItem: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rawInput)) {
		const kind = classifyKey(key).kind;
		if (kind === "old" || kind === "new") rootItem[key] = value;
	}
	if (Object.keys(rootItem).length > 0) {
		const rootEdits = buildEditsFromItem(rootItem, repairs, "root");
		if (rootEdits.length > 0) {
			repairs.push("Moved top-level oldText/newText into the `edits` array.");
			edits.push(...rootEdits);
		}
	}

	if (edits.length === 0) {
		return {
			repairs,
			error: "edit input produced no usable {oldText, newText} pairs.",
		};
	}

	return { input: { path, edits }, repairs };
}

/**
 * Build the warning message shown to the agent when a repair was performed.
 * Kept here (not in index.ts) so it can be asserted in tests.
 */
export function formatRepairWarning(repairs: string[]): string {
	return [
		"⚠️ edit input was auto-repaired before running.",
		"",
		"The edit tool accepts ONLY two keys: `path` and `edits`. Each entry in",
		"`edits` must contain EXACTLY `oldText` and `newText` — nothing else.",
		"Do NOT emit numbered or duplicate fields (newText2, oldText3, ...),",
		"typo'd keys (newTex), or any other properties. For multiple changes,",
		"push multiple {oldText, newText} objects into the `edits` array.",
		"",
		"Repairs applied this call:",
		...repairs.map((r) => `  - ${r}`),
		"",
		"The edit succeeded. Use the correct format next time to avoid wasted retries.",
	].join("\n");
}
