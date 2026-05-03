import fs from "node:fs";
import path from "node:path";

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
    this.filePath = path.join(
      projectRoot, ".pi", "delegate", date, sessionId, `${taskId}.progress.md`,
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
