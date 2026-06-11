# Delegate Context Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named, frozen, on-disk context packs (`delegate_pack` tool + `context_pack` param) and a `system_prompt_file` param to `delegate_start`, then rewire the delegate-driven-development skill to use them instead of anchor choreography.

**Architecture:** A new pure module `pack.ts` compiles ordered file contents into a pack JSONL (header + user-message session entries) and resolves pack references. `buildSessionSnapshot` gains an optional `packEntries` argument that appends re-identified pack entries after any anchor branch. `delegate_start` grows `context_pack` (name or path) and `system_prompt_file` (path read at spawn, forwarded as the RPC `systemPrompt`). The DDD skill drops anchor-first choreography for packs and moves role prompts into the system layer.

**Tech Stack:** TypeScript, π extension API (typebox schemas), vitest. All work is in `packages/pi-delegate-driven-development/`.

**Spec:** `docs/superpowers/specs/2026-06-11-delegate-context-packs-design.md` (approved). Read it before starting.

**Conventions:**
- Run all npm commands from the repo root: `npm test -w pi-delegate-driven-development`, `npm run typecheck -w pi-delegate-driven-development`.
- To run a single test file: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/<file>.test.ts`
- All paths below are relative to `packages/pi-delegate-driven-development/` unless they start with `docs/` or `packages/`.

---

## File structure

| File | Responsibility |
|---|---|
| `extensions/delegate/pack.ts` (new) | Pure pack compiler (`buildPackFile`, `parsePackFile`) and filesystem resolution (`resolvePackPath`, `listPackNames`) |
| `extensions/delegate/snapshot.ts` (modify) | `buildSessionSnapshot` gains nullable session manager + `packEntries` composition |
| `extensions/delegate/index.ts` (modify) | New `delegate_pack` tool; `context_pack` + `system_prompt_file` params on `delegate_start` |
| `extensions/delegate/types.ts` (modify) | `DelegateStartParams` gains `context_pack?`, `system_prompt_file?` |
| `extensions/delegate/tests/pack.test.ts` (new) | Compiler + resolution unit tests |
| `extensions/delegate/tests/snapshot.test.ts` (modify) | Composition tests |
| `extensions/delegate/tests/index.delegate-pack.test.ts` (new) | `delegate_pack` tool tests (real fs in tmp dir) |
| `extensions/delegate/tests/index.context-pack.test.ts` (new) | `delegate_start` `context_pack` + `system_prompt_file` tests (mocked RPC) |
| `extensions/delegate/tests/index.inherit-context.test.ts` (modify) | Update `buildSessionSnapshot` arity assertions |
| `skills/delegate-driven-development/SKILL.md` (modify) | Packs + system_prompt_file orchestration |
| `skills/delegate-driven-development/references/{implementer,reviewer,fixer}-prompt.md` (rewrite) | System-prompt voice, no `{{…}}` placeholders |
| `README.md` (modify) | Mention `delegate_pack` |

`rpc-client.ts` is intentionally untouched: `index.ts` reads the system prompt file and passes content through the existing `systemPrompt` option.

---

### Task 1: Pack compiler (`buildPackFile`, `parsePackFile`)

**Files:**
- Create: `extensions/delegate/pack.ts`
- Test: `extensions/delegate/tests/pack.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `extensions/delegate/tests/pack.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPackFile, parsePackFile, PACK_NAME_PATTERN } from "../pack";
import type { PackItem } from "../pack";

describe("PACK_NAME_PATTERN", () => {
  it("accepts lowercase alphanumeric with dashes/underscores", () => {
    expect(PACK_NAME_PATTERN.test("plan-foundation")).toBe(true);
    expect(PACK_NAME_PATTERN.test("impl_v2")).toBe(true);
    expect(PACK_NAME_PATTERN.test("a")).toBe(true);
  });

  it("rejects uppercase, leading separators, slashes, and empty", () => {
    expect(PACK_NAME_PATTERN.test("Plan")).toBe(false);
    expect(PACK_NAME_PATTERN.test("-x")).toBe(false);
    expect(PACK_NAME_PATTERN.test("a/b")).toBe(false);
    expect(PACK_NAME_PATTERN.test("")).toBe(false);
  });
});

describe("buildPackFile", () => {
  const items: PackItem[] = [
    { kind: "file", path: "docs/spec.md", content: "SPEC BODY" },
    { kind: "file", path: "docs/plan.md", content: "PLAN BODY" },
    { kind: "note", content: "Reviewer: be strict." },
  ];

  it("first line is a pack header with name, version 1, and sources metadata", () => {
    const lines = buildPackFile("plan-foundation", items).trim().split("\n");
    const header = JSON.parse(lines[0]);

    expect(header.type).toBe("pack");
    expect(header.version).toBe(1);
    expect(header.name).toBe("plan-foundation");
    expect(typeof header.timestamp).toBe("string");
    expect(header.sources).toEqual([
      { path: "docs/spec.md", bytes: 9 },
      { path: "docs/plan.md", bytes: 9 },
      { note: true, bytes: 20 },
    ]);
  });

  it("emits one user-message entry per item, in order, with framing headers", () => {
    const lines = buildPackFile("plan-foundation", items).trim().split("\n");
    const entries = lines.slice(1).map((l) => JSON.parse(l));

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.type).toBe("message");
      expect(entry.message.role).toBe("user");
      expect(entry.message.content).toHaveLength(1);
      expect(entry.message.content[0].type).toBe("text");
    }
    expect(entries[0].message.content[0].text).toBe(
      "[context-pack:plan-foundation] File: docs/spec.md\n\nSPEC BODY",
    );
    expect(entries[1].message.content[0].text).toBe(
      "[context-pack:plan-foundation] File: docs/plan.md\n\nPLAN BODY",
    );
    expect(entries[2].message.content[0].text).toBe(
      "[context-pack:plan-foundation] Note from orchestrator:\n\nReviewer: be strict.",
    );
  });

  it("chains placeholder parentIds (first is null)", () => {
    const lines = buildPackFile("p", items).trim().split("\n");
    const entries = lines.slice(1).map((l) => JSON.parse(l));

    expect(entries[0].parentId).toBeNull();
    expect(entries[1].parentId).toBe(entries[0].id);
    expect(entries[2].parentId).toBe(entries[1].id);
  });

  it("produces byte-identical message payloads for identical inputs", () => {
    const a = buildPackFile("p", items).trim().split("\n").slice(1)
      .map((l) => JSON.stringify(JSON.parse(l).message.content));
    const b = buildPackFile("p", items).trim().split("\n").slice(1)
      .map((l) => JSON.stringify(JSON.parse(l).message.content));
    expect(a).toEqual(b);
  });
});

describe("parsePackFile", () => {
  it("round-trips buildPackFile output", () => {
    const content = buildPackFile("p", [{ kind: "file", path: "a.md", content: "A" }]);
    const { header, entries } = parsePackFile(content);

    expect(header.name).toBe("p");
    expect(entries).toHaveLength(1);
    expect(entries[0].message.content[0].text).toContain("File: a.md");
  });

  it("rejects an empty file", () => {
    expect(() => parsePackFile("")).toThrow(/empty/i);
  });

  it("rejects a non-pack header", () => {
    expect(() => parsePackFile('{"type":"session","version":3}\n')).toThrow(/not a pack/i);
  });

  it("rejects an unsupported version", () => {
    expect(() => parsePackFile('{"type":"pack","version":2,"name":"p","timestamp":"t","sources":[]}\n')).toThrow(
      /version/i,
    );
  });

  it("rejects invalid JSON entries", () => {
    const content = '{"type":"pack","version":1,"name":"p","timestamp":"t","sources":[]}\nnot-json\n';
    expect(() => parsePackFile(content)).toThrow(/invalid JSON/i);
  });

  it("rejects non-message entries", () => {
    const content =
      '{"type":"pack","version":1,"name":"p","timestamp":"t","sources":[]}\n{"type":"model_change","id":"x"}\n';
    expect(() => parsePackFile(content)).toThrow(/entry type/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/pack.test.ts`
