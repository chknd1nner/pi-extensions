---
task_number: 7
title: Build the session-list and real ASCII tree view helpers for `/resume` and `/tree`
status: Done
lane: done
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are reviewing Task 7 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket and the current git diff.
  Review only the scope in this ticket plan excerpt.
  If the task passes review:
  - move this ticket to in-progress/done/
  - set status to Done
  - set lane to done
  - add a short approval note

  If the task needs changes:
  - move this ticket to in-progress/needs-fix/
  - set status to Needs fix
  - set lane to needs-fix
  - replace next_prompt with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
review_prompt_template: |-
  You are reviewing Task 7 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket and the current git diff.
  Review only the scope in this ticket plan excerpt.
  If the task passes review:
  - move this ticket to in-progress/done/
  - set status to Done
  - set lane to done
  - add a short approval note

  If the task needs changes:
  - move this ticket to in-progress/needs-fix/
  - set status to Needs fix
  - set lane to needs-fix
  - replace next_prompt with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
---

# Task 07 — Build the session-list and real ASCII tree view helpers for `/resume` and `/tree`

## Plan excerpt


Use Pi's documented filter names verbatim in this task: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.

**Files:**
- Create: `services/familyos/src/core/session-view.ts`
- Create: `services/familyos/tests/session-view.test.ts`

- [x] **Step 1: Write the failing session-view tests**

Create `services/familyos/tests/session-view.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildTreePage, formatSessionList } from "../src/core/session-view";

describe("formatSessionList", () => {
  it("uses the explicit session name when present", () => {
    const items = formatSessionList([
      {
        id: "abc123",
        path: "/tmp/session.jsonl",
        cwd: "/tmp/project",
        name: "Refactor auth",
        parentSessionPath: undefined,
        created: new Date("2026-04-30T10:00:00Z"),
        modified: new Date("2026-04-30T12:30:00Z"),
        messageCount: 8,
        firstMessage: "hello",
        allMessagesText: "hello world",
      },
    ]);

    expect(items[0]).toEqual({
      id: "abc123",
      path: "/tmp/session.jsonl",
      title: "Refactor auth",
      subtitle: "2026-04-30 12:30 • 8 msgs",
    });
  });
});

describe("buildTreePage", () => {
  it("renders documented ASCII tree glyphs with numeric indices", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "message",
          id: "a1",
          parentId: "u1",
          timestamp: "2026-04-30T10:01:00.000Z",
          message: { role: "assistant", content: "Sure" },
        },
        {
          type: "message",
          id: "u2",
          parentId: "a1",
          timestamp: "2026-04-30T10:02:00.000Z",
          message: { role: "user", content: "Try plan B" },
        },
        {
          type: "message",
          id: "u3",
          parentId: "u1",
          timestamp: "2026-04-30T10:03:00.000Z",
          message: { role: "user", content: "Try plan C" },
        },
      ] as any,
      "u3",
      "default",
      0,
      10,
      () => undefined,
    );

    expect(page.text).toContain("├──[2]");
    expect(page.text).toContain("│  └──[3]");
    expect(page.text).toContain("└──[4]");
  });

  it("uses Pi's documented labeled-only filter name", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "message",
          id: "u2",
          parentId: "u1",
          timestamp: "2026-04-30T10:02:00.000Z",
          message: { role: "user", content: "Try plan B" },
        },
      ] as any,
      "u2",
      "labeled-only",
      0,
      10,
      (entryId) => (entryId === "u2" ? "checkpoint" : undefined),
    );

    expect(page.entries.map((entry) => entry.entryId)).toEqual(["u2"]);
    expect(page.text).toContain("checkpoint");
  });

  it("treats default as Pi's documented non-settings tree mode", () => {
    const page = buildTreePage(
      [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-04-30T10:00:00.000Z",
          message: { role: "user", content: "Start here" },
        },
        {
          type: "label",
          id: "l1",
          parentId: "u1",
          timestamp: "2026-04-30T10:01:00.000Z",
          label: "checkpoint",
        },
      ] as any,
      "u1",
      "default",
      0,
      10,
      () => undefined,
    );

    expect(page.entries.map((entry) => entry.entryId)).toEqual(["u1"]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/session-view.test.ts`
Expected: FAIL because `session-view.ts` does not exist yet

- [x] **Step 3: Implement the session-list formatter and ASCII tree renderer**

Create `services/familyos/src/core/session-view.ts`:

