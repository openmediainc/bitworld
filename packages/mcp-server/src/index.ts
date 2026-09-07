import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { callTool, TOOL_DEFS } from "./tools.js";
import { hubPost, readAgentId, readToken, takeIssuedToken, writeAgentId, writeToken } from "./hub-client.js";
import type { Agent } from "@district/shared";

const server = new McpServer({ name: "district", version: "0.1.0" });

for (const def of TOOL_DEFS) {
  const handler = async (args: Record<string, unknown> = {}) => {
    try {
      const result = await callTool(def.name, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
    }
  };
  if (Object.keys(def.schema).length === 0) {
    server.tool(def.name, def.description, handler);
  } else {
    server.tool(def.name, def.description, def.schema, handler);
  }
}

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

async function bootBody() {
  try {
    const existing = readAgentId();
    const agent = await hubPost<Agent>("/api/agents/upsert", {
      id: existing,
      name: process.env.AGENT_NAME ?? "Claude",
      role: process.env.AGENT_ROLE ?? "Coder",
      sprite: process.env.AGENT_SPRITE ?? "yuki",
      orgId: process.env.ORG_ID ?? "org_acme",
    });
    writeAgentId(agent.id);
    // When the hub chose the id, the token arrived before we knew what to file it under.
    const issued = takeIssuedToken();
    if (issued) writeToken(agent.id, issued);
    heartbeatTimer = setInterval(() => {
      const id = readAgentId();
      if (!id) return;
      void hubPost(`/api/agents/${id}/heartbeat`, {}).catch(() => undefined);
    }, 10_000);
  } catch (e) {
    console.error("[district mcp] spawn failed", e);
  }
}

async function despawnBestEffort() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  const id = readAgentId();
  if (!id) return;
  try {
    await hubPost(`/api/agents/${id}/despawn`, {});
  } catch {
    /* best-effort */
  }
}

process.on("SIGINT", () => {
  void despawnBestEffort().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void despawnBestEffort().finally(() => process.exit(0));
});
process.on("exit", () => {
  const id = readAgentId();
  if (!id) return;
  try {
    const url = `${process.env.HUB_URL ?? "http://127.0.0.1:4242"}/api/agents/${id}/despawn`;
    const token = readToken(id);
    // last-ditch; may not finish
    void fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-district-token": token } : {}),
      },
      body: "{}",
    });
  } catch {
    /* ignore */
  }
});

const transport = new StdioServerTransport();
await bootBody();
await server.connect(transport);
