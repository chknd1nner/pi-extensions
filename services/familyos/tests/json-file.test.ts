import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditLog } from "../src/audit-log";
import { readJsonFile, writeJsonAtomic } from "../src/json-file";

describe("writeJsonAtomic", () => {
  it("writes the final file and removes the temp file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-json-"));
    const filePath = path.join(dir, "state.json");

    await writeJsonAtomic(filePath, { activeAgentId: "default" });

    const content = JSON.parse(await fs.readFile(filePath, "utf8"));
    await expect(fs.access(`${filePath}.tmp`)).rejects.toThrow();
    expect(content).toEqual({ activeAgentId: "default" });
  });

  it("returns the fallback when the file does not exist", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-json-"));
    const filePath = path.join(dir, "missing.json");

    const value = await readJsonFile(filePath, { hello: "world" });

    expect(value).toEqual({ hello: "world" });
  });
});

describe("createAuditLog", () => {
  it("appends one JSON object per line", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "familyos-audit-"));
    const logPath = path.join(dir, "audit.jsonl");
    const audit = createAuditLog(logPath);

    audit.append({ type: "test_event", userSlug: "martin" });
    audit.append({ type: "second_event", telegramUserId: "123" });
    await audit.close();

    const lines = (await fs.readFile(logPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe("test_event");
    expect(JSON.parse(lines[1]).type).toBe("second_event");
  });
});
