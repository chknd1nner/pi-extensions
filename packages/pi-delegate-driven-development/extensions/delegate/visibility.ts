import fs from "node:fs";
import path from "node:path";
import type { WorkerStatus } from "./types";

function buildDelegateArtifactPath(
  projectRoot: string,
  date: string,
  sessionId: string,
  taskId: string,
  fileName: string,
): string {
  return path.join(projectRoot, ".pi", "delegate", date, sessionId, fileName.replace("{taskId}", taskId));
}

export class ProgressLogWriter {
  private fd: number | null = null;
  private filePath: string;
  private dirCreated = false;

  constructor(
    projectRoot: string,
    date: string,
    sessionId: string,
    taskId: string,
  ) {
    this.filePath = buildDelegateArtifactPath(
      projectRoot,
      date,
      sessionId,
      taskId,
      "{taskId}.progress.md",
    );
  }

  private ensureDir(): void {
    if (this.dirCreated) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.dirCreated = true;
  }

  private ensureOpen(): void {
    if (this.fd !== null) return;
    this.ensureDir();
    this.fd = fs.openSync(this.filePath, "a");
  }

  appendText(text: string): void {
    this.ensureOpen();
    fs.writeSync(this.fd!, text);
  }

  appendToolCall(toolName: string, args: string): void {
    this.ensureOpen();
    fs.writeSync(this.fd!, `\n[TOOL: ${toolName}] ${args}\n`);
  }

  getFilePath(): string {
    return this.filePath;
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

export class StatusFileWriter {
  private filePath: string;
  private dirCreated = false;
  private disabled = false;

  constructor(
    projectRoot: string,
    date: string,
    sessionId: string,
    taskId: string,
  ) {
    this.filePath = buildDelegateArtifactPath(
      projectRoot,
      date,
      sessionId,
      taskId,
      "{taskId}.status",
    );
  }

  private ensureDir(): void {
    if (this.dirCreated) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.dirCreated = true;
  }

  writeStatus(status: WorkerStatus): void {
    if (this.disabled) return;

    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      this.ensureDir();
      fs.writeFileSync(tempPath, `${status}\n`, "utf8");
      fs.renameSync(tempPath, this.filePath);
    } catch {
      this.disabled = true;
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  getFilePath(): string {
    return this.filePath;
  }
}
