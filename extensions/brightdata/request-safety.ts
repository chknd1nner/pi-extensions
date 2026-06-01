import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain"]);

// Single shared host normalization step. Lowercases, strips surrounding IPv6
// brackets, and strips one or more trailing DNS-root dots. Trailing-dot stripping
// must happen before any LOCAL_HOSTS / .localhost / isIP check so fully-qualified
// forms like `localhost.`, `foo.localhost.`, and the IP literal `127.0.0.1.`
// cannot bypass the private/local checks.
function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
}

function parseIPv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return null;
  return nums;
}

function isPrivateIPv4(hostname: string): boolean {
  const ip = parseIPv4(hostname);
  if (!ip) return false;
  const [a, b] = ip;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isBlockedIPv6(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    // fe80::/10 link-local: first hextet fe80 through febf.
    || /^fe[89ab][0-9a-f]:/.test(normalized)
    || normalized.startsWith("::ffff:");
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (LOCAL_HOSTS.has(normalized) || normalized.endsWith(".localhost")) return true;
  if (isIP(normalized) === 4) return isPrivateIPv4(normalized);
  if (isIP(normalized) === 6) return isBlockedIPv6(normalized);
  return false;
}

export function validatePublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError(`Only public http/https URLs are supported: ${raw}`);
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new UnsafeUrlError(`Refusing private or local URL: ${raw}`);
  }
  return parsed;
}

export function validateBrightDataTarget(raw: string): string {
  return validatePublicHttpUrl(raw).toString();
}

export function resolvePublicRedirectUrl(currentUrl: string, location: string): string {
  return validatePublicHttpUrl(new URL(location, currentUrl).toString()).toString();
}

export async function fetchPublicWithManualRedirects(
  rawUrl: string,
  init: RequestInit = {},
  options: { maxRedirects?: number } = {},
): Promise<Response> {
  let current = validatePublicHttpUrl(rawUrl).toString();
  const maxRedirects = options.maxRedirects ?? 5;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (hop === maxRedirects) throw new Error(`Too many redirects for ${rawUrl}`);
    current = resolvePublicRedirectUrl(current, location);
  }
  throw new Error(`Too many redirects for ${rawUrl}`);
}
