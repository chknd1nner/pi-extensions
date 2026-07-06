// HTTP request handler for imsg-server. No framework. Never logs tokens or
// Authorization headers; 401 bodies are generic; osascript detail goes to
// the local log only; 502 codes are whitelisted.
import { composeText, tokenMatches, validatePayload } from "./lib.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const SANITIZED_CODES = new Set(["AUTOMATION_NOT_AUTHORIZED", "MESSAGES_UNAVAILABLE", "SEND_FAILED"]);

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createHandler(config, deps) {
  const log = deps.log ?? ((line) => console.error(line));

  return (req, res) => {
    void handle(req, res).catch((err) => {
      log(`unhandled handler error: ${err?.stack ?? err}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal" });
    });
  };

  async function handle(req, res) {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/send") {
      if (!tokenMatches(req.headers.authorization, config.token)) {
        return json(res, 401, { ok: false, error: "unauthorized" });
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { ok: false, error: "invalid JSON body" });
      }
      const result = validatePayload(body);
      if (!result.ok) return json(res, 400, { ok: false, error: result.error });

      const text = composeText(result.value);
      try {
        await deps.send({ recipient: config.recipient, text });
      } catch (err) {
        const code = SANITIZED_CODES.has(err?.code) ? err.code : "SEND_FAILED";
        log(`send failed (${code}): ${err?.localDetail ?? err?.message ?? err}`);
        return json(res, 502, { ok: false, error: code });
      }
      log(`sent notification (${text.length} chars)`);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: "not found" });
  }
}
