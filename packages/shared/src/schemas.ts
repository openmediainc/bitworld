import { z } from "zod";

export const tileSchema = z.object({ x: z.number().int(), y: z.number().int() });
export const rectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
});

export const orgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
  plot: rectSchema,
  public: z.boolean(),
});

export const buildingKindSchema = z.enum([
  "plaza",
  "hq",
  "library",
  "lab",
  "terminal",
  "servers",
  "cafe",
  "board",
  "mail",
  "house",
]);

export const buildingSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  kind: buildingKindSchema,
  rect: rectSchema,
  door: tileSchema,
});

export const stationKindSchema = z.enum([
  "desk",
  "library",
  "terminal",
  "lab",
  "front_desk",
  "server_rack",
  "cafe",
  "board",
  "mailbox",
  "meeting_table",
]);

export const stationSchema = z.object({
  id: z.string(),
  buildingId: z.string(),
  name: z.string(),
  kind: stationKindSchema,
  tile: tileSchema,
  mcpServerName: z.string().optional(),
  toolHint: z.string().optional(),
});

export const agentStateSchema = z.enum([
  "idle",
  "walking",
  "working",
  "blocked",
  "error",
  "speaking",
  "sleeping",
]);

export const spriteIdSchema = z.enum([
  "kael",
  "yuki",
  "nora",
  "rex",
  "iris",
  "cobb",
  "lark",
  "moss",
  "visitor",
]);

export const facingSchema = z.enum(["up", "down", "left", "right"]);

export const agentSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  role: z.string(),
  sprite: spriteIdSchema,
  color: z.string(),
  simulated: z.boolean(),
  tile: tileSchema,
  target: tileSchema.optional(),
  path: z.array(tileSchema),
  facing: facingSchema,
  state: agentStateSchema,
  bubble: z.string().optional(),
  currentTool: z.string().optional(),
  currentStationId: z.string().optional(),
  lastHeartbeatAt: z.number(),
  lastEventAt: z.number(),
  blockedReason: z.string().optional(),
  tokenSpendHint: z.number().optional(),
  shard: z.enum(["campus", "avenue"]).optional(),
});

export const avenuePlotSchema = z.object({
  id: z.string(),
  address: z.string(),
  orgId: z.string().optional(),
  orgName: z.string(),
  slug: z.string(),
  color: z.string(),
  rect: rectSchema,
  door: tileSchema,
  kind: z.enum(["org", "billboard", "empty"]),
  href: z.string().optional(),
  campusKind: z.string().optional(),
  forSale: z.literal(false),
});

export const avenueStateSchema = z.object({
  km0: tileSchema,
  plots: z.array(avenuePlotSchema),
});

export const worldEventKindSchema = z.enum([
  "spawn",
  "despawn",
  "heartbeat",
  "walk",
  "work",
  "tool",
  "speak",
  "handoff",
  "blocked",
  "error",
  "task",
  "artifact",
]);

export const worldEventSchema = z.object({
  id: z.string(),
  at: z.number(),
  agentId: z.string().optional(),
  orgId: z.string().optional(),
  kind: worldEventKindSchema,
  text: z.string(),
  data: z.record(z.unknown()).optional(),
});

export const taskSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  missionId: z.string().optional(),
  kind: z.enum(["task", "artifact"]).optional(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["open", "assigned", "doing", "done", "failed"]),
  createdAt: z.number(),
  helpWanted: z.boolean().optional(),
  accepted: z.boolean().optional(),
  acceptedBy: z.string().optional(),
  acceptedAt: z.number().optional(),
  agreementId: z.string().optional(),
});

export const missionStatusSchema = z.enum(["planning", "active", "blocked", "completed"]);
export const missionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  title: z.string(),
  outcome: z.string(),
  status: missionStatusSchema,
  participantIds: z.array(z.string()),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  helpWanted: z.boolean().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  ownerBuilderId: z.string().optional(),
  builderIds: z.array(z.string()).optional(),
});

