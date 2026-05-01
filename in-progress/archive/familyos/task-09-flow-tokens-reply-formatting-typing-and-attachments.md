---
task_number: 9
title: Add flow tokens, Telegram reply formatting, typing indicators, and attachment persistence
status: Done
lane: done
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are reviewing Task 9 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket, the current git diff, and the spec divergence notes in this ticket.
  Review only the scope in this ticket plan excerpt plus the documented divergence.
  Perform both a spec review and a code review.

  If the task passes review:
  - move this ticket to `in-progress/done/`
  - set status to `Done`
  - set lane to `done`
  - add a short approval note with fresh verification evidence

  If the task needs changes:
  - move this ticket to `in-progress/to-fix/`
  - set status to `To fix`
  - set lane to `to-fix`
  - replace `next_prompt` with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
review_prompt_template: |-
  You are reviewing Task 9 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket, the current git diff, and the spec divergence notes in this ticket.
  Review only the scope in this ticket plan excerpt plus the documented divergence.
  Perform both a spec review and a code review.

  If the task passes review:
  - move this ticket to `in-progress/done/`
  - set status to `Done`
  - set lane to `done`
  - add a short approval note with fresh verification evidence

  If the task needs changes:
  - move this ticket to `in-progress/to-fix/`
  - set status to `To fix`
  - set lane to `to-fix`
  - replace `next_prompt` with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
---

# Task 09 — Add flow tokens, Telegram reply formatting, typing indicators, and attachment persistence

## Plan excerpt


**Files:**
- Create: `services/familyos/src/flow-store.ts`
- Create: `services/familyos/src/reply-format.ts`
- Create: `services/familyos/src/typing-indicator.ts`
- Create: `services/familyos/src/attachments/classify.ts`
- Create: `services/familyos/src/attachments/store.ts`
- Create: `services/familyos/tests/flow-store.test.ts`
- Create: `services/familyos/tests/reply-format.test.ts`
- Create: `services/familyos/tests/typing-indicator.test.ts`
- Create: `services/familyos/tests/attachments.test.ts`

- [x] **Step 1: Write the failing utility tests**

Create `services/familyos/tests/flow-store.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { FlowStore } from "../src/flow-store";

describe("FlowStore", () => {
  it("returns undefined after expiry", async () => {
    const store = new FlowStore<{ kind: string }>(10);
    const token = store.create({ kind: "resume" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.get(token)).toBeUndefined();
  });
});
```

Create `services/familyos/tests/reply-format.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatReplyForTelegram } from "../src/reply-format";

describe("formatReplyForTelegram", () => {
  it("keeps fenced code blocks intact across split messages", () => {
    const text = `Before\n\n\`\`\`ts\n${"line\n".repeat(1000)}\`\`\`\n\nAfter`;
    const chunks = formatReplyForTelegram(text, 1000);

    expect(chunks.some((chunk) => chunk.includes("<pre><code>"))).toBe(true);
    expect(chunks.every((chunk) => !chunk.includes("```"))).toBe(true);
  });
});
```

Create `services/familyos/tests/typing-indicator.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { TypingIndicatorLoop } from "../src/typing-indicator";

