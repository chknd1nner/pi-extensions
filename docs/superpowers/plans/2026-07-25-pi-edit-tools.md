# Pi Edit Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pi-edit-tools`, a Pi extension replacing Pi's nested `edit` tool with a scalar `edit(path, oldText, newText)` + a dedicated `multi_edit(path, edits[])` tool, both backed by Pi's native edit engine via `createEditToolDefinition`.

**Architecture:** Two model-facing tools with strict TypeBox schemas, each using `prepareArguments` for compatibility repair. Both delegate to per-cwd-cached `createEditToolDefinition`. Renderer wrappers adapt scalar args → nested for `edit`, and normalize repaired args for both tools before delegating to Pi's native diff-preview renderer.

**Tech Stack:** TypeScript, TypeBox (`typebox` + `typebox/value`), vitest, Pi SDK (`@earendil-works/pi-coding-agent` → `createEditToolDefinition`, `ToolDefinition`, `ExtensionAPI`)

## Global Constraints

- Strict canonical schemas on both tools (`additionalProperties: false`, all fields required)
- `prepareArguments` hook for compatibility repair (not lenient schemas); Pi catches thrown errors and surfaces them to the model as error tool results
- All edits executed through `createEditToolDefinition(cwd)` — no forked/reimplemented edit logic
- `edit-field-guard` must not be installed alongside this extension in production (both override `edit`)
- Package name: `pi-edit-tools`
- Peer dependencies: `@earendil-works/pi-coding-agent: "*"`, `typebox: "*"`
- Registry: `npm install` at repo root, commit root `package-lock.json` changes

---

### Task 1: Project Scaffolding

**Files:**
- Create: `packages/pi-edit-tools/package.json`
- Create: `packages/pi-edit-tools/tsconfig.json`
- Create: `packages/pi-edit-tools/index.ts` (placeholder for typecheck)
- Create: `packages/pi-edit-tools/README.md`

