import { getBrightDataApiKey, loadBrightDataConfig } from "./config.js";
import { validateBrightDataTarget } from "./request-safety.js";

export interface BrightDataPayload {
  zone: string;
  url: string;
  format: "raw" | "json";
  country?: string;
  data_format?: "markdown";
  method?: "GET" | "POST";
  body?: string;
}

export interface BrightDataResult {
  status: number;
  headers: Headers;
  text: string;
  json: unknown | null;
  bytes: ArrayBuffer;
}

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

function explainError(status: number, statusText: string, body: string): string {
  const trimmed = body.slice(0, 1000);
  if (status === 401) return `Bright Data authentication failed. Check BRIGHT_DATA_KEY or BRIGHTDATA_API_KEY. ${trimmed}`;
  if (status === 403) return `Bright Data rejected the request. Check zone permissions and product access. ${trimmed}`;
  if (status === 429) return `Bright Data rate limit or quota was hit. Try fewer queries or URLs. ${trimmed}`;
  return `Bright Data request failed: HTTP ${status} ${statusText}. ${trimmed}`;
}

export async function brightDataRequest(payload: BrightDataPayload, signal?: AbortSignal): Promise<BrightDataResult> {
  const apiKey = getBrightDataApiKey();
  if (!apiKey) {
    throw new Error("Bright Data API key not found. Set BRIGHT_DATA_KEY or BRIGHTDATA_API_KEY.");
  }

  const timeoutMs = loadBrightDataConfig().brightdata.requestTimeoutMs;
  validateBrightDataTarget(payload.url);
  const safePayload = { ...payload };
  let response: Response;
  try {
    response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(safePayload),
      signal: combineSignals(timeoutMs, signal),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "AbortError" || name === "TimeoutError" || message.toLowerCase().includes("abort")) {
      throw new Error(`Bright Data request aborted or timed out: ${message}`);
    }
    throw new Error(`Bright Data network request failed: ${message}`);
  }

  const bytes = await response.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  let json: unknown | null = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    throw new Error(explainError(response.status, response.statusText, text));
  }

  return { status: response.status, headers: response.headers, text, json, bytes };
}
