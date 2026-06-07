import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import ticketsExtension, { shardPlan, getTicketField, setTicketField } from "../index";

let dir: string;

const PLAN = `# P

### Task 1: Alpha thing
Body.
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tickets-get-"));
  writeFileSync(join(dir, "plan.md"), PLAN);
  shardPlan("plan.md", undefined, dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getTicketField", () => {
  it("reads the default scalar fields", () => {
    expect(getTicketField("task-01", "review_failures", dir).value).toBe("0");
    expect(getTicketField("task-01", "task_base_sha", dir).value).toBe("");
    expect(getTicketField("task-01", "title", dir).value).toBe("Alpha thing");
  });

  it("round-trips a value written by setTicketField", () => {
    setTicketField("task-01", "task_base_sha", "abc1234", dir);
    expect(getTicketField("task-01", "task_base_sha", dir).value).toBe("abc1234");

    setTicketField("task-01", "review_failures", "2", dir);
    expect(getTicketField("task-01", "review_failures", dir).value).toBe("2");
  });
});

describe("ticket_get registration", () => {
  it("registers a ticket_get tool", () => {
    const names: string[] = [];
    const fakePi = {
      registerTool: (def: { name: string }) => names.push(def.name),
    } as unknown as ExtensionAPI;

    ticketsExtension(fakePi);
    expect(names).toContain("ticket_get");
  });
});
