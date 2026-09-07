#!/usr/bin/env node
/**
 * Drive District MCP over stdio (JSON-RPC) so a live non-SIM body appears.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "packages/mcp-server/src/index.ts");

const child = spawn("npx", ["tsx", entry], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    HUB_URL: process.env.HUB_URL ?? "http://127.0.0.1:4242",
    AGENT_NAME: process.env.AGENT_NAME ?? "Hermes",
    AGENT_ROLE: process.env.AGENT_ROLE ?? "Chief of Staff",
    AGENT_SPRITE: process.env.AGENT_SPRITE ?? "moss",
    ORG_ID: process.env.ORG_ID ?? "org_acme",
    AGENT_ID: process.env.AGENT_ID ?? "hermes_cos",
  },
});

let buf = "";
let nextId = 1;
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(payload) + "\n");
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 15000);
    pending.set(id, (msg) => {
      clearTimeout(t);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function textOf(result) {
  const c = result?.content?.[0]?.text;
  return c ?? JSON.stringify(result);
}

const keep = process.argv.includes("--keep");

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "district-hermes", version: "0.1.0" },
  });
  notify("notifications/initialized", {});
  const listed = await rpc("tools/list", {});
  const names = (listed.tools ?? []).map((t) => t.name);
  console.log("MCP tools", names.length, names.join(", "));
  const spawnRes = await rpc("tools/call", {
    name: "spawn",
    arguments: { name: process.env.AGENT_NAME ?? "Hermes", role: process.env.AGENT_ROLE ?? "Chief of Staff", sprite: process.env.AGENT_SPRITE ?? "moss" },
  });
  console.log("spawn", textOf(spawnRes));
  const look = await rpc("tools/call", { name: "look_around", arguments: { radius: 8 } });
  console.log("look_around", textOf(look).slice(0, 400));
  console.log("go_to library", textOf(await rpc("tools/call", { name: "go_to", arguments: { buildingKind: "library" } })));
  console.log(
    "tool_event github",
    textOf(
      await rpc("tools/call", {
        name: "tool_event",
        arguments: { server: "github", tool: "list_prs", summary: "checking PRs" },
      }),
    ),
  );
  console.log(
    "speak",
    textOf(await rpc("tools/call", { name: "speak", arguments: { text: "campus is live" } })),
  );
  console.log(
    "work_on",
    textOf(
      await rpc("tools/call", {
        name: "work_on",
        arguments: { title: "wiring MCP into the body", stationKind: "terminal", seconds: 18 },
      }),
    ),
  );
  if (keep) {
    console.log("MCP client holding the body (heartbeats). Ctrl+C to despawn.");
    process.on("SIGINT", () => {
      void rpc("tools/call", { name: "despawn", arguments: {} })
        .catch(() => undefined)
        .finally(() => {
          child.kill("SIGTERM");
          process.exit(0);
        });
    });
  } else {
    setTimeout(() => process.exit(0), 500);
  }
} catch (e) {
  console.error(e);
  child.kill("SIGTERM");
  process.exit(1);
}
