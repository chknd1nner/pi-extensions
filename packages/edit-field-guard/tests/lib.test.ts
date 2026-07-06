import { describe, expect, it } from "vitest";
import { classifyKey, formatRepairWarning, sanitizeEditInput } from "../lib.js";

describe("classifyKey", () => {
	it("recognises canonical keys", () => {
		expect(classifyKey("oldText")).toEqual({ kind: "old", index: 1 });
		expect(classifyKey("newText")).toEqual({ kind: "new", index: 1 });
		expect(classifyKey("path")).toEqual({ kind: "path", index: 0 });
	});

	it("parses numeric suffixes", () => {
		expect(classifyKey("newText2")).toEqual({ kind: "new", index: 2 });
		expect(classifyKey("oldText3")).toEqual({ kind: "old", index: 3 });
		expect(classifyKey("newText10")).toEqual({ kind: "new", index: 10 });
	});

	it("handles typos and separators", () => {
		expect(classifyKey("newTex").kind).toBe("new");
		expect(classifyKey("new_text").kind).toBe("new");
		expect(classifyKey("old-text").kind).toBe("old");
		expect(classifyKey("file_path").kind).toBe("path");
	});

	it("maps bare-word aliases", () => {
		expect(classifyKey("search").kind).toBe("old");
		expect(classifyKey("replacement").kind).toBe("new");
		expect(classifyKey("from").kind).toBe("old");
		expect(classifyKey("to").kind).toBe("new");
	});

	it("flags unknown keys", () => {
		expect(classifyKey("comment").kind).toBe("unknown");
		expect(classifyKey("reason").kind).toBe("unknown");
	});
});

describe("sanitizeEditInput — valid input is untouched", () => {
	it("leaves a correct single edit unchanged with no repairs", () => {
		const res = sanitizeEditInput({ path: "a.ts", edits: [{ oldText: "x", newText: "y" }] });
		expect(res.error).toBeUndefined();
		expect(res.repairs).toEqual([]);
		expect(res.input).toEqual({ path: "a.ts", edits: [{ oldText: "x", newText: "y" }] });
	});

	it("leaves multiple correct edits unchanged", () => {
		const res = sanitizeEditInput({
			path: "a.ts",
			edits: [
				{ oldText: "a", newText: "b" },
				{ oldText: "c", newText: "d" },
			],
		});
		expect(res.repairs).toEqual([]);
		expect(res.input?.edits).toHaveLength(2);
	});
});

describe("sanitizeEditInput — the newText2 problem", () => {
	it("strips a stray extra field but keeps the canonical pair", () => {
		const res = sanitizeEditInput({
			path: "a.ts",
			edits: [{ oldText: "x", newText: "y", newText2: "ignored duplicate" } as Record<string, unknown>],
		});
		expect(res.input?.edits).toEqual([{ oldText: "x", newText: "y" }]);
		// newText2 has no matching oldText2, so it reuses the base oldText -> a 2nd edit.
		expect(res.repairs.length).toBeGreaterThan(0);
	});

	it("expands numbered oldText/newText pairs into separate edits", () => {
		const res = sanitizeEditInput({
			path: "a.ts",
			edits: [
				{ oldText: "a", newText: "b", oldText2: "c", newText2: "d", oldText3: "e", newText3: "f" } as Record<
					string,
					unknown
				>,
			],
		});
		expect(res.input?.edits).toEqual([
			{ oldText: "a", newText: "b" },
			{ oldText: "c", newText: "d" },
			{ oldText: "e", newText: "f" },
		]);
		expect(res.repairs.some((r) => r.includes("expanded"))).toBe(true);
	});
});

describe("sanitizeEditInput — typos and aliases", () => {
	it("salvages a typo'd newTex", () => {
		const res = sanitizeEditInput({
			path: "a.ts",
			edits: [{ oldText: "x", newTex: "y" } as Record<string, unknown>],
		});
		expect(res.input?.edits).toEqual([{ oldText: "x", newText: "y" }]);
		expect(res.repairs.some((r) => r.toLowerCase().includes("remapped"))).toBe(true);
	});

	it("drops genuinely unknown fields", () => {
		const res = sanitizeEditInput({
			path: "a.ts",
			edits: [{ oldText: "x", newText: "y", reason: "because", note: "n" } as Record<string, unknown>],
		});
		expect(res.input?.edits).toEqual([{ oldText: "x", newText: "y" }]);
		expect(res.repairs.some((r) => r.includes("non-conforming"))).toBe(true);
	});
});

describe("sanitizeEditInput — structural coercions", () => {
	it("remaps file_path to path", () => {
		const res = sanitizeEditInput({ file_path: "a.ts", edits: [{ oldText: "x", newText: "y" }] });
		expect(res.input?.path).toBe("a.ts");
		expect(res.repairs.some((r) => r.includes("path"))).toBe(true);
	});

	it("parses edits supplied as a JSON string", () => {
		const res = sanitizeEditInput({
			path: "a.ts",
			edits: JSON.stringify([{ oldText: "x", newText: "y" }]),
		});
		expect(res.input?.edits).toEqual([{ oldText: "x", newText: "y" }]);
		expect(res.repairs.some((r) => r.includes("JSON string"))).toBe(true);
	});

	it("lifts top-level oldText/newText into the edits array", () => {
		const res = sanitizeEditInput({ path: "a.ts", oldText: "x", newText: "y" });
		expect(res.input?.edits).toEqual([{ oldText: "x", newText: "y" }]);
		expect(res.repairs.some((r) => r.includes("top-level"))).toBe(true);
	});
});

describe("sanitizeEditInput — unrecoverable input", () => {
	it("errors when path is missing", () => {
		const res = sanitizeEditInput({ edits: [{ oldText: "x", newText: "y" }] });
		expect(res.input).toBeUndefined();
		expect(res.error).toMatch(/path/);
	});

	it("errors when no usable pairs exist", () => {
		const res = sanitizeEditInput({ path: "a.ts", edits: [{ foo: "bar" } as Record<string, unknown>] });
		expect(res.input).toBeUndefined();
		expect(res.error).toMatch(/no usable/);
	});

	it("rejects non-object input", () => {
		expect(sanitizeEditInput("nope").error).toBeDefined();
		expect(sanitizeEditInput(null).error).toBeDefined();
	});
});

describe("formatRepairWarning", () => {
	it("includes the repair list and correct-format guidance", () => {
		const msg = formatRepairWarning(["edits[0]: dropped non-conforming field(s): `newText2`."]);
		expect(msg).toContain("auto-repaired");
		expect(msg).toContain("newText2");
		expect(msg).toContain("oldText` and `newText");
	});
});
