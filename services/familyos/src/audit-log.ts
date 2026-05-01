import fs from "node:fs";
import path from "node:path";
import type { AuditEvent } from "./types.js";

export interface AuditLog {
  append(event: Omit<AuditEvent, "timestamp"> & Partial<Pick<AuditEvent, "timestamp">>): void;
  close(): Promise<void>;
}

export function createAuditLog(filePath: string): AuditLog {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stream = fs.createWriteStream(filePath, { flags: "a" });

  return {
    append(event) {
      const payload: AuditEvent = {
        timestamp: event.timestamp ?? new Date().toISOString(),
        type: event.type,
        userSlug: event.userSlug,
        telegramUserId: event.telegramUserId,
        sessionFile: event.sessionFile,
        data: event.data,
      };
      stream.write(`${JSON.stringify(payload)}\n`);
    },
    close() {
      return new Promise((resolve, reject) => {
        stream.end((error?: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
