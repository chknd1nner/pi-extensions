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