describe("TypingIndicatorLoop", () => {
  it("starts once per key and stops cleanly", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const loop = new TypingIndicatorLoop(4000);

    loop.start("martin", send);
    loop.start("martin", send);
    await vi.advanceTimersByTimeAsync(4100);
    loop.stop("martin");
    await vi.advanceTimersByTimeAsync(4100);

    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

Create `services/familyos/tests/attachments.test.ts`:

```typescript
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { classifyTelegramMedia } from "../src/attachments/classify";
import { persistAttachments } from "../src/attachments/store";
import { buildFamilyOSPaths, resolveUserPaths } from "../src/paths";
import { createTempRoot } from "./helpers/temp-root";

describe("classifyTelegramMedia", () => {
  it("classifies photos as images and voice notes as unsupported", () => {
    expect(classifyTelegramMedia({ photo: [{ file_id: "file-1" }], caption: "pic" }).attachments[0]?.kind).toBe("image");
    expect(classifyTelegramMedia({ voice: { file_id: "voice-1" } }).unsupportedMessage).toContain("unsupported");
  });
});

describe("persistAttachments", () => {
  it("saves images in Inbox and returns inline image payloads", async () => {
    const temp = await createTempRoot();
    const paths = buildFamilyOSPaths(temp.rootDir, {
      defaultAgentId: "default",
      sharedPiAgentDir: ".familyos-pi",
      telegram: { flowTtlSeconds: 900, typingIntervalMs: 4000, pageSize: 8 },
    });
    const user = resolveUserPaths(paths, { id: "martin", displayName: "Martin" });

    await fs.mkdir(user.inboxDir, { recursive: true });

    const saved = await persistAttachments(
      user,
      [{ kind: "image", fileId: "file-1", fileName: "photo.jpg", mimeType: "image/jpeg" }],
      {
        download: async () => ({
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("fake-image"),
        }),
      },
    );

    expect(saved[0]?.relativePath.startsWith("Inbox/")).toBe(true);
    expect(saved[0]?.inlineImage?.type).toBe("image");
    await temp.cleanup();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts`
Expected: FAIL because the utility files do not exist yet

- [x] **Step 3: Implement flow tokens and typing loops**

Create `services/familyos/src/flow-store.ts`:

```typescript
import crypto from "node:crypto";

interface StoredFlow<T> {
  expiresAt: number;
  value: T;
}

export class FlowStore<T> {
  private readonly values = new Map<string, StoredFlow<T>>();

  constructor(private readonly ttlMs: number) {}

  create(value: T) {
    const token = crypto.randomBytes(12).toString("base64url");
    this.values.set(token, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return token;
  }

  get(token: string) {
    const record = this.values.get(token);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      this.values.delete(token);
      return undefined;
    }
    return record.value;
  }

  update(token: string, nextValue: T) {
    const record = this.get(token);
    if (!record) return false;
    this.values.set(token, {
      value: nextValue,
      expiresAt: Date.now() + this.ttlMs,
    });
    return true;
  }
}
```

Create `services/familyos/src/typing-indicator.ts`:

```typescript
export class TypingIndicatorLoop {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly intervalMs: number) {}

  start(key: string, sendTyping: () => Promise<void>) {
    if (this.timers.has(key)) return;

    void sendTyping();
    const timer = setInterval(() => {
      void sendTyping();
    }, this.intervalMs);
    this.timers.set(key, timer);
  }

  stop(key: string) {
    const timer = this.timers.get(key);
    if (!timer) return;
    clearInterval(timer);
    this.timers.delete(key);
  }
}
```

- [x] **Step 4: Implement Telegram-safe reply formatting**

Create `services/familyos/src/reply-format.ts`:

```typescript
function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function tokenizeMarkdown(text: string) {
  return text.split(/(```(?:[a-zA-Z0-9_-]+)?\n[\s\S]*?```)/g).filter(Boolean);
}

function renderToken(token: string) {
  const match = token.match(/^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```$/);
  if (match) {
    return `<pre><code>${escapeHtml(match[1]!.trimEnd())}</code></pre>`;
  }
  return escapeHtml(token);
}

export function formatReplyForTelegram(text: string, maxLength = 4096): string[] {
  const blocks = tokenizeMarkdown(text).map(renderToken);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    if (current.length + block.length <= maxLength) {
      current += block;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (block.length <= maxLength) {
      current = block;
      continue;
    }

    const lines = block.split("\n");
    let partial = "";
    for (const line of lines) {
      const next = partial ? `${partial}\n${line}` : line;
      if (next.length > maxLength) {
        chunks.push(partial);
        partial = line;
      } else {
        partial = next;
      }
    }
    current = partial;
  }

  if (current) chunks.push(current);
  return chunks.map((chunk) => chunk || "Done.");
}
```

- [x] **Step 5: Implement media classification and Inbox persistence**

Create `services/familyos/src/attachments/classify.ts`:

```typescript
import type { PendingAttachment } from "../types.js";

export function classifyTelegramMedia(message: Record<string, any>): {
  attachments: PendingAttachment[];
  unsupportedMessage?: string;
  text: string;
} {
  const text = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo.at(-1)!;
    return {
      text,
      attachments: [
        {
          kind: "image",
          fileId: largest.file_id,
          fileName: `photo-${largest.file_id}.jpg`,
          mimeType: "image/jpeg",
        },
      ],
    };
  }

  if (message.document?.file_id) {
    return {
      text,
      attachments: [
        {
          kind: "document",
          fileId: message.document.file_id,
          fileName: message.document.file_name ?? `document-${message.document.file_id}`,
          mimeType: message.document.mime_type,
        },
      ],
    };
  }

  if (message.voice || message.video || message.sticker || message.animation) {
    return {
      text,
      attachments: [],
      unsupportedMessage: "That media type is not supported in FamilyOS MVP yet.",
    };
  }

  return {
    text,
    attachments: [],
  };
}
```

Create `services/familyos/src/attachments/store.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { PersistedAttachment, PendingAttachment, ResolvedUser } from "../types.js";

export interface AttachmentDownloader {
  download(fileId: string): Promise<{
    fileName: string;
    mimeType?: string;
    buffer: Buffer;
  }>;
}