Expected: FAIL — cannot resolve `../pack`.

- [ ] **Step 3: Write the implementation**

Create `extensions/delegate/pack.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

export type PackItem =
  | { kind: "file"; path: string; content: string }
  | { kind: "note"; content: string };

export type PackSource = { path: string; bytes: number } | { note: true; bytes: number };

export type PackHeader = {
  type: "pack";
  version: number;
  name: string;
  timestamp: string;
  sources: PackSource[];
};

export type PackMessageEntry = {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: {
    role: "user";
    content: Array<{ type: "text"; text: string }>;
    timestamp: number;
  };
};

export const PACK_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export function buildPackFile(name: string, items: PackItem[]): string {
  const now = new Date();

  const sources: PackSource[] = items.map((item) =>
    item.kind === "file"
      ? { path: item.path, bytes: Buffer.byteLength(item.content, "utf8") }
      : { note: true, bytes: Buffer.byteLength(item.content, "utf8") },
  );

  const header: PackHeader = {
    type: "pack",
    version: 1,
    name,
    timestamp: now.toISOString(),
    sources,
  };

  const lines: string[] = [JSON.stringify(header)];
  let parentId: string | null = null;

  items.forEach((item, index) => {
    const id = `pack-${index}`;
    const text =
      item.kind === "file"
        ? `[context-pack:${name}] File: ${item.path}\n\n${item.content}`
        : `[context-pack:${name}] Note from orchestrator:\n\n${item.content}`;

    const entry: PackMessageEntry = {
      type: "message",
      id,
      parentId,
      timestamp: now.toISOString(),
      message: {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: now.getTime(),
      },
    };
    lines.push(JSON.stringify(entry));
    parentId = id;
  });

  return `${lines.join("\n")}\n`;
}

export function parsePackFile(content: string): { header: PackHeader; entries: PackMessageEntry[] } {
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Pack file is empty");
  }

  let header: PackHeader;
  try {
    header = JSON.parse(lines[0]) as PackHeader;
  } catch {
    throw new Error("Pack file header is not valid JSON");
  }
  if (header.type !== "pack") {
    throw new Error("Not a pack file (header type is not 'pack')");
  }
  if (header.version !== 1) {
    throw new Error(`Unsupported pack version: ${header.version} (expected 1)`);
  }

  const entries: PackMessageEntry[] = [];
  for (const line of lines.slice(1)) {
    let entry: PackMessageEntry;
    try {
      entry = JSON.parse(line) as PackMessageEntry;
    } catch {
      throw new Error("Pack file contains an invalid JSON entry");
    }
    if (entry.type !== "message") {
      throw new Error(`Unexpected pack entry type: ${entry.type} (expected 'message')`);
    }
    entries.push(entry);
  }

  return { header, entries };
}
```

(`fs` and `path` are unused until Task 2 — that's fine; they're used by the resolution functions added there. If the linter complains, defer the imports to Task 2.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/pack.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/pack.ts packages/pi-delegate-driven-development/extensions/delegate/tests/pack.test.ts
git commit -m "feat(delegate): add context pack compiler (buildPackFile/parsePackFile)"
```

---

### Task 2: Pack resolution (`resolvePackPath`, `listPackNames`)

**Files:**
- Modify: `extensions/delegate/pack.ts`
- Test: `extensions/delegate/tests/pack.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `extensions/delegate/tests/pack.test.ts` (add imports at top: `import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { afterEach, beforeEach } from "vitest";` and extend the pack import with `listPackNames, resolvePackPath`):

```ts
describe("pack resolution", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pack-test-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writePack(date: string, name: string, marker: string): string {
    const dir = path.join(root, ".pi", "delegate", date, "packs");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${name}.jsonl`);
    fs.writeFileSync(p, marker, "utf8");
    return p;
  }

  it("resolves a bare name to the newest date dir containing it", () => {
    writePack("2026-06-09", "impl", "old");
    const newest = writePack("2026-06-10", "impl", "new");

    expect(resolvePackPath(root, "impl", "/anywhere")).toBe(newest);
  });

  it("falls back to older dates when newest lacks the name", () => {
    const only = writePack("2026-06-09", "impl", "x");
    writePack("2026-06-10", "other", "y");

    expect(resolvePackPath(root, "impl", "/anywhere")).toBe(only);
  });

  it("treats values containing '/' or ending in .jsonl as paths resolved against cwd", () => {
    const p = writePack("2026-06-10", "impl", "x");

    expect(resolvePackPath(root, p, "/anywhere")).toBe(p);
    expect(resolvePackPath(root, path.relative(root, p), root)).toBe(p);
  });

  it("throws for a path that does not exist", () => {
    expect(() => resolvePackPath(root, "./nope/missing.jsonl", root)).toThrow(/not found at path/i);
  });

  it("throws for an unknown name, listing available packs", () => {
    writePack("2026-06-09", "impl", "x");
    writePack("2026-06-10", "review", "y");

    expect(() => resolvePackPath(root, "missing", "/anywhere")).toThrow(
      /No context pack named 'missing'.*impl, review/s,
    );
  });

  it("throws helpfully when no packs exist at all", () => {
    expect(() => resolvePackPath(root, "missing", "/anywhere")).toThrow(/\(none\)/);
  });

  it("listPackNames returns sorted unique names across date dirs", () => {
    writePack("2026-06-09", "impl", "x");
    writePack("2026-06-10", "impl", "y");
    writePack("2026-06-10", "review", "z");

    expect(listPackNames(root)).toEqual(["impl", "review"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/pack.test.ts`
Expected: FAIL — `resolvePackPath` / `listPackNames` not exported.

- [ ] **Step 3: Write the implementation**

Append to `extensions/delegate/pack.ts`:

```ts
export function listPackNames(projectRoot: string): string[] {
  const base = path.join(projectRoot, ".pi", "delegate");
  const names = new Set<string>();

  let dates: string[];
  try {
    dates = fs.readdirSync(base);
  } catch {
    return [];
  }

  for (const date of dates) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(base, date, "packs"));
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        names.add(file.slice(0, -".jsonl".length));
      }
    }
  }

  return [...names].sort();
}

