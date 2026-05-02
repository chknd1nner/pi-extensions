/**
 * Ticket Management Extension for π
 *
 * Provides tools for sharding implementation plans into tickets
 * and managing ticket workflow operations.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// --- Configuration ---
const TICKETS_DIR = "in-progress";
const LANES = ["ready", "active", "review", "needs-fix", "blocked", "done"] as const;
type Lane = (typeof LANES)[number];

const LANE_STATUS: Record<Lane, string> = {
  ready: "Ready",
  active: "Active",
  review: "In Review",
  "needs-fix": "Needs Fix",
  blocked: "Blocked",
  done: "Done",
};

// --- Helper Functions ---

function mdedit(args: string[], cwd: string): string {
  const result = spawnSync("mdedit", args, { cwd, encoding: "utf-8" });
  if (result.error) throw new Error(`mdedit error: ${result.error.message}`);
  return result.stdout || "";
}

function findTicket(pattern: string, cwd: string): string | null {
  const ticketsDir = join(cwd, TICKETS_DIR);
  const matches: string[] = [];

  for (const lane of LANES) {
    const laneDir = join(ticketsDir, lane);
    if (!existsSync(laneDir)) continue;

    const files = readdirSync(laneDir).filter((f) => f.endsWith(".md") && f.includes(pattern));
    for (const file of files) {
      matches.push(join(laneDir, file));
    }
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Multiple tickets match '${pattern}':\n  ${matches.join("\n  ")}`);
  }
  return matches[0];
}

function getLaneFromPath(filepath: string): Lane | null {
  for (const lane of LANES) {
    if (filepath.includes(`/${lane}/`)) return lane;
  }
  return null;
}

function ensureLaneDir(lane: Lane, cwd: string): string {
  const dir = join(cwd, TICKETS_DIR, lane);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function listTicketsInLane(lane: Lane, cwd: string): Array<{ file: string; title: string }> {
  const laneDir = join(cwd, TICKETS_DIR, lane);
  if (!existsSync(laneDir)) return [];

  const files = readdirSync(laneDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  return files.map((file) => {
    const filepath = join(laneDir, file);
    let title = "(no title)";
    try {
      const output = mdedit(["frontmatter", "get", filepath, "title"], cwd);
      const match = output.match(/title:\s*"?(.+?)"?\s*$/m);
      if (match) title = match[1];
    } catch {
      // ignore
    }
    return { file: basename(file, ".md"), title };
  });
}

// --- Tool Implementations ---

interface ShardResult {
  ticketsCreated: number;
  tickets: Array<{ number: number; title: string; filename: string }>;
  outputDir: string;
}

function shardPlan(planPath: string, specPath: string | undefined, cwd: string): ShardResult {
  const fullPlanPath = join(cwd, planPath);
  if (!existsSync(fullPlanPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  // Get outline to find task sections
  const outline = mdedit(["outline", fullPlanPath], cwd);
  const taskLines = outline.split("\n").filter((line) => /###\s+Task\s+\d+:/.test(line));

  if (taskLines.length === 0) {
    throw new Error("No '### Task N:' sections found in plan");
  }

  const readyDir = ensureLaneDir("ready", cwd);
  const tickets: ShardResult["tickets"] = [];

  for (const taskLine of taskLines) {
    // Parse: "    ### Task 7: Title here — 944 words (lines 2348–2667)"
    const headingMatch = taskLine.match(/###\s+(Task\s+\d+:\s*.+?)\s+—\s+\d+\s+words/);
    if (!headingMatch) continue;

    const heading = headingMatch[1];
    const numMatch = heading.match(/^Task\s+(\d+):/);
    if (!numMatch) continue;

    const taskNum = parseInt(numMatch[1], 10);
    const title = heading.replace(/^Task\s+\d+:\s*/, "").trim();
    const taskNumPadded = taskNum.toString().padStart(2, "0");

    // Create slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const filename = `task-${taskNumPadded}-${slug}.md`;
    const filepath = join(readyDir, filename);

    // Extract task content using mdedit or fallback to sed
    let taskContent = "";
    try {
      const extracted = mdedit(["extract", fullPlanPath, heading], cwd);
      // Skip the heading line itself
      taskContent = extracted.split("\n").slice(1).join("\n");
    } catch {
      // mdedit may fail on headings with special chars - use line numbers
    }

    // Fallback: extract using line numbers from outline
    if (!taskContent.trim()) {
      const lineMatch = taskLine.match(/lines\s+(\d+)[–-](\d+)/);
      if (lineMatch) {
        const startLine = parseInt(lineMatch[1], 10) + 1;
        const endLine = parseInt(lineMatch[2], 10);
        const result = spawnSync("sed", ["-n", `${startLine},${endLine}p`, fullPlanPath], {
          cwd,
          encoding: "utf-8",
        });
        taskContent = result.stdout || "";
      }
    }

    if (!taskContent.trim()) {
      continue; // Skip if we couldn't extract content
    }

    // Build prompts
    const implPrompt = `Implement Task ${taskNum}: ${title}

Read the Plan excerpt section below and execute each step in order.
Check off steps as you complete them (- [x]).
Run verification commands and confirm they pass.
Commit when all steps are complete.

When done:
- Move ticket to in-progress/review/
- Set status to In Review, lane to review
- Update next_prompt to the review_prompt_template value
- The reviewer will perform spec + code review`;

    const reviewPrompt = `Review Task ${taskNum}: ${title}

Perform a TWO-STAGE REVIEW:

## Stage 1: Spec Review
Compare implementation against the design spec.
- Read the spec_path document (if provided)
- Check: Does implementation match spec intent?
- Check: Any divergences from spec requirements?
- Check: Missing spec requirements?

If MAJOR spec issues found, you may terminate review early.
If minor spec divergences, note them and continue to Stage 2.

## Stage 2: Code Review
Use the superpowers:requesting-code-review skill approach.
- Get git diff for this task's changes
- Check code quality, architecture, testing
- Categorize issues: Critical / Important / Minor

## Review Output

### Spec Compliance
[Matches spec / Minor divergences / Major divergences]
[List any divergences with spec section references]

### Code Quality
[Strengths and issues per code-reviewer format]

### Verdict
If task passes BOTH stages:
- Move ticket to in-progress/done/
- Set status to Done, lane to done
- Add approval_note with verification evidence

If task needs changes:
- Move ticket to in-progress/needs-fix/
- Set status to Needs Fix, lane to needs-fix
- Update next_prompt with specific fix instructions
- Record findings in ## Notes section`;

    // Build frontmatter
    const specField = specPath ? `spec_path: ${specPath}\n` : "";
    const implPromptIndented = implPrompt
      .split("\n")
      .map((l) => "  " + l)
      .join("\n");
    const reviewPromptIndented = reviewPrompt
      .split("\n")
      .map((l) => "  " + l)
      .join("\n");

    const content = `---
task_number: ${taskNum}
title: "${title}"
status: Ready
lane: ready
plan_path: ${planPath}
${specField}next_prompt: |-
${implPromptIndented}
review_prompt_template: |-
${reviewPromptIndented}
---

# Task ${taskNumPadded} — ${title}

## Plan excerpt

${taskContent}

---

## Notes

<!-- Verification results, issues, and runtime notes go here -->
`;

    writeFileSync(filepath, content);
    tickets.push({ number: taskNum, title, filename });
  }

  return {
    ticketsCreated: tickets.length,
    tickets,
    outputDir: `${TICKETS_DIR}/ready`,
  };
}

