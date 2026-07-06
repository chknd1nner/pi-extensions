// Pure logic for imsg-server: payload validation, message composition,
// recipient validation, constant-time token comparison.
// Dependency-free: node builtins only (runs on the Air without npm install).
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const LIMITS = { message: 4000, emoji: 16, context: 200 };

export function validatePayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const { message, emoji, context } = body;
  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, error: "message must be a non-empty string" };
  }
  if (message.length > LIMITS.message) {
    return { ok: false, error: `message exceeds ${LIMITS.message} chars` };
  }
  const value = { message };
  if (emoji !== undefined) {
    if (typeof emoji !== "string" || emoji.length === 0 || emoji.length > LIMITS.emoji) {
      return { ok: false, error: `emoji must be a string of 1-${LIMITS.emoji} chars` };
    }
    value.emoji = emoji;
  }
  if (context !== undefined) {
    if (typeof context !== "string" || context.length > LIMITS.context) {
      return { ok: false, error: `context must be a string of at most ${LIMITS.context} chars` };
    }
    value.context = context;
  }
  return { ok: true, value };
}

/**
 * @param {{ message: string, emoji?: string, context?: string }} payload
 */
export function composeText({ message, emoji, context }) {
  const line1 = emoji ? `${emoji} ${message}` : message;
  return context ? `${line1}\n[${context}]` : line1;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateRecipient(recipient) {
  if (typeof recipient !== "string" || recipient.length === 0) return false;
  if (EMAIL_RE.test(recipient)) return true;
  const digits = recipient.replace(/[\s()-]/g, "");
  return /^\+?\d{5,15}$/.test(digits);
}

export function tokenMatches(authorizationHeader, token) {
  if (typeof authorizationHeader !== "string") return false;
  if (!authorizationHeader.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(token);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export function loadServerConfig(configPath) {
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`config not found at ${configPath} — run setup.sh configure`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${configPath}`);
  }
  const { token, recipient, host } = parsed;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`config missing "token" (${configPath})`);
  }
  if (typeof recipient !== "string" || !validateRecipient(recipient)) {
    throw new Error(`config "recipient" missing or not phone/email-like (${configPath})`);
  }
  if (typeof host !== "string" || host.length === 0) {
    throw new Error(`config missing "host" — bind address is required, never defaults to 0.0.0.0 (${configPath})`);
  }
  const port = parsed.port ?? 8787;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`config "port" must be an integer 1-65535 (${configPath})`);
  }
  return { token, recipient, host, port };
}
