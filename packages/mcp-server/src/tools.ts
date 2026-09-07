import { z } from "zod";
import { hubGet, hubPost, readAgentId, writeAgentId } from "./hub-client.js";
import type { Agent, Tile } from "@district/shared";

export const TOOL_DEFS = [
  {
    name: "spawn",
    description:
      "create or update this process’s agent (identity = env AGENT_ID or a file .district-agent-id in cwd so reconnect is stable)",
    schema: {
      name: z.string().optional(),
      role: z.string().optional(),
      sprite: z.string().optional(),
      orgId: z.string().optional(),
    },
  },
  {
    name: "heartbeat",
    description: "refresh lastHeartbeatAt, optionally update state/bubble/tool without moving",
    schema: {
      state: z.string().optional(),
      bubble: z.string().optional(),
      currentTool: z.string().optional(),
    },
  },
  {
    name: "look_around",
    description: "nearby agents (id,name,role,state,tile,bubble), stations, buildings — this is how agents get world awareness",
    schema: { radius: z.number().optional() },
  },
  {
    name: "go_to",
    description:
      "hub pathfinds, sets state walking, then idle on arrival. Returns { pathLength, arrived: false } immediately; do not block the MCP call for the walk. Include target.",
    schema: {
      stationId: z.string().optional(),
      stationKind: z.string().optional(),
      buildingKind: z.string().optional(),
      agentName: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
  },
  {
    name: "work_on",
    description:
      "go_to that station if needed, set state working, bubble = title, currentTool = toolName. Hub auto-clears working → idle after seconds unless another work_on/heartbeat extends it",
    schema: {
      title: z.string(),
      stationKind: z.string().optional(),
      stationId: z.string().optional(),
      toolName: z.string().optional(),
      seconds: z.number().optional(),
    },
  },
  {
    name: "tool_event",
    description:
      "map server name to a station (github→server_rack named github, shell/bash→terminal, search/read/grep→library, test→lab, slack/mail→mail or cafe, unknown→desk in HQ). set currentTool to server.tool, bubble to summary slice 60 chars, emit event kind tool. if status error, also set state error for 8s",
    schema: {
      server: z.string(),
      tool: z.string(),
      summary: z.string(),
      status: z.enum(["ok", "error"]).optional(),
    },
  },
  {
    name: "speak",
    description: "bubble + event. If toAgentName, walk within 2 tiles first (async, don’t block tool)",
    schema: { text: z.string(), toAgentName: z.string().optional() },
  },
  {
    name: "handoff",
    description: "both agents get bubbles; event kind handoff; this agent walks toward the other",
    schema: { toAgentName: z.string(), note: z.string() },
  },
  {
    name: "blocked",
    description: "state blocked, orange ?, walk to HQ front_desk",
    schema: { reason: z.string() },
  },
  {
    name: "report_error",
    description: "state error, red !",
    schema: { message: z.string() },
  },
  {
    name: "drop_artifact",
    description: "walk to mail mailbox, event kind artifact, create a done task",
    schema: { title: z.string(), body: z.string() },
  },
  {
    name: "drop_postcard",
    description: "drop a campus postcard artifact: campus-wide visits plus per-building visits/heat. PNG is visitor key P.",
    schema: {},
  },
  {
    name: "list_tasks",
    description: "returns open/assigned tasks for this org",
    schema: {},
  },
  {
    name: "claim_task",
    description: "assign to this agent, state working after go_to desk",
    schema: { taskId: z.string() },
  },
  {
    name: "finish_task",
    description: "status done, drop_artifact equivalent",
    schema: { taskId: z.string(), result: z.string() },
  },
  {
    name: "despawn",
    description: "remove sprite",
    schema: {},
  },
] as const;

export function needId(): string {
  const id = readAgentId();
  if (!id) throw new Error("no agent id — call spawn first");
  return id;
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "spawn": {
      const existing = readAgentId();
      const agent = await hubPost<Agent>("/api/agents/upsert", {
        id: existing,
        name: args.name ?? process.env.AGENT_NAME ?? "Claude",
        role: args.role ?? process.env.AGENT_ROLE ?? "Coder",
        sprite: args.sprite ?? process.env.AGENT_SPRITE ?? "yuki",
        orgId: args.orgId ?? process.env.ORG_ID ?? "org_acme",
      });
      writeAgentId(agent.id);
      return { agentId: agent.id, tile: agent.tile as Tile };
    }
    case "heartbeat":
      return hubPost(`/api/agents/${needId()}/heartbeat`, args);
    case "look_around": {
      const me = await hubGet<Agent>(`/api/agents/${needId()}`);
      const r = Number(args.radius ?? 6);
      return hubGet(`/api/world/look?x=${me.tile.x}&y=${me.tile.y}&r=${r}`);
    }
    case "go_to":
      return hubPost(`/api/agents/${needId()}/go_to`, args);
    case "work_on":
      return hubPost(`/api/agents/${needId()}/work_on`, args);
    case "tool_event":
      return hubPost(`/api/agents/${needId()}/tool`, args);
    case "speak":
      return hubPost(`/api/agents/${needId()}/speak`, args);
    case "handoff":
      return hubPost(`/api/agents/${needId()}/handoff`, args);
    case "blocked":
      return hubPost(`/api/agents/${needId()}/blocked`, args);
    case "report_error":
      return hubPost(`/api/agents/${needId()}/error`, args);
    case "drop_artifact":
      return hubPost(`/api/mcp/drop_artifact`, { ...args, agentId: needId() });
    case "drop_postcard":
      return hubPost(`/api/mcp/drop_postcard`, { agentId: needId() });
    case "list_tasks":
      return hubGet(`/api/tasks`);
    case "claim_task":
      return hubPost(`/api/mcp/claim_task`, { ...args, agentId: needId() });
    case "finish_task":
      return hubPost(`/api/mcp/finish_task`, { ...args, agentId: needId() });
    case "despawn":
      return hubPost(`/api/agents/${needId()}/despawn`, {});
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
