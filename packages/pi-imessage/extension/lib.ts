// Pro-side logic for the send_imessage tool: config loading, context
// computation, and HTTP delivery to imsg-server on the Air.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface ProConfig {
  url: string;
  token: string;
}

export function defaultConfigPath(): string {
  return process.env.IMSG_CONFIG ?? join(homedir(), ".config", "imsg", "config.json");
}

export function loadProConfig(configPath: string): ProConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(
      `imsg config not found at ${configPath}. Setup: create it with {"url":"http://<air-host>:8787","token":"<token from setup.sh configure>"} and chmod 600.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${configPath}`);
  }
  const { url, token } = parsed as Partial<ProConfig>;
  if (typeof url !== "string" || url.length === 0) throw new Error(`config missing "url" (${configPath})`);
  if (typeof token !== "string" || token.length === 0) throw new Error(`config missing "token" (${configPath})`);
  return { url, token };
}

export function computeContext(hostname: string, cwd: string): string {
  const shortHost = hostname.split(".")[0].toLowerCase();
  return `${shortHost} · ${basename(cwd)}`;
}

export async function sendNotification(args: {
  config: ProConfig;
  message: string;
  emoji?: string;
  context: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  const { config, message, emoji, context } = args;
  const fetchFn = args.fetchFn ?? fetch;

  // Explicit AbortController: 10s timeout + optional upstream signal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout after 10s")), 10_000);
  const onUpstreamAbort = () => controller.abort(args.signal?.reason);
  if (args.signal?.aborted) controller.abort(args.signal.reason);
  args.signal?.addEventListener("abort", onUpstreamAbort, { once: true });

  const body: Record<string, string> = { message, context };
  if (emoji !== undefined) body.emoji = emoji;

  try {
    let res: Response;
    try {
      res = await fetchFn(`${config.url.replace(/\/$/, "")}/send`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `iMessage notification NOT delivered: server unreachable at ${config.url} (${err instanceof Error ? err.message : String(err)}). Is the Air online and imsg-server running?`,
      );
    }
    if (res.status === 401) {
      throw new Error(
        "iMessage notification NOT delivered: server rejected the token (401). Check that the token in ~/.config/imsg/config.json matches the Air's config.",
      );
    }
    let responseOk = false;
    let code = `HTTP ${res.status}`;
    try {
      const parsed = (await res.json()) as { ok?: boolean; error?: string };
      responseOk = res.status === 200 && parsed.ok === true;
      if (parsed.error) code = parsed.error;
    } catch {
      // keep HTTP status as the code
    }
    if (!responseOk) {
      throw new Error(`iMessage notification NOT delivered: ${code}`);
    }
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onUpstreamAbort);
  }
}