interface ListResult {
  lanes: Array<{
    lane: Lane;
    count: number;
    tickets: Array<{ file: string; title: string }>;
  }>;
}

function listTickets(filterLane: Lane | undefined, cwd: string): ListResult {
  const lanes = filterLane ? [filterLane] : LANES;
  const result: ListResult = { lanes: [] };

  for (const lane of lanes) {
    const tickets = listTicketsInLane(lane as Lane, cwd);
    result.lanes.push({
      lane: lane as Lane,
      count: tickets.length,
      tickets,
    });
  }

  return result;
}

interface ShowResult {
  file: string;
  frontmatter: Record<string, unknown>;
  outline: string;
}

function showTicket(pattern: string, cwd: string): ShowResult {
  const filepath = findTicket(pattern, cwd);
  if (!filepath) throw new Error(`No ticket found matching '${pattern}'`);

  // Get frontmatter
  const fmOutput = mdedit(["frontmatter", "show", filepath], cwd);
  const frontmatter: Record<string, unknown> = {};

  // Parse frontmatter output (simple key: value parsing)
  const fmLines = fmOutput.split("\n");
  let currentKey = "";
  let currentValue = "";

  for (const line of fmLines) {
    const keyMatch = line.match(/^\s{2}(\w+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey) {
        frontmatter[currentKey] = currentValue.trim();
      }
      currentKey = keyMatch[1];
      currentValue = keyMatch[2];
    } else if (currentKey && line.startsWith("  ")) {
      currentValue += "\n" + line.trim();
    }
  }
  if (currentKey) {
    frontmatter[currentKey] = currentValue.trim();
  }

  // Get outline
  const outline = mdedit(["outline", filepath], cwd);

  return {
    file: basename(filepath),
    frontmatter,
    outline,
  };
}