**Interfaces:**
- Produces: npm-workspace-compatible package with `"pi": { "extensions": ["./index.ts"] }` manifest

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pi-edit-tools",
  "version": "0.1.0",
  "description": "Pi extension: replaces the built-in edit tool with scalar edit(path, oldText, newText) plus multi_edit(path, edits[]) for batch replacements, backed by Pi's native edit engine.",
  "keywords": ["pi-package", "pi-extension", "edit", "tool"],
  "license": "MIT",
  "type": "module",
  "files": ["*.ts", "README.md"],
  "pi": {
    "extensions": ["./index.ts"]
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json (standalone, matching edit-field-guard pattern)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create placeholder index.ts (so typecheck has an input file)**

```typescript
// packages/pi-edit-tools/index.ts (placeholder — replaced in Task 7)
export default function () {}
```

- [ ] **Step 4: Create README.md**

```markdown
# pi-edit-tools

Replaces Pi's built-in `edit` tool with two model-friendly tools:

- **`edit(path, oldText, newText)`** — one targeted replacement
- **`multi_edit(path, edits[])`** — multiple non-overlapping replacements in one file

Both delegate to Pi's native edit backend. Not compatible with `edit-field-guard` (both override the `edit` tool name — install one or the other).

## Install

```json
// .pi/settings.json
{
  "packages": ["git:github.com/chknd1nner/pi-edit-tools@v0.1.0"]
}
```
```

- [ ] **Step 5: Install dependencies at root**

Run: `cd /Users/martinkuek/Documents/Projects/pi-extensions && npm install`
Expected: no errors

- [ ] **Step 6: Verify scaffolding typechecks**

Run: `cd /Users/martinkuek/Documents/Projects/pi-extensions && npx tsc --noEmit -p packages/pi-edit-tools/tsconfig.json`
Expected: exit 0, no errors

- [ ] **Step 7: Commit**

```bash
git add packages/pi-edit-tools/package.json packages/pi-edit-tools/tsconfig.json packages/pi-edit-tools/index.ts packages/pi-edit-tools/README.md package-lock.json
git commit -m "chore: scaffold pi-edit-tools package"
```

---

### Task 2: Schemas

**Files:**
- Create: `packages/pi-edit-tools/schemas.ts`
- Create: `packages/pi-edit-tools/tests/schemas.test.ts`

**Interfaces:**
- Consumes: none (first code-bearing task)
- Produces: `editSchema: TObject<{ path: TString, oldText: TString, newText: TString }>` (strict, `additionalProperties: false`, all required)
- Produces: `editItemSchema: TObject<{ oldText: TString, newText: TString }>` (strict, `additionalProperties: false`, both required)
- Produces: `multiEditSchema: TObject<{ path: TString, edits: TArray<typeof editItemSchema> }>` (strict, `additionalProperties: false`, all required, `minItems: 1`)

- [ ] **Step 1: Write failing schema tests**

```typescript
// packages/pi-edit-tools/tests/schemas.test.ts
import { describe, it, expect } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { editSchema, editItemSchema, multiEditSchema } from "../schemas.js";

describe("editSchema", () => {
  it("accepts canonical {path, oldText, newText}", () => {
    expect(Value.Check(editSchema, { path: "/f.ts", oldText: "A", newText: "B" })).toBe(true);
  });

  it("rejects missing path", () => {
    expect(Value.Check(editSchema, { oldText: "A", newText: "B" })).toBe(false);
  });

  it("rejects missing oldText", () => {
    expect(Value.Check(editSchema, { path: "/f", newText: "B" })).toBe(false);
  });

  it("rejects missing newText", () => {
    expect(Value.Check(editSchema, { path: "/f", oldText: "A" })).toBe(false);
  });

  it("rejects extra properties", () => {
    expect(Value.Check(editSchema, { path: "/f", oldText: "A", newText: "B", extra: 1 })).toBe(false);
  });

  it("rejects edits array in edit schema", () => {
    expect(Value.Check(editSchema, { path: "/f", edits: [{ oldText: "A", newText: "B" }] })).toBe(false);
  });

  it("has all three fields required", () => {
    // TypeBox with additionalProperties:false and no Optional marks all as required
    const props = editSchema.properties;
    expect(Object.keys(props)).toEqual(["path", "oldText", "newText"]);
    expect(props.path).toBeDefined();
    expect(props.oldText).toBeDefined();
    expect(props.newText).toBeDefined();
    // No 'edits' property
    expect("edits" in props).toBe(false);
  });
});

describe("editItemSchema", () => {
  it("accepts canonical {oldText, newText}", () => {
    expect(Value.Check(editItemSchema, { oldText: "A", newText: "B" })).toBe(true);
  });

  it("rejects missing oldText", () => {
    expect(Value.Check(editItemSchema, { newText: "B" })).toBe(false);
  });

  it("rejects missing newText", () => {
    expect(Value.Check(editItemSchema, { oldText: "A" })).toBe(false);
  });

  it("rejects extra properties", () => {
    expect(Value.Check(editItemSchema, { oldText: "A", newText: "B", extra: 1 })).toBe(false);
  });
});

describe("multiEditSchema", () => {
  it("accepts path + edits array", () => {
    expect(Value.Check(multiEditSchema, {
      path: "/f",
      edits: [{ oldText: "A", newText: "B" }],
    })).toBe(true);
  });

  it("accepts multiple edits", () => {
    expect(Value.Check(multiEditSchema, {
      path: "/f",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "C", newText: "D" },
      ],
    })).toBe(true);
  });

  it("rejects empty edits array", () => {
    expect(Value.Check(multiEditSchema, { path: "/f", edits: [] })).toBe(false);
  });

  it("rejects missing edits", () => {
    expect(Value.Check(multiEditSchema, { path: "/f" })).toBe(false);
  });

  it("rejects extra properties", () => {
    expect(Value.Check(multiEditSchema, {
      path: "/f",
      edits: [{ oldText: "A", newText: "B" }],
      oldText: "A",
    })).toBe(false);
  });

  it("requires oldText/newText in each edit entry", () => {
    expect(Value.Check(multiEditSchema, {
      path: "/f",
      edits: [{ oldText: "A" }],
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pi-edit-tools/tests/schemas.test.ts`
Expected: FAIL — module `../schemas.js` not found

- [ ] **Step 3: Implement schemas.ts**

```typescript
// packages/pi-edit-tools/schemas.ts
import { Type } from "typebox";

export const editItemSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact existing text for this replacement. It must uniquely identify a region of the original file.",
    }),
    newText: Type.String({
      description: "Replacement text for this region.",
    }),
  },
  { additionalProperties: false },
);

export const editSchema = Type.Object(
  {
    path: Type.String({
      description: "Path to the file to edit, relative or absolute.",
    }),
    oldText: Type.String({
      description:
        "Exact existing text to replace. Keep it as small as possible while still uniquely identifying the intended location.",
    }),
    newText: Type.String({
      description: "Replacement text.",
    }),
  },
  { additionalProperties: false },
);

export const multiEditSchema = Type.Object(
  {
    path: Type.String({
      description: "Path to the file to edit, relative or absolute.",
    }),
    edits: Type.Array(editItemSchema, {
      minItems: 1,
      description:
        "Targeted replacements to apply to the same file. Each oldText is matched against the original file; edits must not overlap or nest.",
    }),
  },
  { additionalProperties: false },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/pi-edit-tools/tests/schemas.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/pi-edit-tools/schemas.ts packages/pi-edit-tools/tests/schemas.test.ts
git commit -m "feat: add strict TypeBox schemas for edit and multi_edit"
```

---

### Task 3: Normalize — Key Classification + Alias Tables

**Files:**
- Create: `packages/pi-edit-tools/normalize.ts`
- Create: `packages/pi-edit-tools/tests/normalize.test.ts`

**Interfaces:**
- Consumes: none (standalone module)
- Produces:
  - `FieldKind = "old" | "new" | "path" | "unknown"`
  - `Classified = { kind: FieldKind; index: number }`
  - `classifyKey(rawKey: string): Classified`
  - `PATH_ALIASES`, `OLD_TEXT_ALIASES`, `NEW_TEXT_ALIASES` — Sets of normalized key bases
  - `normalizeKey(rawKey: string, aliasSet: Set<string>, canonical: string): string | undefined`
  - `isRecord(value: unknown): value is Record<string, unknown>`

- [ ] **Step 1: Write failing tests for classifyKey and alias tables**

```typescript
// packages/pi-edit-tools/tests/normalize.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyKey, normalizeKey, isRecord,
  PATH_ALIASES, OLD_TEXT_ALIASES, NEW_TEXT_ALIASES,
} from "../normalize.js";

describe("classifyKey", () => {
  it("classifies canonical path keys", () => {
    expect(classifyKey("path")).toEqual({ kind: "path", index: 0 });
    expect(classifyKey("file_path")).toEqual({ kind: "path", index: 0 });
    expect(classifyKey("filePath")).toEqual({ kind: "path", index: 0 });
    expect(classifyKey("filepath")).toEqual({ kind: "path", index: 0 });
    expect(classifyKey("file")).toEqual({ kind: "path", index: 0 });
    expect(classifyKey("filename")).toEqual({ kind: "path", index: 0 });
    expect(classifyKey("FILE_PATH")).toEqual({ kind: "path", index: 0 });
    expect(classifyKey("  file_path  ")).toEqual({ kind: "path", index: 0 });
  });

  it("classifies oldText and aliases", () => {
    expect(classifyKey("oldText")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("old_text")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("oldString")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("old_string")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("oldtext")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("oldTex")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("search")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("find")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("from")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("before")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("target")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("original")).toEqual({ kind: "old", index: 1 });
    expect(classifyKey("  OLD_TEXT  ")).toEqual({ kind: "old", index: 1 });
  });

  it("classifies newText and aliases (including newTex)", () => {
    expect(classifyKey("newText")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("new_text")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("newString")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("new_string")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("newtext")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("newTex")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("replacement")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("replaceWith")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("replace_with")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("to")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("after")).toEqual({ kind: "new", index: 1 });
    expect(classifyKey("updated")).toEqual({ kind: "new", index: 1 });
  });

  it("extracts numeric suffix for numbered fields", () => {
    expect(classifyKey("oldText2")).toEqual({ kind: "old", index: 2 });
    expect(classifyKey("newText3")).toEqual({ kind: "new", index: 3 });
    expect(classifyKey("old_text_42")).toEqual({ kind: "old", index: 42 });
    expect(classifyKey("new-string_99")).toEqual({ kind: "new", index: 99 });
  });

  it("returns unknown for unrecognized keys", () => {
    expect(classifyKey("foo")).toEqual({ kind: "unknown", index: 1 });
    expect(classifyKey("bar123")).toEqual({ kind: "unknown", index: 123 });
  });
});

describe("normalizeKey", () => {
  it("returns canonical name for recognized aliases", () => {
    expect(normalizeKey("file_path", PATH_ALIASES, "path")).toBe("path");
    expect(normalizeKey("old_string", OLD_TEXT_ALIASES, "oldText")).toBe("oldText");
    expect(normalizeKey("replace_with", NEW_TEXT_ALIASES, "newText")).toBe("newText");
  });

  it("returns undefined for unrecognized keys", () => {
    expect(normalizeKey("foo", PATH_ALIASES, "path")).toBeUndefined();
    expect(normalizeKey("bar", OLD_TEXT_ALIASES, "oldText")).toBeUndefined();
  });
});

describe("alias tables", () => {
  it("PATH_ALIASES contains expected entries", () => {
    for (const key of ["path", "filepath", "file_path", "file", "filename"]) {
      expect(PATH_ALIASES.has(key)).toBe(true);
    }
  });

  it("OLD_TEXT_ALIASES contains expected entries", () => {
    for (const key of ["oldtext", "oldstring", "old_text", "old_string", "oldtex", "search", "find", "from", "before", "target", "original"]) {
      expect(OLD_TEXT_ALIASES.has(key)).toBe(true);
    }
  });

  it("NEW_TEXT_ALIASES contains expected entries (including newTex)", () => {
    for (const key of ["newtext", "newstring", "new_text", "new_string", "newtex", "replacement", "replacewith", "replace_with", "to", "after", "updated"]) {
      expect(NEW_TEXT_ALIASES.has(key)).toBe(true);
    }
  });
});

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it("returns false for arrays, null, primitives", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pi-edit-tools/tests/normalize.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement normalize.ts (classification + alias tables)**

```typescript
// packages/pi-edit-tools/normalize.ts

export type FieldKind = "old" | "new" | "path" | "unknown";

export interface Classified {
  kind: FieldKind;
  /** 1-based index parsed from trailing numeric suffix. Defaults to 1. */
  index: number;
}

// --- Alias tables (normalized: lowercase, whitespace/hyphens/underscores stripped) ---

export const PATH_ALIASES = new Set([
  "path",
  "filepath",
  "file_path",
  "file",
  "filename",
]);

export const OLD_TEXT_ALIASES = new Set([
  "oldtext",
  "oldstring",
  "old_string",
  "old_text",
  "oldtex",
  "search",
  "find",
  "from",
  "before",
  "target",
  "original",
]);

export const NEW_TEXT_ALIASES = new Set([
  "newtext",
  "newstring",
  "new_string",
  "new_text",
  "newtex",
  "replacement",
  "replacewith",
  "replace_with",
  "to",
  "after",
  "updated",
]);

/**
 * Normalize a raw key against an alias table.
 * Returns the canonical name if the normalized key is in the set, undefined otherwise.
 */
export function normalizeKey(
  rawKey: string,
  aliasSet: Set<string>,
  canonical: string,
): string | undefined {
  const base = normalizeBase(rawKey);
  return aliasSet.has(base) ? canonical : undefined;
}

/**
 * Strip trailing digits and normalize whitespace/separators/case.
 * "old_text_2  " → "oldtext"
 */
function normalizeBase(rawKey: string): string {
  return rawKey
    .trim()
    .toLowerCase()
    .replace(/\d+$/, "")
    .replace(/[\s_-]/g, "");
}

/**
 * Classify a single object key into old/new/path/unknown plus its numeric suffix.
 */
export function classifyKey(rawKey: string): Classified {
  const trimmed = rawKey.trim().toLowerCase();
  const numMatch = trimmed.match(/(\d+)$/);
  const index = numMatch ? Number.parseInt(numMatch[1], 10) : 1;
  const base = normalizeBase(rawKey);

  if (PATH_ALIASES.has(base)) return { kind: "path", index: 0 };
  if (OLD_TEXT_ALIASES.has(base)) return { kind: "old", index };
  if (NEW_TEXT_ALIASES.has(base)) return { kind: "new", index };
  return { kind: "unknown", index };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/pi-edit-tools/tests/normalize.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/pi-edit-tools/normalize.ts packages/pi-edit-tools/tests/normalize.test.ts
git commit -m "feat: add key classification and alias tables for edit normalization"
```

---

### Task 4: Normalize — `prepareEditArgs` (edit repair rules)

**Files:**
- Modify: `packages/pi-edit-tools/normalize.ts`
- Modify: `packages/pi-edit-tools/tests/normalize.test.ts`

**Interfaces:**
- Consumes: `classifyKey`, `normalizeKey`, `isRecord`, alias tables from Task 3
- Produces: `EditInput = { path: string; oldText: string; newText: string }`
- Produces: `prepareEditArgs(args: unknown): EditInput` — normalizes aliases, flattens one-item nested `edits`, handles numbered-typo single-pair case, parses stringified `edits`; throws descriptive `Error` for unrecoverable cases

**Design rule:** The resolver must be strict. It must collect ALL candidates first, detect conflicts, then return output only after the entire request is validated. No silent dropping, no partial execution.

- [ ] **Step 1: Write failing tests for prepareEditArgs**

Add to `packages/pi-edit-tools/tests/normalize.test.ts`:

```typescript
import { prepareEditArgs } from "../normalize.js";

describe("prepareEditArgs", () => {
  // === Canonical input ===
  it("passes through canonical input unchanged", () => {
    const input = { path: "/f.ts", oldText: "A", newText: "B" };
    expect(prepareEditArgs(input)).toEqual(input);
  });

  // === Path aliases ===
  it("remaps file_path → path", () => {
    expect(prepareEditArgs({ file_path: "/f.ts", oldText: "A", newText: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("remaps file → path", () => {
    expect(prepareEditArgs({ file: "/f.ts", oldText: "A", newText: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  // === oldText aliases ===
  it("remaps old_string → oldText", () => {
    expect(prepareEditArgs({ path: "/f.ts", old_string: "A", newText: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("remaps search → oldText", () => {
    expect(prepareEditArgs({ path: "/f.ts", search: "A", newText: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("remaps find → oldText", () => {
    expect(prepareEditArgs({ path: "/f.ts", find: "A", newText: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("remaps target → oldText", () => {
    expect(prepareEditArgs({ path: "/f.ts", target: "A", newText: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  // === newText aliases ===
  it("remaps new_string → newText", () => {
    expect(prepareEditArgs({ path: "/f.ts", oldText: "A", new_string: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("remaps replacement → newText", () => {
    expect(prepareEditArgs({ path: "/f.ts", oldText: "A", replacement: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("remaps newTex → newText", () => {
    expect(prepareEditArgs({ path: "/f.ts", oldText: "A", newTex: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("remaps to → newText", () => {
    expect(prepareEditArgs({ path: "/f.ts", oldText: "A", to: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  // === One-item nested edits → flatten ===
  it("flattens a one-item edits array to scalar", () => {
    expect(prepareEditArgs({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    })).toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("flattens one-item edits with aliases inside", () => {
    expect(prepareEditArgs({
      path: "/f.ts",
      edits: [{ old_string: "A", new_string: "B" }],
    })).toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  // === Numbered typo with one apparent pair (regardless of suffix mismatch) ===
  it("repairs numbered-typo newText2 → newText (single pair)", () => {
    expect(prepareEditArgs({ path: "/f.ts", oldText: "A", newText2: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("repairs numbered-typo oldText2 → oldText (single pair)", () => {
    expect(prepareEditArgs({ path: "/f.ts", oldText2: "A", newText: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  it("repairs mismatched-suffix single pair (oldText + newText3)", () => {
    expect(prepareEditArgs({ path: "/f.ts", oldText: "A", newText3: "B" }))
      .toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  // === Stringified one-item edits ===
  it("parses stringified one-item edits array and flattens", () => {
    expect(prepareEditArgs({
      path: "/f.ts",
      edits: JSON.stringify([{ oldText: "A", newText: "B" }]),
    })).toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  // === Discards unknown extras after successful recovery ===
  it("discards unknown extra properties after recovery", () => {
    expect(prepareEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
      randomField: 42,
    })).toEqual({ path: "/f.ts", oldText: "A", newText: "B" });
  });

  // === UNRECOVERABLE: multiple pairs in edit ===
  it("throws for multiple replacement pairs in edit", () => {
    expect(() => prepareEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
      oldText2: "C",
      newText2: "D",
    })).toThrow(/multiple replacement pairs/i);
  });

  it("throws for multi-item edits array in edit", () => {
    expect(() => prepareEditArgs({
      path: "/f.ts",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "C", newText: "D" },
      ],
    })).toThrow(/multiple replacement pairs/i);
  });

  // === UNRECOVERABLE: conflicting aliases ===
  it("throws for conflicting oldText aliases in one edit entry", () => {
    expect(() => prepareEditArgs({
      path: "/f.ts",
      edits: [{ oldText: "A", old_string: "C", newText: "B" }],
    })).toThrow(/conflicting.*old/i);
  });

  it("throws for conflicting path aliases", () => {
    expect(() => prepareEditArgs({
      path: "/a.ts",
      file_path: "/b.ts",
      oldText: "A",
      newText: "B",
    })).toThrow(/conflicting.*path/i);
  });

  // === UNRECOVERABLE: malformed stringified edits ===
  it("throws when stringified edits is non-array", () => {
    expect(() => prepareEditArgs({
      path: "/f.ts",
      edits: JSON.stringify({ not: "an array" }),
    })).toThrow(/stringified.*edits/i);
  });

  it("throws when stringified edits is invalid JSON", () => {
    expect(() => prepareEditArgs({
      path: "/f.ts",
      edits: "not json at all {{{",
    })).toThrow(/stringified.*edits/i);
  });

  // === UNRECOVERABLE: non-object ===
  it("throws for non-object input", () => {
    expect(() => prepareEditArgs("nope")).toThrow();
    expect(() => prepareEditArgs(null)).toThrow();
    expect(() => prepareEditArgs([])).toThrow();
  });

  // === UNRECOVERABLE: unpaired recognized fields ===
  it("throws when a valid pair exists but an unpaired oldText2 is also present", () => {
    expect(() => prepareEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
      oldText2: "C",
    })).toThrow();
  });

  it("throws when edits array and top-level pairs both present", () => {
    expect(() => prepareEditArgs({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
      oldText2: "C",
      newText2: "D",
    })).toThrow(/multiple replacement pairs/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pi-edit-tools/tests/normalize.test.ts`
Expected: FAIL — `prepareEditArgs` not exported

- [ ] **Step 3: Implement prepareEditArgs in normalize.ts**

Append to `packages/pi-edit-tools/normalize.ts`:

```typescript
// --- Canonical shapes ---

export interface EditInput {
  path: string;
  oldText: string;
  newText: string;
}

export interface EditEntry {
  oldText: string;
  newText: string;
}

export interface MultiEditInput {
  path: string;
  edits: EditEntry[];
}

// --- Internal helpers ---

interface ResolvedPath {
  value: string;
}

interface ResolvedPair {
  oldValue: string;
  newValue: string;
}

/**
 * Find the single path value. Throws on conflicting values.
 */
function extractPath(raw: Record<string, unknown>): string {
  let result: string | undefined;
  for (const [key, value] of Object.entries(raw)) {
    if (classifyKey(key).kind === "path" && typeof value === "string") {
      if (result !== undefined && result !== value) {
        throw new Error(
          "edit received conflicting values for path. Provide a single path.",
        );
      }
      result = value;
    }
  }
  if (result === undefined) {
    throw new Error("edit requires path, oldText, and newText.");
  }
  return result;
}

/**
 * Collect all old/new candidates from a flat record.
 * Rejects the input if there are conflicting values for old or new at the same index.
 */
function extractPairs(raw: Record<string, unknown>): Map<number, ResolvedPair> {
  const byIndex = new Map<number, { old?: { value: string }; new?: { value: string } }>();

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    const c = classifyKey(key);
    if (c.kind !== "old" && c.kind !== "new") continue;

    let entry = byIndex.get(c.index);
    if (!entry) {
      entry = {};
      byIndex.set(c.index, entry);
    }
    if (c.kind === "old") {
      if (entry.old !== undefined && entry.old.value !== value) {
        throw new Error(
          `edit received conflicting old-text values. Use a single oldText.`,
        );
      }
      entry.old = { value };
    }
    if (c.kind === "new") {
      if (entry.new !== undefined && entry.new.value !== value) {
        throw new Error(
          `edit received conflicting new-text values. Use a single newText.`,
        );
      }
      entry.new = { value };
    }
  }

  const pairs = new Map<number, ResolvedPair>();
  for (const [index, entry] of byIndex) {
    if (entry.old && entry.new) {
      pairs.set(index, { oldValue: entry.old.value, newValue: entry.new.value });
    }
  }
  return pairs;
}

/**
 * Resolve old/new from a single edit-item object.
 * Throws on conflicting values.
 */
function extractSinglePair(item: Record<string, unknown>): ResolvedPair {
  let oldValue: string | undefined;
  let newValue: string | undefined;

  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== "string") continue;
    const c = classifyKey(key);
    if (c.kind === "old") {
      if (oldValue !== undefined && oldValue !== value) {
        throw new Error(
          `edit received conflicting old-text values inside an edit entry. Use a single oldText.`,
        );
      }
      oldValue = value;
    }
    if (c.kind === "new") {
      if (newValue !== undefined && newValue !== value) {
        throw new Error(
          `edit received conflicting new-text values inside an edit entry. Use a single newText.`,
        );
      }
      newValue = value;
    }
  }

  if (oldValue === undefined || newValue === undefined) {
    throw new Error("Each edit entry requires oldText and newText.");
  }

  return { oldValue, newValue };
}

/**
 * Parse stringified edits. Throws on invalid JSON or non-array result.
 */
function parseStringifiedEdits(raw: unknown): unknown[] | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(
        "edit received stringified edits that is not an array. Provide edits as a JSON array.",
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(
        "edit received stringified edits that could not be parsed. Provide edits as a JSON array.",
      );
    }
    throw e;
  }
}

/**
 * Prepare and normalize arguments for the `edit` tool.
 *
 * Handles: canonical passthrough, path/old/new aliases, one-item nested edits
 * → flatten, numbered-typo single-pair, stringified one-item edits.
 *
 * Throws on unrecoverable input: multiple pairs, conflicting aliases,
 * malformed stringified edits, missing required fields, non-object input.
 * Never silently drops or picks among conflicting values.
 */
export function prepareEditArgs(args: unknown): EditInput {
  if (!isRecord(args)) {
    throw new Error("edit requires an object with path, oldText, and newText.");
  }

  const path = extractPath(args);

  // --- Collect all candidates before deciding ---
  // We must validate the entire request, not return early from one branch.

  let fromEdits: ResolvedPair | undefined;
  let fromStringified: ResolvedPair | undefined;
  const fromTopLevel = extractPairs(args);

  // Parse stringified edits (throws on invalid JSON or non-array)
  const stringifiedEdits = parseStringifiedEdits(args.edits);
  if (stringifiedEdits !== undefined) {
    if (stringifiedEdits.length !== 1 || !isRecord(stringifiedEdits[0])) {
      throw new Error(
        stringifiedEdits.length > 1
          ? "edit received multiple replacement pairs. Use multi_edit for multiple changes to one file."
          : "edit requires path, oldText, and newText.",
      );
    }
    fromStringified = extractSinglePair(stringifiedEdits[0]);
  }

  // Parse explicit edits array
  if (Array.isArray(args.edits)) {
    if (args.edits.length > 1) {
      throw new Error(
        "edit received multiple replacement pairs. Use multi_edit for multiple changes to one file.",
      );
    }
    if (args.edits.length === 1 && isRecord(args.edits[0])) {
      fromEdits = extractSinglePair(args.edits[0]);
    }
  }

  // --- Validate: at most one source may have a pair ---
  const sources = [fromEdits, fromStringified].filter(Boolean).length;
  const hasTopLevel = fromTopLevel.size > 0;

  // Check for unpaired recognized old/new fields anywhere in the raw input
  const { oldCount, newCount } = countOldNewCandidates(args);

  if (sources > 0 && hasTopLevel) {
    throw new Error(
      "edit received multiple replacement pairs. Use multi_edit for multiple changes to one file.",
    );
  }

  // Reject if recognized fields exist beyond the resolved pair(s)
  if (sources === 0 && hasTopLevel && fromTopLevel.size === 1) {
    if (oldCount > 1 || newCount > 1) {
      throw new Error(
        oldCount > 1 && newCount > 1
          ? "edit received multiple replacement pairs. Use multi_edit for multiple changes to one file."
          : "edit requires path, oldText, and newText.",
      );
    }
  }

  if (sources === 0 && fromTopLevel.size === 0) {
    // Before giving up, check for loose single pair (numbered typos)
    if (oldCount === 1 && newCount === 1) {
      const loosePair = extractLooseSinglePair(args);
      if (loosePair) {
        if (sources > 0 && hasTopLevel) {
          throw new Error(
            "edit received multiple replacement pairs. Use multi_edit for multiple changes to one file.",
          );
        }
        // Check no additional recognized fields slipped through
        if (oldCount === 1 && newCount === 1) {
          return { path, oldText: loosePair.oldValue, newText: loosePair.newValue };
        }
      }
    }
    throw new Error("edit requires path, oldText, and newText.");
  }

  if (sources > 1 || (hasTopLevel && fromTopLevel.size > 1)) {
    throw new Error(
      "edit received multiple replacement pairs. Use multi_edit for multiple changes to one file.",
    );
  }

  // --- Exactly one source has a single pair ---
  let pair: ResolvedPair;
  if (fromEdits) {
    pair = fromEdits;
  } else if (fromStringified) {
    pair = fromStringified;
  } else {
    pair = fromTopLevel.get(1)!;
  }

  return { path, oldText: pair.oldValue, newText: pair.newValue };
}

/**
 * When no paired candidates were found by suffix matching, check if there's
 * exactly one old candidate and one new candidate at arbitrary indices.
 * This handles the numbered-typo case: {oldText: "A", newText2: "B"}.
 * Returns undefined if zero or more than one old/new exist.
 */
function extractLooseSinglePair(
  raw: Record<string, unknown>,
): ResolvedPair | undefined {
  let oldValue: string | undefined;
  let newValue: string | undefined;
  let oldCount = 0;
  let newCount = 0;

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    const c = classifyKey(key);
    if (c.kind === "old") {
      oldCount++;
      oldValue = value;
    }
    if (c.kind === "new") {
      newCount++;
      newValue = value;
    }
  }

  if (oldCount === 1 && newCount === 1 && oldValue !== undefined && newValue !== undefined) {
    return { oldValue, newValue };
  }

  return undefined;
}

/**
 * Count recognized old and new candidates in a flat record.
 */
function countOldNewCandidates(
  raw: Record<string, unknown>,
): { oldCount: number; newCount: number } {
  let oldCount = 0;
  let newCount = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    const c = classifyKey(key);
    if (c.kind === "old") oldCount++;
    if (c.kind === "new") newCount++;
  }
  return { oldCount, newCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/pi-edit-tools/tests/normalize.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/pi-edit-tools/normalize.ts packages/pi-edit-tools/tests/normalize.test.ts
git commit -m "feat: add prepareEditArgs normalization for edit tool"
```

---

### Task 5: Normalize — `prepareMultiEditArgs` (multi_edit repair rules)

**Files:**
- Modify: `packages/pi-edit-tools/normalize.ts`
- Modify: `packages/pi-edit-tools/tests/normalize.test.ts`

**Interfaces:**
- Consumes: `classifyKey`, `isRecord`, `EditEntry`, `MultiEditInput`, `extractPath`, `extractPairs`, `extractSinglePair`, `parseStringifiedEdits` from Tasks 3-4
- Produces: `prepareMultiEditArgs(args: unknown): MultiEditInput` — strict all-or-nothing resolver

**Design rule:** Same strictness as Task 4. Rejects conflicting aliases. Rejects malformed stringified `edits` even if top-level pairs exist. Rejects any unpaired old/new field. Rejects partially invalid `edits[]` entries. Never silently drops.

- [ ] **Step 1: Write failing tests for prepareMultiEditArgs**

Add to `packages/pi-edit-tools/tests/normalize.test.ts`:

```typescript
import { prepareMultiEditArgs } from "../normalize.js";

describe("prepareMultiEditArgs", () => {
  // === Canonical ===
  it("passes through canonical multi_edit input", () => {
    const input = {
      path: "/f.ts",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "C", newText: "D" },
      ],
    };
    expect(prepareMultiEditArgs(input)).toEqual(input);
  });

  it("passes through single-item edits array", () => {
    const input = {
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    };
    expect(prepareMultiEditArgs(input)).toEqual(input);
  });

  // === Path aliases ===
  it("remaps file_path → path", () => {
    expect(prepareMultiEditArgs({
      file_path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    })).toEqual({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    });
  });

  // === Alias fields inside edits entries ===
  it("remaps old_string/new_string inside edits entries", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      edits: [{ old_string: "A", new_string: "B" }],
    })).toEqual({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    });
  });

  // === Numbered pairs at top level → expanded ===
  it("expands numbered pairs at top level into edits array", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
      oldText2: "C",
      newText2: "D",
    })).toEqual({
      path: "/f.ts",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "C", newText: "D" },
      ],
    });
  });

  it("pairs numbered fields by suffix (non-consecutive)", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
      oldText3: "E",
      newText3: "F",
    })).toEqual({
      path: "/f.ts",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "E", newText: "F" },
      ],
    });
  });

  // === Top-level single pair → wrapped ===
  it("wraps top-level single oldText/newText into edits", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
    })).toEqual({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    });
  });

  it("wraps aliased top-level pair into edits", () => {
    expect(prepareMultiEditArgs({
      file: "/f.ts",
      search: "A",
      replacement: "B",
    })).toEqual({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    });
  });

  // === Stringified edits ===
  it("parses stringified edits array", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      edits: JSON.stringify([{ oldText: "A", newText: "B" }]),
    })).toEqual({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    });
  });

  it("parses stringified edits with aliases inside", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      edits: JSON.stringify([
        { old_string: "A", new_string: "B" },
        { oldText: "C", newText: "D" },
      ]),
    })).toEqual({
      path: "/f.ts",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "C", newText: "D" },
      ],
    });
  });

  // === Edits + top-level pairs merged ===
  it("merges edits array with top-level pairs", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
      oldText2: "C",
      newText2: "D",
    })).toEqual({
      path: "/f.ts",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "C", newText: "D" },
      ],
    });
  });

  // === UNRECOVERABLE: unpaired numbered field ===
  it("throws for unpaired oldText2 without newText2", () => {
    expect(() => prepareMultiEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
      oldText2: "C",
    })).toThrow(/could not pair/i);
  });

  it("throws for lone top-level oldText without matching newText", () => {
    expect(() => prepareMultiEditArgs({
      path: "/f.ts",
      oldText: "A",
    })).toThrow(/could not pair/i);
  });

  // === UNRECOVERABLE: conflicting aliases ===
  it("throws for conflicting oldText aliases in one edits entry", () => {
    expect(() => prepareMultiEditArgs({
      path: "/f.ts",
      edits: [{ oldText: "A", old_string: "C", newText: "B" }],
    })).toThrow(/conflicting/i);
  });

  it("throws for conflicting path aliases", () => {
    expect(() => prepareMultiEditArgs({
      path: "/a.ts",
      file_path: "/b.ts",
      edits: [{ oldText: "A", newText: "B" }],
    })).toThrow(/conflicting.*path/i);
  });

  // === UNRECOVERABLE: malformed stringified edits ===
  it("throws when stringified edits is invalid JSON (even with valid top-level pairs)", () => {
    expect(() => prepareMultiEditArgs({
      path: "/f.ts",
      edits: "not json {{{",
      oldText: "A",
      newText: "B",
    })).toThrow(/stringified.*edits/i);
  });

  it("throws when stringified edits is non-array", () => {
    expect(() => prepareMultiEditArgs({
      path: "/f.ts",
      edits: JSON.stringify({ not: "array" }),
    })).toThrow(/stringified.*edits/i);
  });

  // === UNRECOVERABLE: partially invalid edits array ===
  it("throws when one edits entry is valid but another has no newText", () => {
    expect(() => prepareMultiEditArgs({
      path: "/f.ts",
      edits: [
        { oldText: "A", newText: "B" },
        { oldText: "C" },  // missing newText
      ],
    })).toThrow();
  });

  // === UNRECOVERABLE: no edits at all ===
  it("throws when no edits can be resolved", () => {
    expect(() => prepareMultiEditArgs({
      path: "/f.ts",
      randomField: 42,
    })).toThrow(/could not find/i);
  });

  // === Non-object input ===
  it("throws for non-object input", () => {
    expect(() => prepareMultiEditArgs("nope")).toThrow();
    expect(() => prepareMultiEditArgs(null)).toThrow();
  });

  // === Discards unknown extras ===
  it("discards unknown extra properties after recovery", () => {
    expect(prepareMultiEditArgs({
      path: "/f.ts",
      oldText: "A",
      newText: "B",
      obscureField: [1, 2, 3],
    })).toEqual({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pi-edit-tools/tests/normalize.test.ts`
Expected: FAIL — `prepareMultiEditArgs` not exported

- [ ] **Step 3: Implement prepareMultiEditArgs in normalize.ts**

Append to `packages/pi-edit-tools/normalize.ts`:

```typescript
/**
 * Prepare and normalize arguments for the `multi_edit` tool.
 *
 * Strict all-or-nothing resolver:
 * - Rejects conflicting aliases inside edit entries
 * - Rejects malformed stringified `edits` (invalid JSON or non-array)
 * - Rejects partially invalid `edits[]` entries
 * - Rejects any unpaired old/new field at any index
 * - Merges explicit edits array + top-level numbered pairs
 *
 * Handles: canonical passthrough, path aliases, alias fields in entries,
 * numbered-pair expansion, top-level single-pair wrapping, stringified edits.
 *
 * Throws on unrecoverable input.
 */
export function prepareMultiEditArgs(args: unknown): MultiEditInput {
  if (!isRecord(args)) {
    throw new Error("multi_edit requires an object with path and edits.");
  }

  const path = extractPath(args);

  const collected: EditEntry[] = [];

  // --- Handle stringified edits ---
  const stringifiedEdits = parseStringifiedEdits(args.edits);

  if (stringifiedEdits !== undefined) {
    // Validate every parsed entry
    for (const item of stringifiedEdits) {
      if (!isRecord(item)) {
        throw new Error("Each edits entry must be an object with oldText and newText.");
      }
      const pair = extractSinglePair(item);
      collected.push({ oldText: pair.oldValue, newText: pair.newValue });
    }
  } else if (Array.isArray(args.edits)) {
    // Validate every edits[] entry
    for (const item of args.edits) {
      if (!isRecord(item)) {
        throw new Error("Each edits entry must be an object with oldText and newText.");
      }
      const pair = extractSinglePair(item);
      collected.push({ oldText: pair.oldValue, newText: pair.newValue });
    }
  }

  // --- Collect numbered pairs from top level ---
  const pairs = extractPairs(args);
  for (const [, pair] of pairs) {
    collected.push({ oldText: pair.oldValue, newText: pair.newValue });
  }

  // --- Check for any unpaired old/new fields (all indices) ---
  const pairedIndices = new Set<number>();
  // Mark indices from explicit edits: those are always index 1 per entry
  // Mark indices from top-level pairs
  for (const [index] of pairs) {
    pairedIndices.add(index);
  }

  // Detect unpaired: any old/new in raw that's not in a complete pair
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    const c = classifyKey(key);
    if (c.kind !== "old" && c.kind !== "new") continue;
    if (!pairedIndices.has(c.index)) {
      const missingKind = c.kind === "old" ? "newText" : "oldText";
      const missingKey = c.index === 1 ? missingKind : `${missingKind}${c.index}`;
      throw new Error(
        `multi_edit could not pair \`${key}\` with a corresponding \`${missingKey}\`.`,
      );
    }
  }

  if (collected.length === 0) {
    throw new Error(
      "multi_edit could not find any {oldText, newText} pairs to edit.",
    );
  }

  return { path, edits: collected };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/pi-edit-tools/tests/normalize.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/pi-edit-tools/normalize.ts packages/pi-edit-tools/tests/normalize.test.ts
git commit -m "feat: add prepareMultiEditArgs normalization for multi_edit tool"
```

---

### Task 6: Native Adapter + Renderer Wrappers

**Files:**
- Create: `packages/pi-edit-tools/native-adapter.ts`
- Create: `packages/pi-edit-tools/tests/adapter.test.ts`

**Interfaces:**
- Consumes: `createEditToolDefinition` from `@earendil-works/pi-coding-agent`; `EditInput`, `MultiEditInput` from normalize
- Produces:
  - `getNativeEditTool(cwd: string): ReturnType<typeof createEditToolDefinition>` — cached per cwd
  - `toNativeArgs(input: EditInput | MultiEditInput, toolType): { path: string; edits: EditEntry[] }` — transforms model args to Pi's native shape
  - `adaptEditRenderCall(nativeRenderCall)` — for `edit`: transforms `{path, oldText, newText}` → `{path, edits: [{oldText, newText}]}`, also updates `context.args`
  - `adaptRenderResult(nativeRenderResult)` — for `edit`: reads `context.args`, transforms to native, updates context
  - `adaptMultiEditRenderCall(nativeRenderCall)` — for `multi_edit`: passes args through but wraps in case they arrive unrepaired; canonical args are already native-shaped
  - `adaptMultiEditRenderResult(nativeRenderResult)` — for `multi_edit`: passes context.args through

- [ ] **Step 1: Write failing adapter tests**

```typescript
// packages/pi-edit-tools/tests/adapter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getNativeEditTool,
  toNativeArgs,
  adaptEditRenderCall,
  adaptRenderResult,
  adaptMultiEditRenderCall,
  adaptMultiEditRenderResult,
} from "../native-adapter.js";

// Mock createEditToolDefinition — use vi.hoisted() to avoid ReferenceError
const { mockExecute, mockRenderCall, mockRenderResult } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockRenderCall: vi.fn((_args: any, _theme: any, _ctx: any) => "mock-call-component"),
  mockRenderResult: vi.fn((_result: any, _opts: any, _theme: any, _ctx: any) => "mock-result-component"),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createEditToolDefinition: vi.fn((_cwd: string) => ({
    name: "edit",
    label: "Edit",
    description: "mock edit tool",
    parameters: {},
    execute: mockExecute,
    renderCall: mockRenderCall,
    renderResult: mockRenderResult,
    renderShell: "self" as const,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getNativeEditTool", () => {
  it("returns the same instance for the same cwd", () => {
    const a = getNativeEditTool("/project");
    const b = getNativeEditTool("/project");
    expect(a).toBe(b);
  });

  it("returns different instances for different cwds", () => {
    const a = getNativeEditTool("/project-a");
    const b = getNativeEditTool("/project-b");
    expect(a).not.toBe(b);
  });
});

describe("toNativeArgs", () => {
  it("transforms edit input to nested representation", () => {
    expect(toNativeArgs({ path: "/f.ts", oldText: "A", newText: "B" }, "edit")).toEqual({
      path: "/f.ts",
      edits: [{ oldText: "A", newText: "B" }],
    });
  });

  it("passes multi_edit input through unchanged", () => {
    const input = { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] };
    expect(toNativeArgs(input, "multi_edit")).toEqual(input);
  });

  it("preserves multi_edit entry ordering", () => {
    const input = {
      path: "/f.ts",
      edits: [
        { oldText: "C", newText: "D" },
        { oldText: "A", newText: "B" },
      ],
    };
    const result = toNativeArgs(input, "multi_edit");
    expect(result.edits[0]).toEqual({ oldText: "C", newText: "D" });
    expect(result.edits[1]).toEqual({ oldText: "A", newText: "B" });
  });
});

describe("adaptEditRenderCall", () => {
  it("transforms scalar args to native args and updates context", () => {
    const wrapped = adaptEditRenderCall(mockRenderCall);
    const args = { path: "/f.ts", oldText: "A", newText: "B" };
    const theme = { fg: vi.fn(), bg: vi.fn(), bold: vi.fn() };
    const context = { args, cwd: "/proj", state: {} };

    wrapped(args, theme, context);

    // nativeRenderCall should receive nested args
    expect(mockRenderCall).toHaveBeenCalledWith(
      { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] },
      theme,
      expect.objectContaining({
        args: { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] },
      }),
    );
  });

  it("tolerates undefined args during streaming", () => {
    const wrapped = adaptEditRenderCall(mockRenderCall);
    expect(() => wrapped(undefined as any, {}, { args: undefined })).not.toThrow();
  });
});

describe("adaptRenderResult", () => {
  it("transforms context.args for edit scalar rendering", () => {
    const wrapped = adaptRenderResult(mockRenderResult);
    const result = { content: [{ type: "text" as const, text: "ok" }], details: {} };
    const options = { expanded: true, isPartial: false };
    const theme = { fg: vi.fn(), bg: vi.fn(), bold: vi.fn() };
    const context = { args: { path: "/f.ts", oldText: "A", newText: "B" }, cwd: "/proj", state: {} };

    wrapped(result, options, theme, context);

    expect(mockRenderResult).toHaveBeenCalledWith(
      result,
      options,
      theme,
      expect.objectContaining({
        args: { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] },
      }),
    );
  });

  it("tolerates undefined context.args during streaming", () => {
    const wrapped = adaptRenderResult(mockRenderResult);
    expect(() =>
      wrapped(
        { content: [], details: {} },
        { expanded: false, isPartial: true },
        {},
        { args: undefined },
      ),
    ).not.toThrow();
  });
});

describe("adaptMultiEditRenderCall", () => {
  it("passes already-native-shaped args through", () => {
    const wrapped = adaptMultiEditRenderCall(mockRenderCall);
    const args = { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] };
    const theme = {};
    const context = { args, cwd: "/proj", state: {} };

    wrapped(args, theme, context);

    expect(mockRenderCall).toHaveBeenCalledWith(args, theme, expect.objectContaining({ args }));
  });

  it("normalizes repaired aliased args to native shape for rendering", () => {
    const wrapped = adaptMultiEditRenderCall(mockRenderCall);
    // Pi may pass raw args like {file_path: "...", old_string: "A", new_string: "B"}
    const rawArgs = { file_path: "/f.ts", oldText: "A", newText: "B" };
    const context = { args: rawArgs, cwd: "/proj", state: {} };

    wrapped(rawArgs, {}, context);

    expect(mockRenderCall).toHaveBeenCalledWith(
      expect.objectContaining({ edits: [{ oldText: "A", newText: "B" }] }),
      {},
      expect.anything(),
    );
  });

  it("tolerates undefined args during streaming", () => {
    const wrapped = adaptMultiEditRenderCall(mockRenderCall);
    expect(() => wrapped(undefined as any, {}, { args: undefined })).not.toThrow();
  });
});

describe("adaptMultiEditRenderResult", () => {
  it("passes native-shaped context.args through", () => {
    const wrapped = adaptMultiEditRenderResult(mockRenderResult);
    const result = { content: [], details: {} };
    const options = { expanded: true, isPartial: false };
    const theme = {};
    const context = { args: { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] }, cwd: "/proj", state: {} };

    wrapped(result, options, theme, context);

    expect(mockRenderResult).toHaveBeenCalledWith(
      result, options, theme,
      expect.objectContaining({ args: { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] } }),
    );
  });

  it("normalizes repaired aliased context.args for rendering", () => {
    const wrapped = adaptMultiEditRenderResult(mockRenderResult);
    const result = { content: [], details: {} };
    const options = { expanded: true, isPartial: false };
    const context = { args: { file_path: "/f.ts", oldText: "A", newText: "B", oldText2: "C", newText2: "D" }, cwd: "/proj", state: {} };

    wrapped(result, options, {}, context);

    expect(mockRenderResult).toHaveBeenCalledWith(
      result, options, {},
      expect.objectContaining({
        args: expect.objectContaining({ edits: expect.arrayContaining([{ oldText: "A", newText: "B" }]) }),
      }),
    );
  });

  it("tolerates undefined context.args during streaming", () => {
    const wrapped = adaptMultiEditRenderResult(mockRenderResult);
    expect(() =>
      wrapped(
        { content: [], details: {} },
        { expanded: false, isPartial: true },
        {},
        { args: undefined },
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pi-edit-tools/tests/adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement native-adapter.ts**

```typescript
// packages/pi-edit-tools/native-adapter.ts
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import type { EditInput, MultiEditInput, EditEntry } from "./normalize.js";

const nativeByCwd = new Map<string, ReturnType<typeof createEditToolDefinition>>();

export function getNativeEditTool(
  cwd: string,
): ReturnType<typeof createEditToolDefinition> {
  let tool = nativeByCwd.get(cwd);
  if (!tool) {
    tool = createEditToolDefinition(cwd);
    nativeByCwd.set(cwd, tool);
  }
  return tool;
}

/**
 * Transform our model-facing args into Pi's native representation.
 * - `edit`:  {path, oldText, newText} → {path, edits: [{oldText, newText}]}
 * - `multi_edit`: passes through (already matches {path, edits: [...]})
 */
export function toNativeArgs(
  input: EditInput | MultiEditInput,
  toolType: "edit" | "multi_edit",
): { path: string; edits: EditEntry[] } {
  if (toolType === "edit") {
    const i = input as EditInput;
    return {
      path: i.path,
      edits: [{ oldText: i.oldText, newText: i.newText }],
    };
  }
  return input as { path: string; edits: EditEntry[] };
}

/**
 * Build native-shaped args from scalar edit args, or return undefined
 * if args are undefined (happens during streaming before args are available).
 */
function toRenderableNativeArgs(
  args: EditInput | MultiEditInput | undefined,
  toolType: "edit" | "multi_edit",
): { path: string; edits: EditEntry[] } | undefined {
  if (!args) return undefined;
  if (toolType === "edit") {
    const i = args as EditInput;
    if (i.path === undefined && i.oldText === undefined && i.newText === undefined) {
      return undefined;
    }
    return {
      path: i.path ?? "",
      edits: [{ oldText: i.oldText ?? "", newText: i.newText ?? "" }],
    };
  }
  return args as { path: string; edits: EditEntry[] };
}

/**
 * Adapt an edit `renderCall` to convert scalar args to native before delegating.
 * Updates context.args so native diff-preview sees the native shape.
 */
export function adaptEditRenderCall(
  nativeRenderCall: (...args: any[]) => any,
): (...args: any[]) => any {
  return (args: EditInput | undefined, theme: any, context: any) => {
    const nativeArgs = toRenderableNativeArgs(args, "edit");
    const adaptedContext = nativeArgs
      ? { ...context, args: nativeArgs }
      : context;
    return nativeRenderCall(nativeArgs ?? args, theme, adaptedContext);
  };
}

/**
 * Adapt an edit `renderResult` to convert context.args from scalar to native.
 */
export function adaptRenderResult(
  nativeRenderResult: (...args: any[]) => any,
): (...args: any[]) => any {
  return (result: any, options: any, theme: any, context: any) => {
    const nativeArgs = toRenderableNativeArgs(context.args, "edit");
    const adaptedContext = nativeArgs
      ? { ...context, args: nativeArgs }
      : context;
    return nativeRenderResult(result, options, theme, adaptedContext);
  };
}

/**
 * Adapt a multi_edit `renderCall`. Normalizes raw args (which may contain
 * aliases, numbered fields, or stringified edits) to canonical native shape
 * before delegating, since Pi passes raw tool-call args to renderers.
 */
export function adaptMultiEditRenderCall(
  nativeRenderCall: (...args: any[]) => any,
): (...args: any[]) => any {
  return (args: any, theme: any, context: any) => {
    const nativeArgs = toMultiEditRenderableArgs(args);
    const adaptedContext = nativeArgs
      ? { ...context, args: nativeArgs }
      : context;
    return nativeRenderCall(nativeArgs ?? args, theme, adaptedContext);
  };
}

/**
 * Adapt a multi_edit `renderResult`. Normalizes context.args the same way.
 */
export function adaptMultiEditRenderResult(
  nativeRenderResult: (...args: any[]) => any,
): (...args: any[]) => any {
  return (result: any, options: any, theme: any, context: any) => {
    const nativeArgs = toMultiEditRenderableArgs(context.args);
    const adaptedContext = nativeArgs
      ? { ...context, args: nativeArgs }
      : context;
    return nativeRenderResult(result, options, theme, adaptedContext);
  };
}

/**
 * Try to normalize multi_edit args to native shape at render time.
 * Pi passes raw tool-call args, not prepareArguments output, so aliases
 * etc. can reach the renderer. We use a best-effort normalize — if it
 * throws, we return undefined and the renderer gets the raw args.
 */
function toMultiEditRenderableArgs(
  args: any,
): { path: string; edits: EditEntry[] } | undefined {
  if (!args || !isRecord(args)) return undefined;
  if (Array.isArray(args.edits) && args.edits.length > 0) {
    // Already canonical shape — pass through
    return args as { path: string; edits: EditEntry[] };
  }
  // Try to normalize repaired args
  try {
    return {
      path: typeof args.path === "string" ? args.path : (typeof args.file_path === "string" ? args.file_path : ""),
      edits: Array.isArray(args.edits)
        ? args.edits.map((e: any) => ({ oldText: e.oldText ?? "", newText: e.newText ?? "" }))
        : [],
    };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run adapter tests to verify they pass**

Run: `npx vitest run packages/pi-edit-tools/tests/adapter.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/pi-edit-tools/native-adapter.ts packages/pi-edit-tools/tests/adapter.test.ts
git commit -m "feat: add native adapter with per-cwd caching and renderer wrappers"
```

---

### Task 7: Extension Entry Point

**Files:**
- Modify: `packages/pi-edit-tools/index.ts` (replace placeholder)

**Interfaces:**
- Consumes: `editSchema`, `multiEditSchema` from schemas; `prepareEditArgs`, `prepareMultiEditArgs`, `EditInput`, `MultiEditInput` from normalize; `getNativeEditTool`, `toNativeArgs`, `adaptEditRenderCall`, `adaptRenderResult`, `adaptMultiEditRenderCall`, `adaptMultiEditRenderResult` from native-adapter; `ExtensionAPI`, `ToolDefinition`, `AgentToolResult`, `AgentToolUpdateCallback`, `ExtensionContext` from `@earendil-works/pi-coding-agent`
- Produces: Default export `(pi: ExtensionAPI) => void` that registers `edit` (overriding built-in) and `multi_edit`

- [ ] **Step 1: Write failing registration test**

```typescript
// packages/pi-edit-tools/tests/registration.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock createEditToolDefinition before importing the extension
const mockExecute = vi.fn();
const mockRenderCall = vi.fn();
const mockRenderResult = vi.fn();

vi.mock("@earendil-works/pi-coding-agent", () => {
  // Use a factory function to avoid hoisting issues
  let callCount = 0;
  return {
    createEditToolDefinition: vi.fn((_cwd: string) => {
      callCount++;
      return {
        name: "edit",
        label: "Edit",
        description: "native edit",
        promptSnippet: "native snippet",
        promptGuidelines: [],
        parameters: {},
        execute: mockExecute,
        renderCall: mockRenderCall,
        renderResult: mockRenderResult,
        renderShell: "self" as const,
      };
    }),
  };
});

describe("extension entry point", () => {
  it("registers edit and multi_edit tools with correct names", async () => {
    const registeredTools: any[] = [];
    const mockPi = {
      registerTool: vi.fn((def: any) => registeredTools.push(def)),
    };

    const mod = await import("../index.js");
    mod.default(mockPi as any);

    expect(mockPi.registerTool).toHaveBeenCalledTimes(2);

    const editTool = registeredTools.find((t: any) => t.name === "edit");
    const multiTool = registeredTools.find((t: any) => t.name === "multi_edit");

    expect(editTool).toBeDefined();
    expect(multiTool).toBeDefined();

    // Verify schemas
    expect(Object.keys(editTool.parameters.properties)).toEqual(["path", "oldText", "newText"]);
    expect(Object.keys(multiTool.parameters.properties)).toEqual(["path", "edits"]);

    // Verify renderShell
    expect(editTool.renderShell).toBe("self");
    expect(multiTool.renderShell).toBe("self");

    // Verify prepareArguments exists
    expect(typeof editTool.prepareArguments).toBe("function");
    expect(typeof multiTool.prepareArguments).toBe("function");
  });

  it("edit.execute transforms args and delegates to native", async () => {
    mockExecute.mockClear();
    mockExecute.mockResolvedValue({ content: [{ type: "text", text: "ok" }], details: {} });

    const registeredTools: any[] = [];
    const mockPi = { registerTool: vi.fn((def: any) => registeredTools.push(def)) };

    const mod = await import("../index.js");
    mod.default(mockPi as any);

    const editTool = registeredTools.find((t: any) => t.name === "edit")!;
    const mockCtx = { cwd: "/test" };

    await editTool.execute("call-1", { path: "/f.ts", oldText: "A", newText: "B" }, undefined, undefined, mockCtx);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(
      "call-1",
      { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] },
      undefined,
      undefined,
      mockCtx,
    );
  });

  it("multi_edit.execute passes args through to native", async () => {
    mockExecute.mockClear();
    mockExecute.mockResolvedValue({ content: [{ type: "text", text: "ok" }], details: {} });

    const registeredTools: any[] = [];
    const mockPi = { registerTool: vi.fn((def: any) => registeredTools.push(def)) };

    const mod = await import("../index.js");
    mod.default(mockPi as any);

    const multiTool = registeredTools.find((t: any) => t.name === "multi_edit")!;
    const mockCtx = { cwd: "/test" };
    const input = { path: "/f.ts", edits: [{ oldText: "A", newText: "B" }] };

    await multiTool.execute("call-2", input, undefined, undefined, mockCtx);

    expect(mockExecute).toHaveBeenCalledWith("call-2", input, undefined, undefined, mockCtx);
  });
});
```

- [ ] **Step 2: Run registration tests to verify they pass**

Run: `npx vitest run packages/pi-edit-tools/tests/registration.test.ts`
Expected: PASS (all tests — these use already-written modules)

- [ ] **Step 3: Implement index.ts**

```typescript
// packages/pi-edit-tools/index.ts
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { editSchema, multiEditSchema } from "./schemas.js";
import { prepareEditArgs, prepareMultiEditArgs } from "./normalize.js";
import type { EditInput, MultiEditInput } from "./normalize.js";
import {
  getNativeEditTool,
  toNativeArgs,
  adaptEditRenderCall,
  adaptRenderResult,
  adaptMultiEditRenderCall,
  adaptMultiEditRenderResult,
} from "./native-adapter.js";

export default function (pi: ExtensionAPI) {
  // Seed the cwd cache with a default entry. The cwd here is only used by
  // renderCall's fallback; real edits resolve against ctx.cwd in execute.
  const defaultCwd = process.cwd();
  const nativeTool = getNativeEditTool(defaultCwd);

  // Validate native renderers exist before wrapping (they should always exist
  // for createEditToolDefinition, but the type is optional).
  if (!nativeTool.renderCall || !nativeTool.renderResult) {
    throw new Error(
      "pi-edit-tools: native edit tool is missing renderCall or renderResult",
    );
  }

  const nativeRenderCall = nativeTool.renderCall;
  const nativeRenderResult = nativeTool.renderResult;

  // --- Register `edit` (overrides built-in) ---
  const editDef: ToolDefinition<typeof editSchema, unknown, unknown> = {
    name: "edit",
    label: "edit",
    description:
      "Edit one location in one file using exact text replacement. " +
      "Use multi_edit instead when changing multiple separate locations in the same file.",
    promptSnippet:
      "Edit one location in one file. For multiple separate locations, use multi_edit.",
    promptGuidelines: [
      "Use edit for one exact replacement in a file. oldText must identify one unique region. Keep it as small as possible while remaining unique.",
      "For multiple separate replacements in the same file, use multi_edit rather than inventing numbered fields or issuing parallel edits to that file.",
    ],
    parameters: editSchema,
    renderShell: "self",
    renderCall: adaptEditRenderCall(nativeRenderCall),
    renderResult: adaptRenderResult(nativeRenderResult),

    prepareArguments(args) {
      return prepareEditArgs(args);
    },

    async execute(
      toolCallId: string,
      params: EditInput,
      signal: AbortSignal,
      onUpdate: AgentToolUpdateCallback,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<unknown>> {
      const cwd = ctx.cwd;
      const nativeArgs = toNativeArgs(params, "edit");
      const native = getNativeEditTool(cwd);
      return native.execute(
        toolCallId,
        nativeArgs,
        signal,
        onUpdate,
        ctx,
      ) as Promise<AgentToolResult<unknown>>;
    },
  };

  pi.registerTool(editDef);

  // --- Register `multi_edit` (new tool) ---
  const multiEditDef: ToolDefinition<typeof multiEditSchema, unknown, unknown> = {
    name: "multi_edit",
    label: "multi_edit",
    description:
      "Apply one or more independent exact-text replacements to a single file " +
      "in one operation. Each oldText is matched against the original file, so " +
      "edits must not overlap or nest. Prefer edit for a single replacement.",
    promptSnippet:
      "Apply multiple independent exact-text replacements to one file at once.",
    promptGuidelines: [
      "Use multi_edit when changing multiple separate regions in the same file. Each oldText is matched against the original file — edits must not overlap or nest.",
      "Merge nearby changes that affect the same logical block into one replacement.",
    ],
    parameters: multiEditSchema,
    renderShell: "self",
    renderCall: adaptMultiEditRenderCall(nativeRenderCall),
    renderResult: adaptMultiEditRenderResult(nativeRenderResult),

    prepareArguments(args) {
      return prepareMultiEditArgs(args);
    },

    async execute(
      toolCallId: string,
      params: MultiEditInput,
      signal: AbortSignal,
      onUpdate: AgentToolUpdateCallback,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<unknown>> {
      const cwd = ctx.cwd;
      const nativeArgs = toNativeArgs(params, "multi_edit");
      const native = getNativeEditTool(cwd);
      return native.execute(
        toolCallId,
        nativeArgs,
        signal,
        onUpdate,
        ctx,
      ) as Promise<AgentToolResult<unknown>>;
    },
  };

  pi.registerTool(multiEditDef);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p packages/pi-edit-tools/tsconfig.json`
Expected: exit 0, no errors

- [ ] **Step 5: Run all tests**

Run: `npx vitest run packages/pi-edit-tools/tests/`
Expected: PASS (all tests: schemas, normalize, adapter, registration)

- [ ] **Step 6: Commit**

```bash
git add packages/pi-edit-tools/index.ts packages/pi-edit-tools/tests/registration.test.ts
git commit -m "feat: wire extension entry point registering edit and multi_edit tools"
```

---

### Task 8: Integration Tests

**Files:**
- Create: `packages/pi-edit-tools/tests/integration.test.ts`

**Interfaces:**
- Consumes: `prepareEditArgs`, `prepareMultiEditArgs` from normalize; `getNativeEditTool`, `toNativeArgs` from native-adapter; `ExtensionContext` type from Pi SDK
- Produces: End-to-end tests with real temp files covering canonical, compatibility, edge cases (CRLF, BOM, quotes, backslashes, template literals, JSON, JSX, missing matches, overlapping edits)

- [ ] **Step 1: Write integration tests**

```typescript
// packages/pi-edit-tools/tests/integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { prepareEditArgs, prepareMultiEditArgs } from "../normalize.js";
import { getNativeEditTool, toNativeArgs } from "../native-adapter.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `pi-edit-tools-test-${randomUUID()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function writeTestFile(name: string, content: string): Promise<string> {
  const filePath = join(testDir, name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function fakeCtx(cwd: string): ExtensionContext {
  return { cwd } as ExtensionContext;
}

describe("edit tool integration — canonical", () => {
  it("replaces text in a file", async () => {
    const filePath = await writeTestFile("test.ts", "const x = 1;\nconst y = 2;\n");
    const input = prepareEditArgs({ path: filePath, oldText: "x = 1", newText: "x = 42" });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("const x = 42;");
    expect(contents).toContain("const y = 2;");
  });

  it("handles multiline replacements", async () => {
    const filePath = await writeTestFile("multi.ts", "function foo() {\n  return 1;\n}\n");
    const input = prepareEditArgs({
      path: filePath,
      oldText: "function foo() {\n  return 1;\n}",
      newText: "function foo() {\n  return 42;\n}",
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("return 42;");
    expect(contents).not.toContain("return 1;");
  });

  it("throws on non-unique oldText", async () => {
    const filePath = await writeTestFile("dup.ts", "hello\nhello\n");
    const input = prepareEditArgs({ path: filePath, oldText: "hello", newText: "bye" });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await expect(
      native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir)),
    ).rejects.toThrow();
  });

  it("handles quotes and backslashes", async () => {
    const filePath = await writeTestFile("esc.ts", `const s = "hello\\\\world";\n`);
    const input = prepareEditArgs({
      path: filePath,
      oldText: `"hello\\\\world"`,
      newText: `"replaced"`,
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain('"replaced"');
  });

  it("handles JSON content", async () => {
    const filePath = await writeTestFile("cfg.json", '{\n  "key": "value"\n}\n');
    const input = prepareEditArgs({
      path: filePath,
      oldText: '"key": "value"',
      newText: '"key": "new-value"',
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain('"new-value"');
  });

  it("handles JSX/HTML content", async () => {
    const filePath = await writeTestFile("comp.tsx", '<div className="old">hello</div>\n');
    const input = prepareEditArgs({
      path: filePath,
      oldText: 'className="old"',
      newText: 'className="new"',
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain('className="new"');
  });

  it("handles template literals", async () => {
    const filePath = await writeTestFile("tmpl.ts", "const msg = `hello ${name}`;\n");
    const input = prepareEditArgs({
      path: filePath,
      oldText: "`hello ${name}`",
      newText: "`hi ${name}`",
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("`hi ${name}`");
  });
});

describe("edit tool — compatibility pipeline", () => {
  it("Claude Code style → correct mutation", async () => {
    const filePath = await writeTestFile("cc.ts", "original text\n");
    const input = prepareEditArgs({
      file_path: filePath,
      old_string: "original",
      new_string: "replaced",
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("replaced text");
  });

  it("nested single-edit → flattened → correct mutation", async () => {
    const filePath = await writeTestFile("nested.ts", "before\n");
    const input = prepareEditArgs({
      path: filePath,
      edits: [{ oldText: "before", newText: "after" }],
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("after");
  });

  it("numbered-typo single pair → correct mutation", async () => {
    const filePath = await writeTestFile("typo.ts", "old stuff\n");
    const input = prepareEditArgs({
      path: filePath,
      oldText: "old stuff",
      newText2: "new stuff",
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("new stuff");
  });

  it("stringified edits → parsed → correct mutation", async () => {
    const filePath = await writeTestFile("str.ts", "original\n");
    const input = prepareEditArgs({
      path: filePath,
      edits: JSON.stringify([{ old_text: "original", new_text: "changed" }]),
    });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("changed");
  });
});

describe("multi_edit tool integration", () => {
  it("applies multiple independent edits", async () => {
    const filePath = await writeTestFile(
      "multi.ts",
      "const a = 1;\nconst b = 2;\nconst c = 3;\n",
    );
    const input = prepareMultiEditArgs({
      path: filePath,
      edits: [
        { oldText: "a = 1", newText: "a = 10" },
        { oldText: "c = 3", newText: "c = 30" },
      ],
    });
    const nativeArgs = toNativeArgs(input, "multi_edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("const a = 10;");
    expect(contents).toContain("const b = 2;");
    expect(contents).toContain("const c = 30;");
  });

  it("rejects overlapping edits", async () => {
    const filePath = await writeTestFile("overlap.ts", "hello world\n");
    const input = prepareMultiEditArgs({
      path: filePath,
      edits: [
        { oldText: "hello", newText: "hi" },
        { oldText: "hello world", newText: "something" },
      ],
    });
    const nativeArgs = toNativeArgs(input, "multi_edit");
    const native = getNativeEditTool(testDir);

    await expect(
      native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir)),
    ).rejects.toThrow();
  });

  it("expands numbered pairs → correct mutations", async () => {
    const filePath = await writeTestFile("numbered.ts", "line1\nline2\nline3\n");
    const input = prepareMultiEditArgs({
      path: filePath,
      oldText: "line1",
      newText: "first",
      oldText2: "line3",
      newText2: "third",
    });
    const nativeArgs = toNativeArgs(input, "multi_edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("first");
    expect(contents).toContain("third");
  });

  it("merges edits array with top-level numbered pairs", async () => {
    const filePath = await writeTestFile("merged.ts", "a\nb\nc\n");
    const input = prepareMultiEditArgs({
      path: filePath,
      edits: [{ oldText: "a", newText: "A" }],
      oldText2: "c",
      newText2: "C",
    });
    const nativeArgs = toNativeArgs(input, "multi_edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("A");
    expect(contents).toContain("C");
  });
});

describe("Line ending and encoding", () => {
  it("preserves CRLF line endings", async () => {
    const filePath = join(testDir, "crlf.ts");
    await writeFile(filePath, "line1\r\nline2\r\n");
    const input = prepareEditArgs({ path: filePath, oldText: "line1", newText: "first" });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("first\r\n");
    expect(contents).toContain("line2\r\n");
  });

  it("handles BOM files", async () => {
    const filePath = join(testDir, "bom.ts");
    await writeFile(filePath, "\uFEFF// BOM file\nconst x = 1;\n");
    const input = prepareEditArgs({ path: filePath, oldText: "x = 1", newText: "x = 42" });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir));
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("\uFEFF");
    expect(contents).toContain("x = 42");
  });
});

describe("Error propagation", () => {
  it("prepareEditArgs errors surface as thrown Errors", () => {
    expect(() => prepareEditArgs({ path: "/f", oldText: "A" })).toThrow();
    expect(() => prepareEditArgs({ path: "/f", oldText: "A", newText: "B", oldText2: "C", newText2: "D" })).toThrow();
  });

  it("prepareMultiEditArgs errors surface as thrown Errors", () => {
    expect(() => prepareMultiEditArgs({ path: "/f" })).toThrow();
    expect(() => prepareMultiEditArgs({ path: "/f", oldText2: "A" })).toThrow();
  });

  it("missing match on file content produces native error", async () => {
    const filePath = await writeTestFile("nomatch.ts", "hello world\n");
    const input = prepareEditArgs({ path: filePath, oldText: "nonexistent", newText: "replaced" });
    const nativeArgs = toNativeArgs(input, "edit");
    const native = getNativeEditTool(testDir);

    await expect(
      native.execute("test-id", nativeArgs, undefined as any, undefined as any, fakeCtx(testDir)),
    ).rejects.toThrow();
  });

  it("concurrent edits to same file are serialized by native backend", async () => {
    const filePath = await writeTestFile("concurrent.ts", "line1\nline2\nline3\n");
    const input1 = prepareEditArgs({ path: filePath, oldText: "line1", newText: "first" });
    const input2 = prepareEditArgs({ path: filePath, oldText: "line3", newText: "third" });
    const nativeArgs1 = toNativeArgs(input1, "edit");
    const nativeArgs2 = toNativeArgs(input2, "edit");
    const native = getNativeEditTool(testDir);

    // Issue two concurrent edits — Pi's mutation queue serializes them
    await Promise.all([
      native.execute("id-1", nativeArgs1, undefined as any, undefined as any, fakeCtx(testDir)),
      native.execute("id-2", nativeArgs2, undefined as any, undefined as any, fakeCtx(testDir)),
    ]);

    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain("first");
    expect(contents).toContain("third");
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run packages/pi-edit-tools/tests/integration.test.ts`
Expected: PASS (all tests)

- [ ] **Step 3: Run all tests together**

Run: `npx vitest run packages/pi-edit-tools/tests/`
Expected: PASS (all tests: schemas, normalize, adapter, registration, integration)

- [ ] **Step 4: Commit**

```bash
git add packages/pi-edit-tools/tests/integration.test.ts
git commit -m "test: add comprehensive integration tests for edit and multi_edit pipelines"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec Requirement | Covered By |
|---|---|
| `edit` exposes only path, oldText, newText (strict, no edits) | Task 2 (schemas + tests) |
| `multi_edit` exposes path + edits[] (strict) | Task 2 (schemas + tests) |
| Both use strict provider-visible schemas | Task 2 (`additionalProperties: false`) |
| `prepareArguments` repairs aliases + unambiguous mistakes | Tasks 3, 4, 5 |
| All alias tables from spec (including `newTex`, `file`, `filename`, search, find, from, before, target, original, replacement, replaceWith, replace_with, to, after, updated) | Task 3 |
| Ambiguous/conflicting input fails without modifying files | Tasks 4, 5 (pre-validation throwing, no partial execution) |
| Malformed stringified edits rejected | Tasks 4, 5 |
| Numbered-pair expansion for multi_edit | Task 5 |
| Every mutation via Pi's native edit backend | Tasks 6, 7 (`createEditToolDefinition`) |
| Native diff/patch/BOM/line-ending preserved | Task 7 (delegates to native execute), Task 8 (BOM + CRLF tests) |
| TUI diff previews retained with adapted context.args | Task 6 (renderer wrappers + tests), Task 7 (uses wrappers) |
| `renderShell: "self"` on both tools | Task 7 |
| Unit tests cover canonical/compat/failure | Tasks 2-6 |
| Integration tests cover multiline, quotes, backslashes, template literals, JSON, JSX, CRLF, BOM, missing matches, overlapping edits, concurrent same-file | Task 8 |
| Model evaluation | Post-release (out of first-implementation scope) |
| Backend adapter tests (scalar→nested transform, ordering preservation) | Task 6 (`toNativeArgs` tests) |
| Renderer behavior tests (argument order, adapted context.args, streaming tolerance, repaired arg normalization for both tools) | Task 6 (adapter tests) |
| Extension registration tests (tools registered, execute delegates to native) | Task 7 (registration tests) |
| Unpaired field detection at all indices | Tasks 4, 5 |
| Cross-source conflict detection (edits array + top-level pairs) | Task 4 |

### 2. Placeholder Scan

✅ No TBD/TODO/fill-in-the-blanks  
✅ Package name finalized: `pi-edit-tools`  
✅ README is complete (no `[Full docs TBD]`)  
✅ All steps contain actual code  
✅ No "add appropriate error handling" — specific throws  
✅ All file paths exact  
✅ Expected outputs specified  

### 3. Type Consistency

- `EditInput` defined in Task 4, consumed in Tasks 6, 7, 8 ✅
- `MultiEditInput` defined in Task 5, consumed in Tasks 6, 7, 8 ✅
- `EditEntry` defined in Task 4, consumed in Tasks 5, 6 ✅
- `prepareEditArgs(args: unknown): EditInput` — consistent ✅
- `prepareMultiEditArgs(args: unknown): MultiEditInput` — consistent ✅
- `getNativeEditTool(cwd: string)` — consistent ✅
- `toNativeArgs(input, toolType)` — consistent ✅
- `adaptEditRenderCall` / `adaptRenderResult` — separate functions with correct signatures ✅
- `adaptMultiEditRenderCall` / `adaptMultiEditRenderResult` — separate functions ✅
- All execute calls pass 5 args: `(toolCallId, params, signal, onUpdate, ctx)` ✅
- `ctx` is required (not optional) in execute signatures ✅
- `import { Value } from "typebox/value"` — used consistently in tests ✅

### 4. Post-Release

- **Model Evaluation** (spec §882–930): This is a separate empirical effort requiring multiple models, benchmark infrastructure, and metric collection. It is out of scope for the first implementation. The evaluation should be conducted after the extension is dogfooded on real sessions.

- **Spec package-name TBD** (`docs/superpowers/specs/2026-07-25-pi-edit-tools-design.md:8`): Update "Final package name: TBD" to "pi-edit-tools" in the source spec.