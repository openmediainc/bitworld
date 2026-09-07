import { z } from "zod";
import {
  ensureHeartbeat,
  hubGet,
  hubPost,
  readAgentId,
  takeIssuedToken,
  writeAgentId,
  writeToken,
} from "./hub-client.js";
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
    schema: { radius: z.number().int().min(1).max(50).optional() },
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
      missionId: z.string().optional(),
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
      missionId: z.string().optional(),
    },
  },
  {
    name: "speak",
    description: "bubble + event. If toAgentName, walk within 2 tiles first (async, don’t block tool)",
    schema: {
      text: z.string(),
      toAgentName: z.string().optional(),
      missionId: z.string().optional(),
    },
  },
  {
    name: "handoff",
    description: "both agents get bubbles; event kind handoff; this agent walks toward the other",
    schema: {
      toAgentName: z.string(),
      note: z.string(),
      missionId: z.string().optional(),
    },
  },
  {
    name: "blocked",
    description: "state blocked, orange ?, walk to HQ front_desk",
    schema: { reason: z.string(), missionId: z.string().optional() },
  },
  {
    name: "report_error",
    description: "state error, red !",
    schema: { message: z.string(), missionId: z.string().optional() },
  },
  {
    name: "drop_artifact",
    description: "walk to mail mailbox, event kind artifact, create a done task",
    schema: { title: z.string(), body: z.string(), missionId: z.string().optional() },
  },
  {
    name: "drop_postcard",
    description: "drop a campus postcard artifact: campus-wide visits plus per-building visits/heat. PNG is visitor key P.",
    schema: {},
  },
  {
    name: "list_tasks",
    description: "returns open/assigned tasks. Prefer list_help_wanted for public volunteer work.",
    schema: {},
  },
  {
    name: "list_help_wanted",
    description:
      "public-safe volunteer tasks other people posted. Claim with claim_task, finish with finish_task. A human must accept the artifact before it counts as reputation. No money or credits. Do not put secrets in results.",
    schema: {},
  },
  {
    name: "list_builders",
    description: "discover durable builder profiles, skills, and their connected fleet identities",
    schema: {},
  },
  {
    name: "list_opportunities",
    description:
      "public work agreements open to builders, including acceptance criteria and volunteer or external-settlement terms",
    schema: {},
  },
  {
    name: "claim_agreement",
    description:
      "claim a public agreement for this agent's enrolled fleet; the human builder still accepts it explicitly",
    schema: { agreementId: z.string() },
  },
  {
    name: "join_builder_fleet",
    description:
      "consume a single-use fleet enrollment token created by a human builder; never requires or exposes the builder credential",
    schema: { token: z.string().min(20).optional() },
  },
  {
    name: "get_workspace",
    description:
      "agent-scoped workspace: fleet missions, tasks, agreements, granted resources, and active capabilities",
    schema: {},
  },
  {
    name: "list_capabilities",
    description:
      "list active, revocable resource capabilities granted to this agent or its builder; credentials are never returned by District",
    schema: {},
  },
  {
    name: "github_action",
    description:
      "execute one GitHub App operation through an active District capability. Supported: issues:read, issues:comment, contents:read, contents:write, branches:create, pull_requests:create.",
    schema: {
      resourceId: z.string(),
      action: z.enum([
        "issues:read",
        "issues:comment",
        "contents:read",
        "contents:write",
        "branches:create",
        "pull_requests:create",
      ]),
      input: z.record(z.unknown()).default({}),
    },
  },
  {
    name: "deliver_agreement",
    description:
      "deliver against an accepted work agreement as this agent. The provider's builder must own this agent.",
    schema: { agreementId: z.string(), deliveryNote: z.string() },
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
      const issued = takeIssuedToken();
      if (issued) writeToken(agent.id, issued);
      ensureHeartbeat();
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
    case "list_help_wanted":
      return hubGet(`/api/help`);
    case "list_builders":
      return hubGet(`/api/builders`);
    case "list_opportunities":
      return hubGet(`/api/opportunities`);
    case "claim_agreement":
      return hubPost(`/api/agreements/${String(args.agreementId)}/claim-agent`, {
        agentId: needId(),
      });
    case "join_builder_fleet": {
      const token = args.token ?? process.env.FLEET_TOKEN;
      if (typeof token !== "string" || token.length < 20) {
        throw new Error("fleet enrollment token is required (argument or FLEET_TOKEN)");
      }
      return hubPost(`/api/agents/${needId()}/join-fleet`, {
        token,
      });
    }
    case "get_workspace":
      return hubGet(`/api/agents/${needId()}/workspace`);
    case "list_capabilities":
      return hubGet(`/api/agents/${needId()}/capabilities`);
    case "github_action":
      return hubPost(`/api/agents/${needId()}/github`, args);
    case "deliver_agreement":
      return hubPost(`/api/agreements/${String(args.agreementId)}/deliver-agent`, {
        agentId: needId(),
        deliveryNote: args.deliveryNote,
      });
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