function safeName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function persistAttachments(
  user: ResolvedUser,
  attachments: PendingAttachment[],
  downloader: AttachmentDownloader,
): Promise<PersistedAttachment[]> {
  const saved: PersistedAttachment[] = [];

  await fs.mkdir(user.inboxDir, { recursive: true });

  for (const attachment of attachments) {
    const downloaded = await downloader.download(attachment.fileId);
    const stampedName = `${Date.now()}-${safeName(downloaded.fileName)}`;
    const absolutePath = path.join(user.inboxDir, stampedName);
    await fs.writeFile(absolutePath, downloaded.buffer);

    saved.push({
      kind: attachment.kind,
      absolutePath,
      relativePath: path.posix.join("Inbox", stampedName),
      inlineImage:
        attachment.kind === "image"
          ? {
              type: "image",
              source: {
                type: "base64",
                mediaType: downloaded.mimeType ?? "image/jpeg",
                data: downloaded.buffer.toString("base64"),
              },
            }
          : undefined,
    });
  }

  return saved;
}
```

- [x] **Step 6: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts && npm run typecheck`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add services/familyos/src/flow-store.ts services/familyos/src/reply-format.ts services/familyos/src/typing-indicator.ts services/familyos/src/attachments/classify.ts services/familyos/src/attachments/store.ts services/familyos/tests/flow-store.test.ts services/familyos/tests/reply-format.test.ts services/familyos/tests/typing-indicator.test.ts services/familyos/tests/attachments.test.ts
git commit -m "feat(familyos): add telegram utility layer"
```

---

## Prior review approval (superseded by final spec review)

**Approved.** All 5 tests pass (`flow-store`, `reply-format`, `typing-indicator`, `attachments` × 2). Typecheck clean. Implementation matches the plan exactly:
- `FlowStore`: TTL-based token map, correct `create`/`get`/`update` semantics, expiry-on-read ✓
- `TypingIndicatorLoop`: idempotent start per key, immediate first send, interval repeats, clean `stop` ✓
- `formatReplyForTelegram`: fenced code → `<pre><code>`, HTML escaping, safe line-boundary splitting, 4096-char default ✓
- `classifyTelegramMedia`: photo/document classified correctly, voice/video/sticker/animation → `unsupportedMessage` containing 

- RED evidence: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts` failed first with missing modules (`flow-store`, `reply-format`, `typing-indicator`, and `attachments/*`).
- GREEN evidence: after adding the utility modules, the same targeted Vitest command passed (`5` tests passed).
- Verification evidence: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts && npm run typecheck` passed cleanly.
- Follow-up concern: the plan excerpt's `inlineImage` shape in `attachments/store.ts` used a nested `source` object, but current `@mariozechner/pi-ai` `ImageContent` typing expects `{ type, data, mimeType }`; implementation follows the installed SDK type so typecheck stays strict.

## Final spec divergence

This ticket was moved back to `in-progress/to-fix/` after the final spec-alignment review.

Divergence from spec:
- The spec requires reply splitting to never cut through a code block and to preserve code blocks across split Telegram messages.
- `services/familyos/src/reply-format.ts` currently splits rendered `<pre><code>...</code></pre>` HTML across chunks when a single code block exceeds the message limit, producing unmatched wrappers across messages.

Fresh verification evidence:
- A direct formatting spot check with `maxLength = 120` produced one chunk containing `<pre><code>` without a matching `</code></pre>` and a later chunk containing the closing tags.

Fix direction for this task:
- rework `formatReplyForTelegram` so oversized code blocks are split into independently wrapped valid code-block chunks
- add regression tests that verify no chunk contains unmatched code-block wrappers and each chunk stays within the Telegram limit

## Fix implementation notes (2026-05-01)

Implemented:
- updated `services/familyos/src/reply-format.ts` with block-aware splitting:
  - oversized rendered code blocks (`<pre><code>...</code></pre>`) are now split by body content and each split part is re-wrapped with matching opening/closing code-block tags
  - non-code blocks still split by line boundaries with long-line fallback
  - chunk assembly now iterates split parts so no emitted chunk exceeds the configured limit
- expanded `services/familyos/tests/reply-format.test.ts` regression coverage:
  - asserts every chunk has balanced `<pre><code>` / `</code></pre>` wrappers
  - asserts every chunk length is `<= maxLength`
  - adds a dedicated oversized-single-code-block case requiring multi-chunk output

Fresh verification evidence:
- RED: `cd services/familyos && npx vitest run tests/reply-format.test.ts`
  - before the fix, failed with `2` assertions on balanced code-block wrappers
- GREEN: `cd services/familyos && npx vitest run tests/reply-format.test.ts`
  - after the fix, passed (`2` tests)
- Verification sweep: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts && npm run typecheck`
  - passed (`4` files / `6` tests) and `tsc --noEmit` completed cleanly

## Review approval

Approved. Reviewed the current diff in `services/familyos/src/reply-format.ts` and `services/familyos/tests/reply-format.test.ts` against the Task 09 scope plus the recorded spec divergence.

Spec review:
- oversized code blocks are now split into independently wrapped `<pre><code>...</code></pre>` chunks
- emitted chunks stay within the configured Telegram limit
- the regression coverage now checks the exact failure mode that sent the ticket back

Code review:
- the fix is localized to block splitting and keeps the existing markdown-tokenization/rendering flow intact
- code and non-code paths both reuse the same newline-aware splitting helper, with a bounded fallback for long lines
- no new blocking issues were identified in this task scope

Fresh verification evidence:
- `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts` → passed (`6` tests)
- `cd services/familyos && npm run typecheck` → passed cleanly
- `cd services/familyos && npm test` → passed cleanly (`57` tests across the service)