export const buildingStatSchema = z.object({
  buildingId: z.string(),
  visits: z.number(),
  heat: z.number(),
  foundedByAgentId: z.string().optional(),
  foundedByName: z.string().optional(),
});

export const presenceSchema = z.object({
  online: z.number(),
  visits: z.number(),
});

export const snapshotSchema = z.object({
  t: z.number(),
  org: orgSchema,
  buildings: z.array(buildingSchema),
  stations: z.array(stationSchema),
  agents: z.array(agentSchema),
  tasks: z.array(taskSchema),
  missions: z.array(missionSchema).default([]),
  events: z.array(worldEventSchema),
  presence: presenceSchema.optional(),
  buildingStats: z.array(buildingStatSchema).optional(),
  avenue: avenueStateSchema.optional(),
});

export const shardBodySchema = z.object({
  shard: z.enum(["campus", "avenue"]),
});

const principalIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const entityIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);

export const spawnBodySchema = z.object({
  id: principalIdSchema.optional(),
  name: z.string().min(1).max(60).optional(),
  role: z.string().min(1).max(60).optional(),
  sprite: spriteIdSchema.optional(),
  orgId: entityIdSchema.optional(),
  color: z.string().max(30).optional(),
  simulated: z.boolean().optional(),
  tile: tileSchema.optional(),
});

export const heartbeatBodySchema = z.object({
  state: agentStateSchema.optional(),
  bubble: z.string().max(60).optional(),
  currentTool: z.string().max(100).optional(),
});

export const goToBodySchema = z
  .object({
    stationId: entityIdSchema.optional(),
    stationKind: stationKindSchema.optional(),
    buildingKind: buildingKindSchema.optional(),
    agentName: z.string().max(60).optional(),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
  })
  .refine(
    (v) =>
      Boolean(
        v.stationId ||
          v.stationKind ||
          v.buildingKind ||
          v.agentName ||
          (v.x !== undefined && v.y !== undefined),
      ),
    { message: "need stationId, stationKind, buildingKind, agentName, or x,y" },
  );

export const workOnBodySchema = z.object({
  title: z.string().min(1).max(140),
  stationKind: stationKindSchema.optional(),
  stationId: entityIdSchema.optional(),
  toolName: z.string().max(100).optional(),
  seconds: z.number().int().positive().max(3600).optional(),
  missionId: entityIdSchema.optional(),
});

export const toolEventBodySchema = z.object({
  server: z.string().min(1).max(100),
  tool: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  status: z.enum(["ok", "error"]).optional(),
  missionId: entityIdSchema.optional(),
});

export const speakBodySchema = z.object({
  text: z.string().min(1).max(60),
  toAgentName: z.string().max(60).optional(),
  missionId: entityIdSchema.optional(),
});

export const handoffBodySchema = z.object({
  toAgentName: z.string().min(1).max(60),
  note: z.string().min(1).max(500),
  missionId: entityIdSchema.optional(),
});

export const blockedBodySchema = z.object({
  reason: z.string().min(1).max(1000),
  missionId: entityIdSchema.optional(),
});
export const errorBodySchema = z.object({
  message: z.string().min(1).max(1000),
  missionId: entityIdSchema.optional(),
});
export const artifactBodySchema = z.object({
  title: z.string().min(1).max(140),
  body: z.string().min(1).max(10_000),
  missionId: entityIdSchema.optional(),
});
export const claimTaskBodySchema = z.object({ taskId: entityIdSchema });
export const finishTaskBodySchema = z.object({
  taskId: entityIdSchema,
  result: z.string().min(1).max(10_000),
});
export const taskCreateBodySchema = z.object({
  title: z.string().min(1).max(140),
  body: z.string().max(10_000).default(""),
  agentId: principalIdSchema.optional(),
  missionId: entityIdSchema.optional(),
  orgId: entityIdSchema.optional(),
  helpWanted: z.boolean().optional(),
});
export const missionCreateBodySchema = z.object({
  title: z.string().min(1).max(100),
  outcome: z.string().min(1).max(500),
  participantId: principalIdSchema.optional(),
  orgId: entityIdSchema.optional(),
  helpWanted: z.boolean().optional(),
  visibility: z.enum(["public", "private"]).optional(),
});
export const taskReviewBodySchema = z.object({
  participantId: principalIdSchema,
  reason: z.string().min(1).max(280).optional(),
});
export const missionJoinBodySchema = z.object({ participantId: principalIdSchema });
export const missionStatusBodySchema = z.object({ status: missionStatusSchema });

