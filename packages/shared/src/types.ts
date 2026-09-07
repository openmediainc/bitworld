export type Tile = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Org = {
  id: string;
  name: string;
  slug: string;
  color: string;
  plot: Rect;
  public: boolean;
};

export type BuildingKind =
  | "plaza"
  | "hq"
  | "library"
  | "lab"
  | "terminal"
  | "servers"
  | "cafe"
  | "board"
  | "mail"
  | "house";

export type Building = {
  id: string;
  orgId: string;
  name: string;
  kind: BuildingKind;
  rect: Rect;
  door: Tile;
};

export type StationKind =
  | "desk"
  | "library"
  | "terminal"
  | "lab"
  | "front_desk"
  | "server_rack"
  | "cafe"
  | "board"
  | "mailbox"
  | "meeting_table";

export type Station = {
  id: string;
  buildingId: string;
  name: string;
  kind: StationKind;
  tile: Tile;
  mcpServerName?: string;
  toolHint?: string;
};

export type AgentState =
  | "idle"
  | "walking"
  | "working"
  | "blocked"
  | "error"
  | "speaking"
  | "sleeping";

export type SpriteId =
  | "kael"
  | "yuki"
  | "nora"
  | "rex"
  | "iris"
  | "cobb"
  | "lark"
  | "moss"
  | "visitor";

export type Facing = "up" | "down" | "left" | "right";

export type Agent = {
  id: string;
  orgId: string;
  name: string;
  role: string;
  sprite: SpriteId;
  color: string;
  simulated: boolean;
  tile: Tile;
  target?: Tile;
  path: Tile[];
  facing: Facing;
  state: AgentState;
  bubble?: string;
  currentTool?: string;
  currentStationId?: string;
  lastHeartbeatAt: number;
  lastEventAt: number;
  blockedReason?: string;
  tokenSpendHint?: number;
  shard?: "campus" | "avenue";
};

export type AvenuePlotKind = "org" | "billboard" | "empty";

export type AvenuePlot = {
  id: string;
  address: string;
  orgId?: string;
  orgName: string;
  slug: string;
  color: string;
  rect: Rect;
  door: Tile;
  kind: AvenuePlotKind;
  href?: string;
  campusKind?: string;
  forSale: false;
};

export type AvenueState = {
  km0: Tile;
  plots: AvenuePlot[];
};

export type WorldEventKind =
  | "spawn"
  | "despawn"
  | "heartbeat"
  | "walk"
  | "work"
  | "tool"
  | "speak"
  | "handoff"
  | "blocked"
  | "error"
  | "task"
  | "artifact";

export type WorldEvent = {
  id: string;
  at: number;
  agentId?: string;
  orgId?: string;
  kind: WorldEventKind;
  text: string;
  data?: Record<string, unknown>;
};

export type Task = {
  id: string;
  orgId: string;
  agentId?: string;
  /** Display name captured when claimed. Volunteers despawn, so credit cannot rely on a live agent. */
  agentName?: string;
  missionId?: string;
  kind?: "task" | "artifact";
  title: string;
  body: string;
  status: "open" | "assigned" | "doing" | "done" | "failed";
  createdAt: number;
  /** Open for any connected agent to claim. Public-safe work only. */
  helpWanted?: boolean;
  /** Human on the mission accepted the contribution. Reputation uses this, not raw finishes. */
  accepted?: boolean;
  acceptedBy?: string;
  acceptedAt?: number;
  agreementId?: string;
};

export type MissionStatus = "planning" | "active" | "blocked" | "completed";
export type MissionVisibility = "public" | "private";

export type Mission = {
  id: string;
  orgId: string;
  title: string;
  outcome: string;
  status: MissionStatus;
  participantIds: string[];
  createdAt: number;
  completedAt?: number;
  /** Outside agents may claim unassigned tasks. Must stay public-safe. */
  helpWanted?: boolean;
  visibility?: MissionVisibility;
  ownerBuilderId?: string;
  builderIds?: string[];
};

export type BuilderProfile = {
  id: string;
  handle: string;
  displayName: string;
  bio?: string;
  skills: string[];
  availability?: "available" | "limited" | "unavailable";
  collaborationTerms?: string;
  agentIds: string[];
  visitorId?: string;
  createdAt: number;
  updatedAt: number;
};