interface MoveResult {
  file: string;
  fromLane: Lane;
  toLane: Lane;
  newPath: string;
}

function moveTicket(pattern: string, targetLane: Lane, cwd: string): MoveResult {
  if (!LANES.includes(targetLane)) {
    throw new Error(`Invalid lane '${targetLane}'. Valid lanes: ${LANES.join(", ")}`);
  }

  const filepath = findTicket(pattern, cwd);
  if (!filepath) throw new Error(`No ticket found matching '${pattern}'`);

  const fromLane = getLaneFromPath(filepath);
  if (!fromLane) throw new Error(`Could not determine current lane for ${filepath}`);

  const status = LANE_STATUS[targetLane];

  // Update frontmatter
  mdedit(["frontmatter", "set", filepath, "status", status], cwd);
  mdedit(["frontmatter", "set", filepath, "lane", targetLane], cwd);

  // Move file
  const targetDir = ensureLaneDir(targetLane, cwd);
  const filename = basename(filepath);
  const newPath = join(targetDir, filename);

  if (filepath !== newPath) {
    renameSync(filepath, newPath);
  }

  return {
    file: filename,
    fromLane,
    toLane: targetLane,
    newPath: join(TICKETS_DIR, targetLane, filename),
  };
}

interface SetResult {
  file: string;
  field: string;
  value: string;
}

function setTicketField(pattern: string, field: string, value: string, cwd: string): SetResult {
  const filepath = findTicket(pattern, cwd);
  if (!filepath) throw new Error(`No ticket found matching '${pattern}'`);

  mdedit(["frontmatter", "set", filepath, field, value], cwd);

  return {
    file: basename(filepath),
    field,
    value,
  };
}

interface NextPromptResult {
  file: string;
  next_prompt: string;
}

function getNextPrompt(pattern: string, cwd: string): NextPromptResult {
  const filepath = findTicket(pattern, cwd);
  if (!filepath) throw new Error(`No ticket found matching '${pattern}'`);

  const output = mdedit(["frontmatter", "get", filepath, "next_prompt"], cwd);
  // Skip the "next_prompt:" header line
  const lines = output.split("\n");
  const promptLines = lines.slice(1);

  return {
    file: basename(filepath),
    next_prompt: promptLines.join("\n").trim(),
  };
}

// --- Extension Export ---

