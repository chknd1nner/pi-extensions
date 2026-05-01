---
task_number: 9
title: Add flow tokens, Telegram reply formatting, typing indicators, and attachment persistence
status: Ready for implementation
lane: ready
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are implementing Task 9 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket:
  - Ticket: in-progress/ready/task-09-flow-tokens-reply-formatting-typing-and-attachments.md
  - Plan: docs/superpowers/plans/2026-04-30-familyos-telegram.md
  - Spec: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md

  Work only on this task. Follow the plan excerpt in this ticket exactly.
  When implementation and verification are complete:
  - move this ticket to in-progress/review/
  - set status to Ready for review
  - set lane to review
  - replace next_prompt with the review prompt template from this ticket or an updated equivalent
  - add brief notes about verification and any follow-up concerns
review_prompt_template: |-
  You are reviewing Task 9 from the FamilyOS Telegram MVP implementation plan.

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

- [ ] **Step 1: Write the failing utility tests**

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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts`
Expected: FAIL because the utility files do not exist yet

- [ ] **Step 3: Implement flow tokens and typing loops**

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

- [ ] **Step 4: Implement Telegram-safe reply formatting**

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

- [ ] **Step 5: Implement media classification and Inbox persistence**

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

- [ ] **Step 6: Run tests and typecheck**

Run: `cd services/familyos && npx vitest run tests/flow-store.test.ts tests/reply-format.test.ts tests/typing-indicator.test.ts tests/attachments.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/familyos/src/flow-store.ts services/familyos/src/reply-format.ts services/familyos/src/typing-indicator.ts services/familyos/src/attachments/classify.ts services/familyos/src/attachments/store.ts services/familyos/tests/flow-store.test.ts services/familyos/tests/reply-format.test.ts services/familyos/tests/typing-indicator.test.ts services/familyos/tests/attachments.test.ts
git commit -m "feat(familyos): add telegram utility layer"
```

---
