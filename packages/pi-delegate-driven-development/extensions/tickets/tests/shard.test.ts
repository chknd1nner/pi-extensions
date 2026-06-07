import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shardPlan } from "../index";

let dir: string;

const PLAN = `# Demo Plan

## Overview
Intro.

### Task 1: Alpha thing
Do alpha.
More alpha.

### Task 2: Beta thing
Do beta.
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tickets-shard-"));
  writeFileSync(join(dir, "plan.md"), PLAN);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("shardPlan", () => {
  it("creates one data-only ticket per task with the new frontmatter", () => {
    const result = shardPlan("plan.md", "spec.md", dir);
    expect(result.ticketsCreated).toBe(2);

    const readyDir = join(dir, "in-progress", "ready");
    const files = readdirSync(readyDir).sort();
    expect(files).toEqual(["task-01-alpha-thing.md", "task-02-beta-thing.md"]);

    const t1 = readFileSync(join(readyDir, "task-01-alpha-thing.md"), "utf-8");

    // New data fields present
    expect(t1).toMatch(/^task_number: 1$/m);
    expect(t1).toMatch(/^title: "Alpha thing"$/m);
    expect(t1).toMatch(/^status: ready$/m);
    expect(t1).toMatch(/^plan_path: plan\.md$/m);
    expect(t1).toMatch(/^spec_path: spec\.md$/m);
    expect(t1).toMatch(/^next_prompt: ""$/m);
    expect(t1).toMatch(/^review_failures: 0$/m);
    expect(t1).toMatch(/^task_base_sha: ""$/m);

    // Plan excerpt body preserved
    expect(t1).toContain("## Plan excerpt");
    expect(t1).toContain("Do alpha.");

    // Old worker-driven blobs removed
    expect(t1).not.toContain("review_prompt_template");
    expect(t1).not.toContain("Move ticket to review status");
    expect(t1).not.toContain("TWO-STAGE REVIEW");
  });

  it("omits spec_path when not provided", () => {
    shardPlan("plan.md", undefined, dir);
    const t1 = readFileSync(join(dir, "in-progress", "ready", "task-01-alpha-thing.md"), "utf-8");
    expect(t1).not.toContain("spec_path:");
  });
});
