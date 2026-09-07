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
  title: string;
  body: string;
  status: "open" | "assigned" | "doing" | "done" | "failed";
  createdAt: number;
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
  events: WorldEvent[];
  presence?: Presence;
  buildingStats?: BuildingStat[];
  avenue?: AvenueState;
};

export type WsHello = { type: "hello"; role: "viewer" | "visitor"; name?: string };
export type WsMove = { type: "move"; x: number; y: number };
export type WsPing = { type: "ping" };
export type ClientMessage = WsHello | WsMove | WsPing;

export type ServerMessage =
  | { type: "snapshot"; payload: Snapshot }
  | { type: "delta"; payload: { agents?: Agent[]; events?: WorldEvent[]; tasks?: Task[] } }
  | { type: "pong" };