```typescript
import type { SessionEntry, SessionInfo } from "@mariozechner/pi-coding-agent";
import type { SessionListItem, TreeFilter, TreePage } from "../types.js";

function formatUtcMinute(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function previewContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String((part as any).text) : "[non-text]"))
      .join(" ");
  }
  return "[unknown]";
}

function entryPreview(entry: SessionEntry, label: string | undefined, activeLeafId: string | null): string {
  const activePrefix = entry.id === activeLeafId ? "→ " : "  ";

  if (entry.type === "message") {
    const preview = previewContent(entry.message.content).replace(/\s+/g, " ").slice(0, 60);
    const suffix = label ? ` [${label}]` : "";
    return `${activePrefix}${entry.message.role}: ${preview}${suffix}`;
  }

  if (entry.type === "compaction") {
    return `${activePrefix}compaction: ${entry.summary.slice(0, 60)}`;
  }

  if (entry.type === "branch_summary") {
    return `${activePrefix}summary: ${entry.summary.slice(0, 60)}`;
  }

  if (entry.type === "session_info") {
    return `${activePrefix}session: ${entry.name ?? "(unnamed)"}`;
  }

  if (entry.type === "label") {
    return `${activePrefix}label: ${entry.label ?? "cleared"}`;
  }

  return `${activePrefix}${entry.type}`;
}

function isSettingsEntry(entry: SessionEntry) {
  return ["label", "custom", "model_change", "thinking_level_change"].includes(entry.type);
}

function isVisible(entry: SessionEntry, filter: TreeFilter, label: string | undefined): boolean {
  switch (filter) {
    case "all":
      return true;
    case "no-tools":
      return !isSettingsEntry(entry) && !(entry.type === "message" && entry.message.role === "toolResult");
    case "user-only":
      return entry.type === "message" && entry.message.role === "user";
    case "labeled-only":
      return Boolean(label);
    case "default":
    default:
      return !isSettingsEntry(entry);
  }
}

function buildTreePrefix(
  pageItems: Array<{ entry: SessionEntry; parentId: string | null; ancestorIds: string[]; depth: number }>,
  index: number,
) {
  const item = pageItems[index]!;
  if (item.depth === 0) return "";

  const parts: string[] = [];
  for (let level = 0; level < item.depth - 1; level += 1) {
    const ancestorId = item.ancestorIds[level]!;
    const hasVisibleContinuation = pageItems
      .slice(index + 1)
      .some((candidate) => candidate.ancestorIds[level] === ancestorId);
    parts.push(hasVisibleContinuation ? "│  " : "   ");
  }

  const hasLaterSibling = pageItems.slice(index + 1).some((candidate) => candidate.parentId === item.parentId);
  parts.push(hasLaterSibling ? "├──" : "└──");
  return parts.join("");
}

export function formatSessionList(sessions: SessionInfo[]): SessionListItem[] {
  return sessions.map((session) => ({
    id: session.id,
    path: session.path,
    title: session.name ?? session.firstMessage.slice(0, 60),
    subtitle: `${formatUtcMinute(session.modified)} • ${session.messageCount} msgs`,
  }));
}

export function buildTreePage(
  entries: SessionEntry[],
  activeLeafId: string | null,
  filter: TreeFilter,
  page: number,
  pageSize: number,
  getLabel: (entryId: string) => string | undefined,
): TreePage {
  const ancestorsById = new Map<string, string[]>();

  const visible = entries
    .map((entry) => {
      const parentAncestors = entry.parentId ? (ancestorsById.get(entry.parentId) ?? []) : [];
      const ancestorIds = entry.parentId ? [...parentAncestors, entry.parentId] : [];
      ancestorsById.set(entry.id, ancestorIds);
      const label = getLabel(entry.id);
      return {
        entry,
        parentId: entry.parentId,
        ancestorIds,
        depth: ancestorIds.length,
        label,
      };
    })
    .filter(({ entry, label }) => isVisible(entry, filter, label));

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = visible.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const numbered = pageItems.map((item, index) => {
    const humanIndex = index + 1;
    const prefix = buildTreePrefix(pageItems, index);
    return {
      index: humanIndex,
      entryId: item.entry.id,
      line: `${prefix}[${humanIndex}] ${entryPreview(item.entry, item.label, activeLeafId)}`,
    };
  });

  return {
    filter,
    page: safePage,
    totalPages,
    text: [
      `Tree filter: ${filter}`,
      `Page ${safePage + 1}/${totalPages}`,
      "",
      ...numbered.map((item) => item.line),
    ].join("\n"),
    entries: numbered,
  };
}
```

- [x] **Step 4: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/session-view.test.ts && npm run typecheck`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add services/familyos/src/core/session-view.ts services/familyos/tests/session-view.test.ts
git commit -m "feat(familyos): add resume and tree view helpers"
```

---

## Review approval

Approved. All 4 tests pass, typecheck clean. Filter names match Pi's documented names verbatim. ASCII tree glyphs, paging, numeric index mapping, active-leaf marker, and label suffix all correct. `entryPreview` content extraction is defensively improved over the plan. Both files committed in `1dc3c59`.

## Implementation notes

- RED: `cd services/familyos && npx vitest run tests/session-view.test.ts` failed first with missing module `../src/core/session-view`.
- GREEN: `cd services/familyos && npx vitest run tests/session-view.test.ts && npm run typecheck` passed.
- Commit: `feat(familyos): add resume and tree view helpers`.
- Follow-up concern: `formatSessionList()` currently falls back to `firstMessage` for unnamed sessions; if empty session previews become possible later, guard for blank titles in the adapter layer.