export default function ticketsExtension(pi: ExtensionAPI) {
  // Tool: ticket_shard
  pi.registerTool({
    name: "ticket_shard",
    label: "Shard Plan",
    description:
      "Shard an implementation plan into individual ticket files. Parses '### Task N:' sections from the plan and creates one ticket per task in in-progress/ready/. Each ticket includes the plan excerpt, implementation prompt, and two-stage review prompt template.",
    promptSnippet:
      "Use to convert an implementation plan into executable tickets. Requires a plan with '### Task N: Title' sections.",
    parameters: Type.Object({
      plan_path: Type.String({ description: "Path to the implementation plan markdown file" }),
      spec_path: Type.Optional(
        Type.String({ description: "Path to the design spec document (for spec review stage)" })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        const result = shardPlan(params.plan_path, params.spec_path, cwd);
        const ticketList = result.tickets
          .map((t) => `  Task ${t.number}: ${t.title}\n    → ${result.outputDir}/${t.filename}`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `✓ Sharded plan into ${result.ticketsCreated} tickets\n\n${ticketList}\n\nNext: Move first ticket to active with ticket_move`,
            },
          ],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        };
      }
    },
  });

  // Tool: ticket_list
  pi.registerTool({
    name: "ticket_list",
    label: "List Tickets",
    description:
      "List tickets by workflow lane. Shows ticket counts and titles for each lane (ready, active, review, needs-fix, blocked, done).",
    promptSnippet: "Use to see current ticket status across all workflow lanes.",
    parameters: Type.Object({
      lane: Type.Optional(
        Type.Union(LANES.map((l) => Type.Literal(l)), {
          description: "Filter to specific lane (default: show all)",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        const result = listTickets(params.lane as Lane | undefined, cwd);

        const output = result.lanes
          .map((l) => {
            const header = `═══ ${l.lane} (${l.count}) ═══`;
            if (l.count === 0) return header;
            const tickets = l.tickets.map((t) => `  ${t.file}: ${t.title}`).join("\n");
            return `${header}\n${tickets}`;
          })
          .join("\n\n");

        return {
          content: [{ type: "text", text: `📋 Tickets by lane\n\n${output}` }],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        };
      }
    },
  });

  // Tool: ticket_show
  pi.registerTool({
    name: "ticket_show",
    label: "Show Ticket",
    description:
      "Show detailed information about a ticket including frontmatter fields and document outline.",
    promptSnippet: "Use to inspect a ticket's metadata, status, and structure.",
    parameters: Type.Object({
      ticket: Type.String({
        description: "Ticket identifier (filename or partial match, e.g. 'task-01' or '01')",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        const result = showTicket(params.ticket, cwd);

        const fmLines = Object.entries(result.frontmatter)
          .map(([k, v]) => {
            const val = typeof v === "string" && v.includes("\n") ? "(multiline)" : v;
            return `  ${k}: ${val}`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `📄 ${result.file}\n\nFrontmatter:\n${fmLines}\n\nOutline:\n${result.outline}`,
            },
          ],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        };
      }
    },
  });

  // Tool: ticket_move
  pi.registerTool({
    name: "ticket_move",
    label: "Move Ticket",
    description:
      "Move a ticket to a different workflow lane. Automatically updates status and lane frontmatter fields and moves the file to the corresponding directory.",
    promptSnippet:
      "Use to progress tickets through workflow: ready → active → review → done (or needs-fix/blocked).",
    parameters: Type.Object({
      ticket: Type.String({
        description: "Ticket identifier (filename or partial match)",
      }),
      lane: Type.Union(LANES.map((l) => Type.Literal(l)), {
        description: "Target lane to move ticket to",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        const result = moveTicket(params.ticket, params.lane as Lane, cwd);

        return {
          content: [
            {
              type: "text",
              text: `✓ Moved ${result.file}\n  ${result.fromLane} → ${result.toLane}\n  → ${result.newPath}`,
            },
          ],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        };
      }
    },
  });

  // Tool: ticket_set
  pi.registerTool({
    name: "ticket_set",
    label: "Set Ticket Field",
    description: "Set a frontmatter field on a ticket. Common fields: next_prompt, status, lane.",
    promptSnippet: "Use to update ticket metadata, especially next_prompt for workflow handoffs.",
    parameters: Type.Object({
      ticket: Type.String({
        description: "Ticket identifier (filename or partial match)",
      }),
      field: Type.String({
        description: "Frontmatter field name to set",
      }),
      value: Type.String({
        description: "Value to set for the field",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        const result = setTicketField(params.ticket, params.field, params.value, cwd);

        return {
          content: [
            {
              type: "text",
              text: `✓ Set ${result.field} on ${result.file}`,
            },
          ],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        };
      }
    },
  });

  // Tool: ticket_next
  pi.registerTool({
    name: "ticket_next",
    label: "Get Next Prompt",
    description:
      "Get the next_prompt field from a ticket. This contains the instructions for the next agent working on the ticket.",
    promptSnippet:
      "Use to retrieve handoff instructions from a ticket before starting work or review.",
    parameters: Type.Object({
      ticket: Type.String({
        description: "Ticket identifier (filename or partial match)",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        const result = getNextPrompt(params.ticket, cwd);

        return {
          content: [
            {
              type: "text",
              text: `📋 Next prompt for ${result.file}:\n\n---\n${result.next_prompt}\n---`,
            },
          ],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        };
      }
    },
  });
}
