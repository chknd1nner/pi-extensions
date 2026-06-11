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
