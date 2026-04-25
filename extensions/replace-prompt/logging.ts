import fs from "node:fs";
import type { LogEvent } from "./types";

export function appendLog(logPath: string | null, events: LogEvent[]): void {
  if (!logPath || events.length === 0) {
    return;
  }

  const lines = events.map(
    (event) =>
      `${new Date().toISOString()} [${event.level}]${event.ruleId ? ` [${event.ruleId}]` : ""} ${event.message}`,
  );

  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
}
