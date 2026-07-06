#!/usr/bin/env node
// imsg-server entry point.
//   node imsg-server.mjs                       start HTTP server
//   node imsg-server.mjs --smoke-send [text]   send one message via the
//                                              production code path, exit 0/1
// Config: $IMSG_SERVER_CONFIG or ~/.config/imsg-server/config.json
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { composeText, loadServerConfig } from "./lib.mjs";
import { sendMessage } from "./send.mjs";
import { createHandler } from "./server.mjs";

const configPath =
  process.env.IMSG_SERVER_CONFIG ??
  path.join(os.homedir(), ".config", "imsg-server", "config.json");

let config;
try {
  config = loadServerConfig(configPath);
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}

const [, , flag, ...rest] = process.argv;

if (flag === "--smoke-send") {
  const text = composeText({
    message: rest.join(" ") || "imsg-server smoke test",
    emoji: "🔧",
    context: `smoke-send · ${os.hostname().split(".")[0]}`,
  });
  try {
    await sendMessage({ recipient: config.recipient, text });
    console.log("smoke-send OK");
    process.exit(0);
  } catch (err) {
    console.error(`smoke-send FAILED (${err.code ?? "unknown"})`);
    console.error(err.localDetail ?? err.message);
    process.exit(1);
  }
}

const handler = createHandler(config, { send: sendMessage });
const server = http.createServer(handler);
server.listen(config.port, config.host, () => {
  console.error(`imsg-server listening on ${config.host}:${config.port}`);
});