export const builderCreateBodySchema = z.object({
  handle: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/),
  displayName: z.string().min(1).max(60),
  bio: z.string().max(500).optional(),
  skills: z.array(z.string().min(1).max(40)).max(30).default([]),
  availability: z.enum(["available", "limited", "unavailable"]).default("available"),
  collaborationTerms: z.string().max(280).optional(),
});
export const builderUpdateBodySchema = builderCreateBodySchema
  .omit({ handle: true })
  .partial();
export const fleetEnrollmentCreateBodySchema = z.object({
  expiresInMinutes: z.number().int().min(1).max(60).default(15),
});
export const fleetEnrollmentAcceptBodySchema = z.object({ token: z.string().min(20) });
export const bindVisitorBodySchema = z.object({
  visitorId: z.string().regex(/^visitor_[a-zA-Z0-9-]{5,50}$/),
});
export const inviteCreateBodySchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  inviteeBuilderId: z.string().min(1).optional(),
});
export const inviteAcceptBodySchema = z.object({ token: z.string().min(20) });
export const resourceCreateBodySchema = z.object({
  kind: z.enum(["github_repo", "github_issue", "document", "tracker", "custom"]),
  label: z.string().min(1).max(100),
  url: z.string().url().max(2000),
  providerInstallationId: z.number().int().positive().optional(),
});
export const grantCreateBodySchema = z
  .object({
    resourceId: z.string().min(1),
    granteeBuilderId: z.string().min(1).optional(),
    granteeAgentId: z.string().min(1).optional(),
    actions: z.array(z.string().min(1).max(60)).min(1).max(30),
    expiresAt: z.number().int().optional(),
  })
  .refine((value) => Boolean(value.granteeBuilderId) !== Boolean(value.granteeAgentId), {
    message: "provide exactly one builder or agent grantee",
  });
export const agreementCreateBodySchema = z.object({
  missionId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  providerBuilderId: z.string().min(1).optional(),
  providerAgentId: z.string().min(1).optional(),
  openToBuilders: z.boolean().optional(),
  title: z.string().min(1).max(140),
  acceptanceCriteria: z.array(z.string().min(1).max(280)).min(1).max(20),
  consideration: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("volunteer") }),
    z.object({
      kind: z.literal("external"),
      amountMinor: z.number().int().nonnegative().optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      externalReference: z.string().url().max(2000).optional(),
    }),
  ]),
});
export const agreementActionBodySchema = z.object({
  deliveryNote: z.string().min(1).max(5000).optional(),
  reason: z.string().min(1).max(1000).optional(),
});
export const githubActionBodySchema = z.object({
  resourceId: z.string().min(1),
  action: z.enum([
    "issues:read",
    "issues:comment",
    "contents:read",
    "contents:write",
    "branches:create",
    "pull_requests:create",
  ]),
  input: z.record(z.unknown()).default({}),
});
export const visitorMoveBodySchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export const visitorSayBodySchema = z.object({ text: z.string().min(1).max(60) });
export const reportBodySchema = z.object({ text: z.string().min(1).max(280) });
export const lookQuerySchema = z.object({
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  r: z.coerce.number().int().min(1).max(50).optional(),
});