export type MissionInvite = {
  id: string;
  missionId: string;
  createdBy: string;
  inviteeBuilderId?: string;
  createdAt: number;
  expiresAt: number;
  acceptedBy?: string;
  acceptedAt?: number;
  revokedAt?: number;
};

export type ResourceKind = "github_repo" | "github_issue" | "document" | "tracker" | "custom";

/** A reference only. District never stores the resource's credential. */
export type MissionResource = {
  id: string;
  missionId: string;
  kind: ResourceKind;
  label: string;
  url: string;
  /** Non-secret GitHub App installation id. Credentials remain in server environment. */
  providerInstallationId?: number;
  createdBy: string;
  createdAt: number;
};

export type CapabilityGrant = {
  id: string;
  missionId: string;
  resourceId: string;
  granteeBuilderId?: string;
  granteeAgentId?: string;
  actions: string[];
  createdBy: string;
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
};

export type AgreementStatus =
  | "proposed"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "approved"
  | "disputed"
  | "cancelled";

export type WorkConsideration =
  | { kind: "volunteer" }
  | {
      kind: "external";
      amountMinor?: number;
      currency?: string;
      /** Invoice, escrow, or payment-provider reference. District does not custody funds. */
      externalReference?: string;
    };

export type WorkAgreement = {
  id: string;
  missionId: string;
  taskId?: string;
  requesterBuilderId: string;
  providerBuilderId?: string;
  providerAgentId?: string;
  openToBuilders?: boolean;
  title: string;
  acceptanceCriteria: string[];
  consideration: WorkConsideration;
  status: AgreementStatus;
  createdAt: number;
  acceptedAt?: number;
  deliveredAt?: number;
  approvedAt?: number;
  disputedAt?: number;
  cancelledAt?: number;
  deliveryNote?: string;
  disputeReason?: string;
};

export type BuilderNotification = {
  id: string;
  builderId: string;
  kind: "invite" | "assignment" | "blocked" | "delivery" | "approval" | "dispute";
  text: string;
  missionId?: string;
  agreementId?: string;
  inviteId?: string;
  createdAt: number;
  readAt?: number;
  webhookAttemptedAt?: number;
  webhookDeliveredAt?: number;
};

export type CollaborationAudit = {
  id: string;
  at: number;
  actorType: "builder" | "agent" | "system";
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  missionId?: string;
  data?: Record<string, unknown>;
};

export type RelationshipSummary = {
  builderId: string;
  displayName: string;
  sharedMissionIds: string[];
  approvedAgreements: number;
  lastCollaboratedAt: number;
};

export type CollaborationWorkspace = {
  builder: BuilderProfile;
  builders: BuilderProfile[];
  directory: BuilderProfile[];
  missions: Mission[];
  tasks: Task[];
  invites: MissionInvite[];
  resources: MissionResource[];
  grants: CapabilityGrant[];
  agreements: WorkAgreement[];
  opportunities: WorkAgreement[];
  notifications: BuilderNotification[];
  relationships: RelationshipSummary[];
  audit: CollaborationAudit[];
};

export type AgentWorkspace = {
  agentId: string;
  builder: Omit<BuilderProfile, "visitorId">;
  missions: Mission[];
  tasks: Task[];
  resources: MissionResource[];
  grants: CapabilityGrant[];
  agreements: WorkAgreement[];
};

export type BuildingStat = {
  buildingId: string;
  visits: number;
  heat: number;
  foundedByAgentId?: string;
  foundedByName?: string;
};

export type Presence = {
  online: number;
  visits: number;
};

export type Snapshot = {
  t: number;
  org: Org;
  buildings: Building[];
  stations: Station[];
  agents: Agent[];
  tasks: Task[];
  missions: Mission[];
  events: WorldEvent[];
  presence?: Presence;
  buildingStats?: BuildingStat[];
  avenue?: AvenueState;
};

export type WsHello = { type: "hello"; role: "viewer" | "visitor"; name?: string; visitorId?: string };
export type WsMove = { type: "move"; x: number; y: number };
export type WsSay = { type: "say"; text: string };
export type WsPing = { type: "ping" };
export type ClientMessage = WsHello | WsMove | WsSay | WsPing;

export type ServerMessage =
  | { type: "snapshot"; payload: Snapshot }
  | { type: "session"; payload: { visitorId?: string } }
  | { type: "delta"; payload: { agents?: Agent[]; events?: WorldEvent[]; tasks?: Task[]; missions?: Mission[] } }
  | { type: "pong" };