export function resolvePackPath(projectRoot: string, ref: string, cwd: string): string {
  if (ref.includes("/") || ref.endsWith(".jsonl")) {
    const resolved = path.resolve(cwd, ref);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Context pack not found at path: ${resolved}`);
    }
    return resolved;
  }

  const base = path.join(projectRoot, ".pi", "delegate");
  let dates: string[] = [];
  try {
    dates = fs.readdirSync(base).sort().reverse();
  } catch {
    // fall through to the not-found error below
  }

  for (const date of dates) {
    const candidate = path.join(base, date, "packs", `${ref}.jsonl`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const available = listPackNames(projectRoot);
  const availableText = available.length > 0 ? available.join(", ") : "(none)";
  throw new Error(
    `No context pack named '${ref}'. Available packs: ${availableText}. Create one with delegate_pack.`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/pack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/pack.ts packages/pi-delegate-driven-development/extensions/delegate/tests/pack.test.ts
git commit -m "feat(delegate): add context pack name/path resolution"
```

---

### Task 3: Snapshot composition (`buildSessionSnapshot` + pack entries)

**Files:**
- Modify: `extensions/delegate/snapshot.ts`
- Test: `extensions/delegate/tests/snapshot.test.ts` (append)

Note: this task changes only `snapshot.ts` and its tests. `index.ts` still calls `buildSessionSnapshot` with 3 args (the new 4th param defaults to `[]`), so existing index tests stay green.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/delegate/tests/snapshot.test.ts`, inside the existing `describe("buildSessionSnapshot", …)` block (it already mocks `node:crypto`'s `randomUUID` and fake timers). Add at the top of the file, after the existing imports: `import { randomUUID } from "node:crypto";`

```ts
  const packEntries = [
    {
      type: "message",
      id: "pack-0",
      parentId: null,
      timestamp: "frozen",
      message: { role: "user", content: [{ type: "text", text: "SPEC" }], timestamp: 1 },
    },
    {
      type: "message",
      id: "pack-1",
      parentId: "pack-0",
      timestamp: "frozen",
      message: { role: "user", content: [{ type: "text", text: "PLAN" }], timestamp: 1 },
    },
  ];

  it("accepts a null session manager and emits header + pack entries only", () => {
    vi.mocked(randomUUID)
      .mockReturnValueOnce("header-uuid" as never)
      .mockReturnValueOnce("aaaa1111bbbb" as never)
      .mockReturnValueOnce("cccc2222dddd" as never);

    const lines = buildSessionSnapshot(null, "/w", null, packEntries).trim().split("\n");
    expect(lines).toHaveLength(3);

    const first = JSON.parse(lines[1]);
    const second = JSON.parse(lines[2]);
    expect(first.id).toBe("aaaa1111");
    expect(first.parentId).toBeNull();
    expect(second.id).toBe("cccc2222");
    expect(second.parentId).toBe("aaaa1111");
  });

  it("re-parents the first pack entry onto the anchor branch leaf", () => {
    vi.mocked(randomUUID)
      .mockReturnValueOnce("header-uuid" as never)
      .mockReturnValueOnce("aaaa1111bbbb" as never)
      .mockReturnValueOnce("cccc2222dddd" as never);

    const branch = [{ id: "e1" }, { id: "e2" }];
    const lines = buildSessionSnapshot(makeMgr(branch), "/w", "e2", packEntries).trim().split("\n");
    expect(lines).toHaveLength(5);

    const firstPack = JSON.parse(lines[3]);
    expect(firstPack.parentId).toBe("e2");
  });

  it("never mutates message payloads when re-identifying pack entries", () => {
    const lines = buildSessionSnapshot(null, "/w", null, packEntries).trim().split("\n");
    const first = JSON.parse(lines[1]);
    const second = JSON.parse(lines[2]);

    expect(first.message).toEqual(packEntries[0].message);
    expect(second.message).toEqual(packEntries[1].message);
  });

  it("defaults to no pack entries (backward compatible)", () => {
    const branch = [{ id: "e1" }];
    const lines = buildSessionSnapshot(makeMgr(branch), "/w", "e1").trim().split("\n");
    expect(lines).toHaveLength(2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/snapshot.test.ts`
Expected: FAIL — `buildSessionSnapshot` does not accept null manager / 4th argument behavior missing.

- [ ] **Step 3: Write the implementation**

Replace the function in `extensions/delegate/snapshot.ts` with:

```ts
export function buildSessionSnapshot(
  sessionManager: SnapshotSessionManager | null,
  workerCwd: string,
  anchorEntryId: string | null,
  packEntries: object[] = [],
): string {
  const header = {
    type: "session",
    version: 3,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: workerCwd,
  };

  const lines: string[] = [JSON.stringify(header)];
  let leafId: string | null = null;

  if (sessionManager !== null && anchorEntryId !== null) {
    for (const entry of sessionManager.getBranch(anchorEntryId)) {
      lines.push(JSON.stringify(entry));
      const id = (entry as { id?: unknown }).id;
      if (typeof id === "string") {
        leafId = id;
      }
    }
  }

  let parentId: string | null = leafId;
  for (const entry of packEntries) {
    const id = randomUUID().slice(0, 8);
    const rewritten = { ...(entry as Record<string, unknown>), id, parentId };
    lines.push(JSON.stringify(rewritten));
    parentId = id;
  }

  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run the full delegate test suite to verify nothing regressed**

Run: `npm test -w pi-delegate-driven-development`
Expected: PASS (snapshot tests including new ones; all index tests untouched and green).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/snapshot.ts packages/pi-delegate-driven-development/extensions/delegate/tests/snapshot.test.ts
git commit -m "feat(delegate): compose pack entries into session snapshots"
```

---

### Task 4: `delegate_pack` tool

**Files:**
- Modify: `extensions/delegate/index.ts`
- Test: `extensions/delegate/tests/index.delegate-pack.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `extensions/delegate/tests/index.delegate-pack.test.ts`. The tool writes under the extension's `projectRoot`, which `delegate()` computes via `resolveGitRoot(process.cwd())`; in a git-less tmp dir that falls back to the cwd, so the test `chdir`s into a tmp dir before calling `delegate(pi)`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import delegate from "../index";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }>;
};

function createFakePi() {
  const registeredTools: RegisteredTool[] = [];
  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;
  return { pi, getTool: (name: string) => registeredTools.find((t) => t.name === name) };
}

describe("delegate_pack", () => {
  let root: string;
  let originalCwd: string;
  let tool: RegisteredTool;

  beforeEach(() => {
    originalCwd = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-pack-"));
    process.chdir(root);

    fs.writeFileSync(path.join(root, "spec.md"), "SPEC BODY", "utf8");
    fs.writeFileSync(path.join(root, "plan.md"), "PLAN BODY", "utf8");
    fs.writeFileSync(path.join(root, "empty.md"), "  \n", "utf8");

    const { pi, getTool } = createFakePi();
    delegate(pi);
    tool = getTool("delegate_pack")!;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function todayDate(): string {
    return new Date().toLocaleDateString("en-CA");
  }

  it("compiles files into a frozen pack under .pi/delegate/<date>/packs/", async () => {
    const result = await tool.execute("c1", { name: "plan-foundation", files: ["spec.md", "plan.md"] });

    const expected = path.join(root, ".pi", "delegate", todayDate(), "packs", "plan-foundation.jsonl");
    expect(result.details?.path).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);

    const lines = fs.readFileSync(expected, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]).type).toBe("pack");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1]).message.content[0].text).toContain("SPEC BODY");

    expect(result.details?.items).toBe(2);
    expect(typeof result.details?.bytes).toBe("number");
    expect(typeof result.details?.token_estimate).toBe("number");
    expect(result.content[0].text).toContain("plan-foundation");
  });

  it("appends the note after the files", async () => {
    const result = await tool.execute("c1", { name: "p", files: ["spec.md"], note: "Be strict." });

    const lines = fs.readFileSync(result.details?.path as string, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]).message.content[0].text).toContain("Note from orchestrator:");
  });

  it("rejects invalid names", async () => {
    await expect(tool.execute("c1", { name: "Bad/Name", files: ["spec.md"] })).rejects.toThrow(/Invalid pack name/);
  });

  it("rejects an empty pack (no files, no note)", async () => {
    await expect(tool.execute("c1", { name: "p", files: [] })).rejects.toThrow(/at least one file or a note/);
  });

  it("allows note-only packs", async () => {
    const result = await tool.execute("c1", { name: "p", files: [], note: "Just guidance." });
    expect(fs.existsSync(result.details?.path as string)).toBe(true);
  });

  it("fails fast on a missing source file, naming the path", async () => {
    await expect(tool.execute("c1", { name: "p", files: ["nope.md"] })).rejects.toThrow(/nope\.md/);
  });

  it("fails on an empty source file", async () => {
    await expect(tool.execute("c1", { name: "p", files: ["empty.md"] })).rejects.toThrow(/empty/i);
  });

  it("refuses to overwrite an existing pack without overwrite: true", async () => {
    await tool.execute("c1", { name: "p", files: ["spec.md"] });
    await expect(tool.execute("c2", { name: "p", files: ["plan.md"] })).rejects.toThrow(/already exists/);
  });

  it("overwrites with overwrite: true", async () => {
    await tool.execute("c1", { name: "p", files: ["spec.md"] });
    const result = await tool.execute("c2", { name: "p", files: ["plan.md"], overwrite: true });

    const lines = fs.readFileSync(result.details?.path as string, "utf8").trim().split("\n");
    expect(JSON.parse(lines[1]).message.content[0].text).toContain("PLAN BODY");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.delegate-pack.test.ts`
Expected: FAIL — `delegate_pack` tool not registered (`tool` is undefined).

- [ ] **Step 3: Implement the tool**

In `extensions/delegate/index.ts`:

(a) Extend the fs import:

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

(b) Add to the module imports:

```ts
import { buildPackFile, PACK_NAME_PATTERN, parsePackFile, resolvePackPath } from "./pack";
import type { PackItem } from "./pack";
```

(`parsePackFile` and `resolvePackPath` are used in Task 5; include them now to avoid churn.)

(c) Register the tool immediately after the `delegate_anchor` registration block (after its closing `});`):

```ts
  pi.registerTool({
    name: "delegate_pack",
    label: "Delegate Pack",
    description:
      "Compile an ordered list of files (plus optional note) into a frozen, named context pack that delegate_start workers can share as a cached prefix.",
    promptSnippet:
      "Use to convert files like spec and plan into a frozen context pack reusable across many delegate_start workers.",
    promptGuidelines: [
      "Use delegate_pack to freeze spec/plan files into a named context pack before dispatching workers.",
      "Packs are immutable; pass overwrite: true only when you intend to start a new cache prefix generation.",
      "Consume packs via delegate_start({ context_pack: \"<name>\" }).",
    ],
    parameters: Type.Object({
      name: Type.String({
        description: "Pack name: lowercase letters, digits, '-', '_' (must start alphanumeric)",
      }),
      files: Type.Array(Type.String(), {
        description: "Ordered file paths to embed, resolved against the orchestrator cwd",
      }),
      note: Type.Optional(
        Type.String({ description: "Optional freeform note appended after the files" }),
      ),
      overwrite: Type.Optional(
        Type.Boolean({ description: "Replace an existing same-name pack from today (default false)" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!PACK_NAME_PATTERN.test(params.name)) {
        throw new Error(
          `Invalid pack name '${params.name}'. Use lowercase letters, digits, '-', '_' (must start alphanumeric).`,
        );
      }
      if (params.files.length === 0 && !params.note) {
        throw new Error("Pack needs at least one file or a note.");
      }

      const items: PackItem[] = [];
      for (const file of params.files) {
        const resolved = path.resolve(initialCwd, file);
        let content: string;
        try {
          content = readFileSync(resolved, "utf8");
        } catch {
          throw new Error(`Cannot read pack source file: ${resolved}`);
        }
        if (content.trim().length === 0) {
          throw new Error(`Pack source file is empty: ${resolved}`);
        }
        items.push({ kind: "file", path: file, content });
      }
      if (params.note) {
        items.push({ kind: "note", content: params.note });
      }

      const packPath = path.join(
        projectRoot,
        ".pi",
        "delegate",
        todayDate(),
        "packs",
        `${params.name}.jsonl`,
      );
      if (existsSync(packPath) && !params.overwrite) {
        throw new Error(
          `Pack '${params.name}' already exists at ${packPath}. Pass overwrite: true to replace it (this starts a new cache prefix), or pick a new name.`,
        );
      }

      const content = buildPackFile(params.name, items);
      mkdirSync(path.dirname(packPath), { recursive: true });
      writeFileSync(packPath, content, "utf8");

      const bytes = Buffer.byteLength(content, "utf8");
      const tokenEstimate = Math.round(bytes / 4);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Pack '${params.name}' frozen (${items.length} items, ${bytes} bytes, ~${tokenEstimate} tokens).`,
              `Path: ${packPath}`,
              `Use with delegate_start({ context_pack: "${params.name}" }).`,
            ].join("\n"),
          },
        ],
        details: {
          name: params.name,
          path: packPath,
          items: items.length,
          bytes,
          token_estimate: tokenEstimate,
        },
      };
    },
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.delegate-pack.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test -w pi-delegate-driven-development && npm run typecheck -w pi-delegate-driven-development`
Expected: PASS / no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/index.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.delegate-pack.test.ts
git commit -m "feat(delegate): add delegate_pack tool"
```

---

### Task 5: `context_pack` parameter on `delegate_start`

**Files:**
- Modify: `extensions/delegate/index.ts`
- Modify: `extensions/delegate/types.ts`
- Modify: `extensions/delegate/tests/index.inherit-context.test.ts` (arity updates)
- Test: `extensions/delegate/tests/index.context-pack.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `extensions/delegate/tests/index.context-pack.test.ts`. It reuses the mock structure of `index.inherit-context.test.ts` (copy that file's `vi.hoisted` mocks, `vi.mock` blocks for `../worker-manager`, `../rpc-client`, `../snapshot`, `../visibility`, `node:fs`, plus `createFakePi`/`makeCtx` helpers verbatim) and adds a mock for `../pack`:

```ts
const packMocks = vi.hoisted(() => ({
  resolvePackPath: vi.fn(() => "/resolved/packs/impl.jsonl"),
  parsePackFile: vi.fn(() => ({
    header: { type: "pack", version: 1, name: "impl", timestamp: "t", sources: [] },
    entries: [{ type: "message", id: "pack-0", parentId: null }],
  })),
  buildPackFile: vi.fn(() => ""),
  PACK_NAME_PATTERN: /^[a-z0-9][a-z0-9_-]*$/,
}));

vi.mock("../pack", () => ({
  resolvePackPath: packMocks.resolvePackPath,
  parsePackFile: packMocks.parsePackFile,
  buildPackFile: packMocks.buildPackFile,
  PACK_NAME_PATTERN: packMocks.PACK_NAME_PATTERN,
}));
```

Also extend the copied `node:fs` mock with a `readFileSync` spy:

```ts
const fsMock = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(() => "PACK FILE CONTENT"),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: fsMock.writeFileSync,
    rmSync: fsMock.rmSync,
    readFileSync: fsMock.readFileSync,
    existsSync: fsMock.existsSync,
    mkdirSync: fsMock.mkdirSync,
  };
});
```

Test cases (inside a `describe("delegate_start context_pack", …)` with the same `beforeEach` reset as the inherit-context tests):

```ts
  it("pack without anchor builds a snapshot from a null manager plus pack entries", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", context_pack: "impl" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(packMocks.resolvePackPath).toHaveBeenCalledWith(expect.any(String), "impl", expect.any(String));
    expect(fsMock.readFileSync).toHaveBeenCalledWith("/resolved/packs/impl.jsonl", "utf8");
    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(
      null,
      expect.any(String),
      null,
      [{ type: "message", id: "pack-0", parentId: null }],
    );
    expect(capturedRpcOptions.value?.sessionPath).toEqual(expect.stringContaining("pi-worker-w1-"));
  });

  it("anchor plus pack passes both the session manager and pack entries", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);
    const ctx = makeCtx({ leafId: "leaf9999" });

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", inherit_context: true, context_pack: "impl" },
      undefined,
      undefined,
      ctx,
    );

    expect(snapshotMock.buildSessionSnapshot).toHaveBeenCalledWith(
      ctx.sessionManager,
      expect.any(String),
      "leaf9999",
      [{ type: "message", id: "pack-0", parentId: null }],
    );
  });

  it("reports the resolved pack path in details", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    const result = await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", context_pack: "impl" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.details?.context_pack_path).toBe("/resolved/packs/impl.jsonl");
  });

  it("unresolvable pack fails pre-start and does not start the RPC client", async () => {
    packMocks.resolvePackPath.mockImplementationOnce(() => {
      throw new Error("No context pack named 'impl'");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", context_pack: "impl" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow("No context pack named 'impl'");

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.stringContaining("No context pack"));
    expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("corrupt pack file fails pre-start", async () => {
    packMocks.parsePackFile.mockImplementationOnce(() => {
      throw new Error("Unsupported pack version: 2 (expected 1)");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", context_pack: "impl" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow(/pack version/);

    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("no pack and no anchor leaves sessionPath undefined (unchanged behavior)", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(snapshotMock.buildSessionSnapshot).not.toHaveBeenCalled();
    expect(capturedRpcOptions.value?.sessionPath).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.context-pack.test.ts`
Expected: FAIL — `context_pack` is ignored; snapshot not called for pack-only.

- [ ] **Step 3: Implement**

(a) `extensions/delegate/types.ts` — extend `DelegateStartParams`:

```ts
export type DelegateStartParams = {
  task: string;
  model: string;
  provider: string;
  thinking?: ThinkingLevel;
  tools?: string[];
  denied_tools?: string[];
  timeout?: number;
  inherit_context?: boolean | string;
  context_pack?: string;
  visibility?: "log";
  system_prompt?: string;
  system_prompt_file?: string;
  cwd?: string;
};
```

(`system_prompt_file` is added now to avoid touching this file twice; it's wired up in Task 6.)

(b) `extensions/delegate/index.ts` — add to the `delegate_start` `parameters` object, after `inherit_context`:

```ts
      context_pack: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            'Context pack created by delegate_pack: a name (resolved newest-date-first under .pi/delegate/*/packs/) or an explicit path (contains "/" or ends with .jsonl). Appended to the worker session after any inherit_context content.',
        }),
      ),
```

(c) Add to `delegate_start`'s `promptGuidelines` array:

```ts
      "Use delegate_pack + context_pack to give many workers an identical frozen file-based prefix (spec/plan); context_pack composes with inherit_context (anchor first, pack appended).",
```

(d) Replace the context-inheritance block in `execute` (from `let sessionPath: string | undefined;` through the end of the `if (params.inherit_context …) { … }` block) with:

```ts
      let sessionPath: string | undefined;
      let resolvedPackPath: string | undefined;

      const usesAnchor = params.inherit_context === true || typeof params.inherit_context === "string";
      const usesPack = typeof params.context_pack === "string" && params.context_pack.length > 0;

      if (usesAnchor || usesPack) {
        let tmpPath: string | undefined;

        try {
          let snapshotManager: {
            getLeafId(): string | null;
            getBranch(fromId?: string): object[];
          } | null = null;
          let anchorEntryId: string | null = null;

          if (usesAnchor) {
            const sessionManager = (
              ctx as {
                sessionManager: {
                  getLeafId(): string | null;
                  getBranch(fromId?: string): object[];
                };
              }
            ).sessionManager;

            if (params.inherit_context === true) {
              anchorEntryId = sessionManager.getLeafId();
            } else {
              const anchorName = params.inherit_context as string;
              if (!anchorMap.has(anchorName)) {
                throw new Error(
                  `No anchor named '${anchorName}'. Call delegate_anchor({ name: '${anchorName}' }) first.`,
                );
              }
              anchorEntryId = anchorMap.get(anchorName)!;
            }
            snapshotManager = sessionManager;
          }

          let packEntries: object[] = [];
          if (usesPack) {
            resolvedPackPath = resolvePackPath(projectRoot, params.context_pack as string, initialCwd);
            const parsed = parsePackFile(readFileSync(resolvedPackPath, "utf8"));
            packEntries = parsed.entries;
          }

          tmpPath = `${tmpdir()}/pi-worker-${taskId}-${Date.now()}.jsonl`;
          const snapshot = buildSessionSnapshot(snapshotManager, workerCwd, anchorEntryId, packEntries);
          writeFileSync(tmpPath, snapshot, "utf8");
          entry.tempFilePath = tmpPath;
          sessionPath = tmpPath;
        } catch (err) {
          if (tmpPath) {
            try {
              rmSync(tmpPath, { force: true });
            } catch {
              // ignore
            }
          }
          const msg = err instanceof Error ? err.message : String(err);
          transitionWorker("failed", msg);
          tryCloseLogWriter();
          throw new Error(msg);
        }
      }
```

(e) In the `delegate_start` return value, add the resolved pack path to `details` (after `status_file_relative`):

```ts
          ...(resolvedPackPath ? { context_pack_path: resolvedPackPath } : {}),
```

(f) Update `extensions/delegate/tests/index.inherit-context.test.ts`: the three `toHaveBeenCalledWith` assertions on `buildSessionSnapshot` now need a 4th argument. Change:

- `toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), "leaf9999")` → `toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), "leaf9999", [])`
- `toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), "anchor1111")` → `toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), "anchor1111", [])`
- `toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), null)` → `toHaveBeenCalledWith(ctx.sessionManager, expect.any(String), null, [])`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w pi-delegate-driven-development`
Expected: PASS (new context-pack tests, updated inherit-context tests, everything else green).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w pi-delegate-driven-development`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/index.ts packages/pi-delegate-driven-development/extensions/delegate/types.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.context-pack.test.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.inherit-context.test.ts
git commit -m "feat(delegate): add context_pack parameter to delegate_start"
```

---

### Task 6: `system_prompt_file` parameter on `delegate_start`

**Files:**
- Modify: `extensions/delegate/index.ts`
- Test: `extensions/delegate/tests/index.context-pack.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `extensions/delegate/tests/index.context-pack.test.ts` a new describe block (same mocks; `fsMock.readFileSync` is already in place):

```ts
describe("delegate_start system_prompt_file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcOptions.value = null;
    managerMocks.canStart.mockReturnValue(true);
    managerMocks.nextTaskId.mockReturnValue("w1");
    managerMocks.setStatus.mockReturnValue(true);
    managerMocks.register.mockReturnValue({
      taskId: "w1", status: "running", params: {}, startedAt: Date.now(),
    });
    fsMock.readFileSync.mockReturnValue("ROLE PROMPT CONTENT");
  });

  it("reads the file and forwards its content as the RPC systemPrompt", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", system_prompt_file: "refs/implementer-prompt.md" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(fsMock.readFileSync).toHaveBeenCalledWith(
      expect.stringContaining("refs/implementer-prompt.md"),
      "utf8",
    );
    expect(capturedRpcOptions.value?.systemPrompt).toBe("ROLE PROMPT CONTENT");
  });

  it("resolves the path against the worker cwd when params.cwd is set", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await getTool("delegate_start")!.execute(
      "c1",
      { task: "x", model: "m", provider: "p", cwd: "/worker/tree", system_prompt_file: "refs/p.md" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(fsMock.readFileSync).toHaveBeenCalledWith("/worker/tree/refs/p.md", "utf8");
  });

  it("rejects when both system_prompt and system_prompt_file are set, before registering a worker", async () => {
    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", system_prompt: "inline", system_prompt_file: "refs/p.md" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow(/both 'system_prompt' and 'system_prompt_file'/);

    expect(managerMocks.register).not.toHaveBeenCalled();
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("unreadable file fails the worker pre-start and names the path", async () => {
    fsMock.readFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", system_prompt_file: "refs/missing.md" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow(/refs\/missing\.md/);

    expect(managerMocks.setStatus).toHaveBeenCalledWith("w1", "failed", expect.stringContaining("refs/missing.md"));
    expect(visibilityMocks.writeStatus).toHaveBeenCalledWith("failed");
    expect(rpcMocks.start).not.toHaveBeenCalled();
  });

  it("unreadable file cleans up an already-written pack temp file", async () => {
    fsMock.readFileSync
      .mockReturnValueOnce("PACK FILE CONTENT") // pack read succeeds
      .mockImplementationOnce(() => {
        throw new Error("ENOENT"); // system prompt file read fails
      });

    const { pi, getTool } = createFakePi();
    delegate(pi);

    await expect(
      getTool("delegate_start")!.execute(
        "c1",
        { task: "x", model: "m", provider: "p", context_pack: "impl", system_prompt_file: "refs/missing.md" },
        undefined,
        undefined,
        makeCtx(),
      ),
    ).rejects.toThrow();

    expect(fsMock.rmSync).toHaveBeenCalledWith(expect.stringContaining("pi-worker-w1-"), { force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w pi-delegate-driven-development -- extensions/delegate/tests/index.context-pack.test.ts`
Expected: FAIL — `system_prompt_file` is ignored.

- [ ] **Step 3: Implement**

In `extensions/delegate/index.ts`:

(a) Add to `delegate_start` `parameters`, after `system_prompt`:

```ts
      system_prompt_file: Type.Optional(
        Type.String({
          description:
            "Path to a file whose content is appended to the worker system prompt (resolved against the worker cwd; absolute paths pass through). Mutually exclusive with system_prompt. Use for role prompt templates so their bodies stay out of the orchestrator transcript.",
        }),
      ),
```

(b) At the top of `execute`, extend the early validation (next to the existing tools/denied_tools check):

```ts
      if (params.system_prompt && params.system_prompt_file) {
        throw new Error(
          "Cannot specify both 'system_prompt' and 'system_prompt_file'. Pick one.",
        );
      }
```

(c) After the context-inheritance block (after the closing `}` of `if (usesAnchor || usesPack) { … }`) and before `const rpcClient = new RPCClient(…)`, add:

```ts
      let resolvedSystemPrompt = params.system_prompt;
      if (params.system_prompt_file) {
        const promptPath = path.resolve(workerCwd, params.system_prompt_file);
        try {
          resolvedSystemPrompt = readFileSync(promptPath, "utf8");
        } catch {
          const msg = `Cannot read system_prompt_file: ${promptPath}`;
          tryCleanupTempFile();
          transitionWorker("failed", msg);
          tryCloseLogWriter();
          throw new Error(msg);
        }
      }
```

(d) In the `RPCClient` options, change `systemPrompt: params.system_prompt,` to:

```ts
          systemPrompt: resolvedSystemPrompt,
```

Note on the path-naming test: `path.resolve(workerCwd, "refs/missing.md")` produces an absolute path that still contains `refs/missing.md`, so the error message matches the test's regex.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test -w pi-delegate-driven-development && npm run typecheck -w pi-delegate-driven-development`
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-delegate-driven-development/extensions/delegate/index.ts packages/pi-delegate-driven-development/extensions/delegate/tests/index.context-pack.test.ts
git commit -m "feat(delegate): add system_prompt_file parameter to delegate_start"
```

---

### Task 7: Rewrite role templates as system prompts

**Files:**
- Rewrite: `skills/delegate-driven-development/references/implementer-prompt.md`
- Rewrite: `skills/delegate-driven-development/references/reviewer-prompt.md`
- Rewrite: `skills/delegate-driven-development/references/fixer-prompt.md`

No tests — documentation files. Verify by reading each file after writing: no `{{` remains, report footers unchanged.

- [ ] **Step 1: Rewrite `implementer-prompt.md`** with exactly:

```markdown
# Role: Implementer

You implement ONE task from an implementation plan. The full design spec and plan
are provided in earlier context messages (a shared context pack). Do NOT re-read
them from disk — only open a specific file if you need a detail that is not already
in context.

Your task message provides: the task's plan excerpt, the worktree path (your
working directory), and the feature branch name.

## Environment rules
- Make ALL changes inside the worktree.
- Do NOT create branches or worktrees. Do NOT touch `in-progress/`.

## Process
1. Execute each step of the task in order. Use TDD: write the failing test, run it
   to see it fail, write the minimal implementation, run it to see it pass.
2. Run every verification command the task specifies and confirm the expected output.
3. When all steps pass, create EXACTLY ONE commit containing this task's changes:
   `git add -A && git commit -m "<conventional commit message>"`.
   This commit is the per-task review boundary.
4. Leave the working tree clean — no uncommitted changes.

## Report
End your final message with these lines, exactly:

STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
<one short paragraph summarizing what you did; for NEEDS_CONTEXT or BLOCKED,
state precisely what you need or what is blocking you>
```

- [ ] **Step 2: Rewrite `reviewer-prompt.md`** with exactly:

```markdown
# Role: Reviewer (read-only, two-stage)

The full design spec and plan are provided in earlier context messages (a shared
context pack). You have read-only tools only — you cannot and must not modify files.

Your task message provides: the task's plan excerpt, the worktree path, and the
task base SHA (the commit the task started from).

## Scope — review ONLY this task's changes
In the worktree, run:
- `git diff <task base SHA>..HEAD`
- `git log <task base SHA>..HEAD`
Review only what those show. Never review cumulative branch history or other tasks.

## Stage 1 — Spec compliance
Compare the diff against the design spec's intent for this task.
- MAJOR divergence (wrong approach, missing core requirement, violates an explicit
  spec constraint) -> STOP. Return `VERDICT: FAIL` with Stage 1 findings only and
  skip Stage 2.
- Minor divergences -> note them and continue to Stage 2.

## Stage 2 — Code quality
Assess the diff for: correctness; whether tests exist and actually exercise the
behavior; clarity; DRY / YAGNI; and adherence to existing codebase patterns.
Categorize issues as Critical / Important / Minor.

## Report
End your final message with this exact structure:

VERDICT: PASS | FAIL
### Spec Compliance
<findings>
### Code Quality
<findings; omit this section if you early-exited on a major spec divergence>
### Fix Instructions
<REQUIRED if FAIL: specific, actionable, file/line-referenced instructions the
orchestrator can hand to a fixer verbatim>
```

- [ ] **Step 3: Rewrite `fixer-prompt.md`** with exactly:

```markdown
# Role: Fixer

The full design spec and plan are provided in earlier context messages (a shared
context pack). A reviewer found issues in a task that you must now fix.

Your task message provides: the task's plan excerpt, the reviewer's fix
instructions, the worktree path (your working directory), and the feature branch
name.

## Environment rules
- Make ALL changes inside the worktree.
- Do NOT create branches or worktrees. Do NOT touch `in-progress/`.

## Process
1. Address every item in the fix instructions. Use TDD when adding behavior.
2. Re-run the task's verification commands and confirm they pass.
3. Either amend the existing task commit OR add ONE fix commit. The task's base SHA
   stays fixed, so `git diff <base>..HEAD` must still capture the whole task.
4. Leave the working tree clean — no uncommitted changes.

## Report
End your final message with these lines, exactly:

STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
<short summary of what you changed; for NEEDS_CONTEXT or BLOCKED state what is needed>
```

- [ ] **Step 4: Verify**

Run: `grep -c '{{' packages/pi-delegate-driven-development/skills/delegate-driven-development/references/*.md`
Expected: `0` for all three files (grep exits non-zero on zero matches; that's the pass condition).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-delegate-driven-development/skills/delegate-driven-development/references/
git commit -m "docs(ddd-skill): reword role templates as system prompts"
```

---

### Task 8: Update the delegate-driven-development SKILL.md

**Files:**
- Modify: `skills/delegate-driven-development/SKILL.md`

- [ ] **Step 1: Replace the "Core idea" section**

Replace the entire `## Core idea — cache the spec+plan prefix` section (heading plus its paragraph and the `**Cache correctness (non-negotiable):**` list) with:

```markdown
## Core idea — cache the spec+plan prefix
`delegate_pack` freezes the spec + plan into an on-disk context pack
(`.pi/delegate/<date>/packs/<name>.jsonl`); every worker dispatched with
`context_pack` receives it as an identical message prefix, independent of the
orchestrator's own session history. Role instructions ride in the system layer via
`system_prompt_file`. Each worker's token prefix is exactly:
`[base system prompt][role prompt][pack: spec+plan][task]` — the first worker of
each role pays to process everything before `[task]`; later same-role workers hit
cache.

**Cache correctness (non-negotiable):**
- Lock each role's `(provider, model)`, `system_prompt_file`, and tool scope for
  the whole run ("pick and stick"). The only sanctioned mid-run model switch is
  escalating a repeatedly failing task (see Escalation).
- Role template files are re-read at every spawn — do not edit them mid-run.
- Never put per-ticket detail in the pack or a role prompt. Per-ticket values go
  only in the `task` argument (the uncached tail).
- Never recompile the pack mid-run (`overwrite: true` starts a new cold prefix).
  After an orchestrator restart mid-run, reuse the existing pack by name
  (`context_pack` resolves newest-date-first) — do not recompile.
```

- [ ] **Step 2: Replace the "Run setup" section**

Replace the entire `## Run setup (order matters — anchor FIRST)` section with:

```markdown
## Run setup
1. The kickoff message names the plan + spec paths. (A fresh session is NOT
   required — packs are independent of orchestrator session history.)
2. `delegate_pack({ name: "plan-foundation", files: [<spec path>, <plan path>] })`.
   Do NOT read the full spec/plan into your own context first — workers get them
   from the pack; read targeted sections on demand if orchestration requires it.
   If the pack already exists from an interrupted run, reuse it as-is.
3. Confirm the plan has `### Task N:` sections.
4. `using-git-worktrees` → create `.worktrees/<branch>` on a new feature branch; run
   project setup; verify a clean test baseline. Record the worktree path + branch name.
5. `ticket_shard(plan_path, spec_path)` → tickets land in `in-progress/ready/`.
6. Resolve role models: runtime args → `models.json` (beside this file). **Validate**
   every used role has non-empty `provider` and `model`; if not, halt and ask the user.
7. Record the absolute path of this skill's `references/` directory — role prompts
   are passed from there via `system_prompt_file`.
```

- [ ] **Step 3: Replace the dispatch-leanness paragraph**

Replace the `**Keep dispatches lean.**` paragraph (the one mentioning `{{PLAN_EXCERPT}}` substitutions and "read the template") with:

```markdown
**Keep dispatches lean.** Pass each role's prompt via `system_prompt_file` — the
absolute path to this skill's `references/<role>-prompt.md` (implementer-prompt.md,
reviewer-prompt.md, fixer-prompt.md). The extension reads the file at spawn time, so
template bodies never enter your transcript. The `task` argument carries ONLY
per-task data: the ticket's plan excerpt, worktree path, branch, task base SHA, and
(for fixers) fix instructions. Never inline template bodies into `task`.
```

- [ ] **Step 4: Update the orchestration-loop steps**

In the `## Orchestration loop` numbered list:

Replace steps 2–3 with:

```markdown
2. Build the implementer task message: the ticket's `## Plan excerpt`, the worktree
   path, and the branch name.
3. `delegate_start({ task, cwd: <worktree>, context_pack: "plan-foundation",
   system_prompt_file: "<skill references dir>/implementer-prompt.md",
   provider/model: implementer, thinking, tools: ["read","edit","write","bash"] })`.
```

Replace step 7 with:

```markdown
7. `ticket_move review`. Build the reviewer task message: the ticket's
   `## Plan excerpt`, the worktree path, and `task_base_sha`. `delegate_start` with
   the reviewer model, READ-ONLY tools `["read","bash"]`,
   `context_pack: "plan-foundation"`, and
   `system_prompt_file: "<skill references dir>/reviewer-prompt.md"`. Wait via the
   same non-blocking pattern.
```

- [ ] **Step 5: Update the Escalation section**

Replace the `- **1** → routine fixer run: …` bullet with:

```markdown
- **1** → routine fixer run: build the fixer task message from the ticket's
  `## Plan excerpt`, the fix instructions (read from `next_prompt`), the worktree
  path, and the branch. `delegate_start` with the fixer model, tools
  `["read","edit","write","bash"]`, `context_pack: "plan-foundation"`, and
  `system_prompt_file: "<skill references dir>/fixer-prompt.md"`.
  After it reports, re-run the commit-boundary gate (step 6), then re-enter review (step 7).
```

- [ ] **Step 6: Add an anchors aside (spec requires anchors stay documented)**

At the end of the `## Core idea` section, append:

```markdown
(`delegate_anchor` + `inherit_context` still exist for inheriting live *session*
context into a worker and compose with `context_pack` — anchor content first, pack
appended — but this skill's pipeline does not need them.)
```

- [ ] **Step 7: Verify internal consistency**

Run: `grep -n "inherit_context\|delegate_anchor\|{{" packages/pi-delegate-driven-development/skills/delegate-driven-development/SKILL.md`
Expected: `{{…}}` appears nowhere; `inherit_context`/`delegate_anchor` appear ONLY in the aside added in Step 6 — every orchestration-loop and escalation step uses `context_pack` + `system_prompt_file`.

- [ ] **Step 8: Commit**

```bash
git add packages/pi-delegate-driven-development/skills/delegate-driven-development/SKILL.md
git commit -m "docs(ddd-skill): orchestrate via context packs and system_prompt_file"
```

---

### Task 9: README update + final verification

**Files:**
- Modify: `packages/pi-delegate-driven-development/README.md`

- [ ] **Step 1: Update the README tool list**

In `packages/pi-delegate-driven-development/README.md`, the delegate bullet currently reads:

```markdown
- **delegate** extension — RPC-driven worker spawning (`delegate_start`, `delegate_check`, `delegate_steer`, `delegate_result`, `delegate_abort`, `delegate_anchor`).
```

Replace with:

```markdown
- **delegate** extension — RPC-driven worker spawning (`delegate_start`, `delegate_check`, `delegate_steer`, `delegate_result`, `delegate_abort`, `delegate_anchor`, `delegate_pack`). `delegate_pack` freezes files (e.g. spec + plan) into a reusable context pack consumed via `delegate_start({ context_pack })`; `system_prompt_file` loads role prompts from disk at spawn time.
```

- [ ] **Step 2: Full test suite and typecheck**

Run: `npm test -w pi-delegate-driven-development && npm run typecheck -w pi-delegate-driven-development`
Expected: all tests pass, no type errors.

- [ ] **Step 3: Manual smoke test (worker actually boots from a pack)**

From the repo root, in a π session with the local delegate extension loaded (or via a scratch script), verify end-to-end:

1. `delegate_pack({ name: "smoke", files: ["packages/pi-delegate-driven-development/README.md"] })` → returns a path under `.pi/delegate/<today>/packs/smoke.jsonl`.
2. `delegate_start({ task: "What file was provided in your context pack? Answer with its path only.", model: <any configured model>, provider: <its provider>, context_pack: "smoke", tools: ["read"] })`.
3. Wait, then `delegate_result` → the worker names the README path, proving the session JSONL loaded and the pack content reached the model.
4. Clean up: delete `.pi/delegate/<today>/packs/smoke.jsonl`.

If the worker fails to boot (RPC exit), inspect `delegate_result`'s `stderr` — the most likely cause is a session-entry field mismatch in `buildPackFile`; compare against a real session file in `~/.pi/agent/sessions/` and adjust the entry shape (then re-run Task 1 tests).

Additionally, read `extensions/delegate/tests/integration.test.ts`: if its harness exercises `delegate_start`'s `execute` path end-to-end (rather than only mocked units), add one case that passes `context_pack` pointing at a pack file written into the test's tmp project root and asserts the composed temp session JSONL contains the pack's message text. If the harness cannot reach that path without a real `pi` binary, the manual smoke test above is the integration evidence — note that in the commit message.

- [ ] **Step 4: Commit**

```bash
git add packages/pi-delegate-driven-development/README.md
git commit -m "docs: document delegate_pack and system_prompt_file in bundle README"
```
