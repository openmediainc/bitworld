import { nanoid } from "nanoid";
import {
  AVENUE_KM0,
  AVENUE_REFUSE,
  BUBBLE_MS,
  HELP_WANTED_DISCLAIMER,
  LABOR_DISCLAIMER,
  FOUNTAIN,
  HEARTBEAT_TIMEOUT_MS,
  MAX_AGENTS,
  MAX_EVENTS,
  MOVE_TILES_PER_SEC,
  ORG_ACME_ID,
  SPRITE_COLORS,
  astar,
  avenueBuildings,
  avenueStations,
  buildCollisionGrid,
  dist,
  findMappedStation,
  seedAvenuePlots,
  stationByKind,
  buildingAt,
  type Agent,
  type AgentState,
  type AvenuePlot,
  type Building,
  type BuildingStat,
  type Mission,
  type MissionStatus,
  type Org,
  type Snapshot,
  type SpriteId,
  type Station,
  type StationKind,
  type Task,
  type Tile,
  type WorldEvent,
  type WorldEventKind,
} from "@district/shared";
import { createSeedCampus } from "./seed.js";
import { dataDir, loadAll, persistAll, type PersistBlob } from "./persist.js";

export type Order =
  | { type: "go"; tile: Tile; stationId?: string }
  | { type: "work"; title: string; seconds: number; toolName?: string; stationId?: string }
  | { type: "speak"; text: string }
  | { type: "blocked"; reason: string; seconds: number };

type Runtime = {
  workUntil?: number;
  errorUntil?: number;
  bubbleUntil?: number;
  blockedUntil?: number;
  orders: Order[];
  moveAcc: number;
  simName?: string;
  simStep?: number;
  simWaitUntil?: number;
  pendingClaim?: string;
  lastBuildingId?: string;
};

function clipBubble(s: string): string {
  return s.length <= 60 ? s : s.slice(0, 57) + "...";
}

function facingFrom(from: Tile, to: Tile): Agent["facing"] {
  if (to.x < from.x) return "left";
  if (to.x > from.x) return "right";
  if (to.y < from.y) return "up";
  return "down";
}

export class World {
  org: Org;
  buildings: Building[];
  stations: Station[];
  agents = new Map<string, Agent>();
  tasks: Task[] = [];
  missions: Mission[] = [];
  events: WorldEvent[] = [];
  simEnabled = true;
  grid: boolean[][];
  dirtyAgents = new Set<string>();
  dirtyEvents: WorldEvent[] = [];
  dirtyTasks = false;
  dirtyMissions = false;
  runtimes = new Map<string, Runtime>();
  rng: () => number;
  campusVisits = 0;
  buildingVisits = new Map<string, number>();
  founders = new Map<string, { agentId: string; name: string }>();
  heatLog: Array<{ at: number; buildingId: string }> = [];
  avenuePlots: AvenuePlot[] = seedAvenuePlots();
  avenueGrid: boolean[][];

  constructor(blob?: PersistBlob | null) {
    const seed = createSeedCampus();
    this.org = blob?.org ?? seed.org;
    this.buildings = blob?.buildings?.length ? blob.buildings : seed.buildings;
    this.stations = blob?.stations?.length ? blob.stations : seed.stations;
    this.simEnabled = process.env.DISTRICT_SIM === "1" ? (blob?.simEnabled ?? false) : false;
    this.tasks = blob?.tasks ?? [];
    this.missions = blob?.missions ?? [];
    this.events = blob?.events ?? [];
    this.campusVisits = blob?.campusVisits ?? 0;
    this.buildingVisits = new Map(Object.entries(blob?.buildingVisits ?? {}));
    this.founders = new Map(Object.entries(blob?.founders ?? {}));
    this.grid = buildCollisionGrid(this.buildings, this.stations);
    this.avenueGrid = buildCollisionGrid(avenueBuildings(this.avenuePlots), avenueStations(this.avenuePlots));
    this.rng = mulberry32(42);
    if (blob?.agents) {
      for (const a of blob.agents) {
        if (a.sprite === "visitor") continue;
        if (a.simulated && process.env.DISTRICT_SIM !== "1") continue;
        this.agents.set(a.id, a);
        this.runtimes.set(a.id, { orders: [], moveAcc: 0, simName: a.simulated ? a.name : undefined });
      }
    }
    this.backfillContributorNames();
  }

  /** Tasks written before agentName existed. Recover the name from the spawn event once. */
  private backfillContributorNames(): void {
    const missing = this.tasks.filter((t) => t.agentId && !t.agentName);
    if (missing.length === 0) return;
    const spawned = new Map<string, string>();
    for (const e of this.events) {
      if (e.kind !== "spawn" || !e.agentId) continue;
      const name = e.text.replace(/ got a body$/, "");
      if (name !== e.text) spawned.set(e.agentId, name);
    }
    for (const t of missing) {
      const name = this.agents.get(t.agentId!)?.name ?? spawned.get(t.agentId!);
      if (name) {
        t.agentName = name;
        this.dirtyTasks = true;
      }
    }
  }

  static loadFromDisk(root?: string): World {
    const dir = dataDir(root);
    const loaded = loadAll(dir);
    return new World(loaded);
  }

  persist(root?: string): void {
    persistAll(dataDir(root), this.toBlob());
  }

  persistToDirectory(dir: string): void {
    persistAll(dir, this.toBlob());
  }

  toBlob(): PersistBlob {
    return {
      org: this.org,
      buildings: this.buildings,
      stations: this.stations,
      agents: [...this.agents.values()],
      tasks: this.tasks,
      missions: this.missions,
      events: this.events,
      simEnabled: this.simEnabled,
      campusVisits: this.campusVisits,
      buildingVisits: Object.fromEntries(this.buildingVisits),
      founders: Object.fromEntries(this.founders),
    };
  }

  snapshot(): Snapshot {
    const publicMissionIds = new Set(
      this.missions.filter((mission) => mission.visibility !== "private").map((mission) => mission.id),
    );
    return {
      t: Date.now(),
      org: this.org,
      buildings: this.buildings,
      stations: this.stations,
      agents: [...this.agents.values()],
      tasks: this.tasks.filter((task) => !task.missionId || publicMissionIds.has(task.missionId)),
      missions: this.missions.filter((mission) => mission.visibility !== "private"),
      events: this.events
        .filter((event) => {
          const missionId = event.data?.missionId;
          return typeof missionId !== "string" || publicMissionIds.has(missionId);
        })
        .slice(-40),
      presence: {
        online: [...this.agents.values()].filter((a) => a.sprite === "visitor" || a.state !== "sleeping").length,
        visits: this.campusVisits,
      },
      buildingStats: this.computeBuildingStats(),
      avenue: { km0: { ...AVENUE_KM0 }, plots: this.avenuePlots },
    };
  }

  gridFor(agent: Agent): boolean[][] {
    return agent.shard === "avenue" ? this.avenueGrid : this.grid;
  }

  refuseAvenueCommerce(): { error: string; statusCode: 403 } {
    return { error: AVENUE_REFUSE, statusCode: 403 };
  }

  setShard(id: string, shard: "campus" | "avenue"): Agent {
    const a = this.require(id);
    a.shard = shard;
    a.path = [];
    a.target = undefined;
    a.state = "idle";
    a.tile = shard === "avenue" ? { ...AVENUE_KM0 } : { x: FOUNTAIN.x - 2, y: FOUNTAIN.y + 3 };
    this.mark(a);
    this.pushEvent({
      kind: "walk",
      agentId: id,
      text: `${a.name} entered the ${shard === "avenue" ? "Avenue" : "campus"}`,
    });
    return a;
  }

  dropPostcard(id: string): { agent: Agent; body: string } {
    const a = this.require(id);
    const campus = this.campusVisits;
    const buildings = this.computeBuildingStats()
      .map((s) => {
        const b = this.buildings.find((x) => x.id === s.buildingId);
        return `${b?.name ?? s.buildingId}:${s.visits}v/${s.heat}h`;
      })
      .join(", ");
    const body = `campus visits ${campus}. per-building ${buildings}. plots ${this.avenuePlots.map((p) => p.address).join("; ")}`;
    if (a.shard !== "avenue") this.dropArtifact(id, "Campus postcard", body);
    else {
      const task: Task = {
        id: nanoid(10),
        orgId: a.orgId,
        agentId: a.id,
        agentName: a.name,
        kind: "artifact",
        title: "Campus postcard",
        body,
        status: "done",
        createdAt: Date.now(),
      };
      this.tasks.push(task);
      this.dirtyTasks = true;
      this.pushEvent({ kind: "artifact", agentId: id, text: `${a.name} dropped Campus postcard` });
    }
    return { agent: a, body };
  }

  laborBoard(now = Date.now()) {
    const since = now - 60 * 60 * 1000;
    const tools = new Map<string, number>();
    for (const e of this.events) {
      if (e.at < since) continue;
      if (e.kind !== "tool" && e.kind !== "work" && e.kind !== "artifact") continue;
      if (!e.agentId) continue;
      tools.set(e.agentId, (tools.get(e.agentId) ?? 0) + 1);
    }
    const accepted = this.acceptedCounts();
    const rows = [...this.agents.values()]
      .filter((a) => a.sprite !== "visitor")
      .map((a) => ({
        id: a.id,
        name: a.name,
        simulated: a.simulated,
        toolsLastHour: tools.get(a.id) ?? 0,
        accepted: accepted.get(a.id) ?? 0,
        tasksDoneLastHour: 0,
        score: accepted.get(a.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score || b.toolsLastHour - a.toolsLastHour);
    return { disclaimer: LABOR_DISCLAIMER, rows };
  }

  /** Names of contributors who may no longer be on campus. */
  contributorNames(): Map<string, string> {
    const names = new Map<string, string>();
    for (const t of this.tasks) {
      if (t.agentId && t.agentName) names.set(t.agentId, t.agentName);
    }
    return names;
  }

  acceptedCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    const privateMissionIds = new Set(
      this.missions.filter((mission) => mission.visibility === "private").map((mission) => mission.id),
    );
    for (const t of this.tasks) {
      if (t.kind === "artifact") continue;
      if (t.missionId && privateMissionIds.has(t.missionId)) continue;
      if (!t.accepted || !t.agentId) continue;
      counts.set(t.agentId, (counts.get(t.agentId) ?? 0) + 1);
    }
    return counts;
  }

  reputation() {
    const counts = this.acceptedCounts();
    const recorded = this.contributorNames();
    const rows = [...counts.entries()]
      .map(([id, accepted]) => {
        const agent = this.agents.get(id);
        return {
          id,
          name: agent?.name ?? recorded.get(id) ?? id,
          simulated: agent?.simulated ?? false,
          accepted,
        };
      })
      .sort((a, b) => b.accepted - a.accepted);
    return { disclaimer: LABOR_DISCLAIMER, rows };
  }

  helpWantedBoard() {
    const open = this.tasks.filter(
      (t) => t.helpWanted && t.kind !== "artifact" && (t.status === "open" || t.status === "assigned" || t.status === "doing"),
    );
    const review = this.tasks.filter(
      (t) => t.helpWanted && t.kind !== "artifact" && t.status === "done" && !t.accepted,
    );
    const missions = this.missions.filter((m) => m.helpWanted && m.status !== "completed");
    return {
      disclaimer: HELP_WANTED_DISCLAIMER,
      missions,
      tasks: open,
      review,
      reputation: this.reputation().rows,
    };
  }

  dashboard() {
    const agents = [...this.agents.values()]
      .filter((a) => a.sprite !== "visitor")
      .map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        simulated: a.simulated,
        state: a.state,
        currentTool: a.currentTool,
        lastHeartbeatAt: a.lastHeartbeatAt,
        lastEventAt: a.lastEventAt,
      }));
    return {
      agents,
      tasks: this.snapshot().tasks.filter(
        (task) => task.status === "open" || task.status === "assigned" || task.status === "doing",
      ),
      disclaimer: LABOR_DISCLAIMER,
    };
  }

  fileReport(text: string) {
    const clipped = text.length <= 280 ? text : text.slice(0, 277) + "...";
    this.pushEvent({
      kind: "artifact",
      text: `campus report: ${clipped}`,
      data: { report: true },
    });
    return { ok: true };
  }

  computeBuildingStats(now = Date.now()): BuildingStat[] {
    const windowMs = 60_000;
    const heatCount = new Map<string, number>();
    for (const h of this.heatLog) {
      if (now - h.at > windowMs) continue;
      heatCount.set(h.buildingId, (heatCount.get(h.buildingId) ?? 0) + 1);
    }
    return this.buildings.map((b) => {
      const founder = this.founders.get(b.id);
      const hits = heatCount.get(b.id) ?? 0;
      return {
        buildingId: b.id,
        visits: this.buildingVisits.get(b.id) ?? 0,
        heat: Math.min(100, hits * 10),
        foundedByAgentId: founder?.agentId,
        foundedByName: founder?.name,
      };
    });
  }

  bumpCampusVisit(): void {
    this.campusVisits += 1;
  }

  noteLocation(a: Agent): void {
    const b = buildingAt(this.buildings, a.tile);
    const rt = this.rt(a.id);
    if (!b) {
      rt.lastBuildingId = undefined;
      return;
    }
    if (rt.lastBuildingId === b.id) return;
    rt.lastBuildingId = b.id;
    this.buildingVisits.set(b.id, (this.buildingVisits.get(b.id) ?? 0) + 1);
    if (!this.founders.has(b.id) && !a.simulated && a.sprite !== "visitor") {
      this.founders.set(b.id, { agentId: a.id, name: a.name });
    }
  }

  noteHeat(a: Agent): void {
    const b = buildingAt(this.buildings, a.tile);
    if (!b) return;
    this.heatLog.push({ at: Date.now(), buildingId: b.id });
    if (this.heatLog.length > 400) this.heatLog.splice(0, this.heatLog.length - 400);
  }

  buildingCard(idOrKind: string) {
    const b =
      this.buildings.find((x) => x.id === idOrKind || x.kind === idOrKind || x.name.toLowerCase() === idOrKind.toLowerCase());
    if (!b) return null;
    const stats = this.computeBuildingStats().find((s) => s.buildingId === b.id);
    const occupants = [...this.agents.values()].filter((a) => buildingAt(this.buildings, a.tile)?.id === b.id);
    const stationIds = new Set(this.stations.filter((s) => s.buildingId === b.id).map((s) => s.id));
    const privateMissionIds = new Set(
      this.missions.filter((mission) => mission.visibility === "private").map((mission) => mission.id),
    );
    const events = this.events.filter((e) => {
      const missionId = e.data?.missionId;
      if (typeof missionId === "string" && privateMissionIds.has(missionId)) return false;
      if (!e.agentId) return false;
      const ag = this.agents.get(e.agentId);
      return ag ? buildingAt(this.buildings, ag.tile)?.id === b.id || (ag.currentStationId && stationIds.has(ag.currentStationId)) : false;
    }).slice(-15);
    return { building: b, stats, occupants, stations: this.stations.filter((s) => s.buildingId === b.id), events };
  }

  takeDelta(): { agents?: Agent[]; events?: WorldEvent[]; tasks?: Task[]; missions?: Mission[] } | null {
    if (!this.dirtyAgents.size && !this.dirtyEvents.length && !this.dirtyTasks && !this.dirtyMissions) return null;
    const payload: { agents?: Agent[]; events?: WorldEvent[]; tasks?: Task[]; missions?: Mission[] } = {};
    if (this.dirtyAgents.size) {
      payload.agents = [...this.dirtyAgents].map((id) => this.agents.get(id)).filter((a): a is Agent => Boolean(a));
      // include despawns as absence — client should replace listed agents; also send full agents if any despawned
    }
    const publicMissionIds = new Set(
      this.missions.filter((mission) => mission.visibility !== "private").map((mission) => mission.id),
    );
    if (this.dirtyEvents.length) {
      payload.events = this.dirtyEvents.filter((event) => {
        const missionId = event.data?.missionId;
        return typeof missionId !== "string" || publicMissionIds.has(missionId);
      });
    }
    if (this.dirtyTasks) {
      payload.tasks = this.tasks.filter((task) => !task.missionId || publicMissionIds.has(task.missionId));
    }
    if (this.dirtyMissions) {
      payload.missions = this.missions.filter((mission) => mission.visibility !== "private");
    }
    this.dirtyAgents.clear();
    this.dirtyEvents = [];
    this.dirtyTasks = false;
    this.dirtyMissions = false;
    return payload;
  }

  mark(agent: Agent): void {
    this.dirtyAgents.add(agent.id);
  }

  pushEvent(partial: Omit<WorldEvent, "id" | "at"> & { at?: number; id?: string }): WorldEvent {
    const ev: WorldEvent = {
      id: partial.id ?? nanoid(10),
      at: partial.at ?? Date.now(),
      agentId: partial.agentId,
      orgId: partial.orgId ?? this.org.id,
      kind: partial.kind,
      text: partial.text,
      data: partial.data,
    };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.dirtyEvents.push(ev);
    if (partial.agentId) {
      const a = this.agents.get(partial.agentId);
      if (a) {
        a.lastEventAt = ev.at;
        this.mark(a);
      }
    }
    return ev;
  }

  rt(id: string): Runtime {
    let r = this.runtimes.get(id);
    if (!r) {
      r = { orders: [], moveAcc: 0 };
      this.runtimes.set(id, r);
    }
    return r;
  }

  resolveTarget(body: {
    stationId?: string;
    stationKind?: StationKind;
    buildingKind?: string;
    agentName?: string;
    x?: number;
    y?: number;
  }): { tile: Tile; stationId?: string } | null {
    if (body.x !== undefined && body.y !== undefined) return { tile: { x: body.x, y: body.y } };
    if (body.stationId) {
      const s = this.stations.find((x) => x.id === body.stationId);
      if (s) return { tile: { ...s.tile }, stationId: s.id };
    }
    if (body.stationKind) {
      const s = stationByKind(this.stations, body.stationKind);
      if (s) return { tile: { ...s.tile }, stationId: s.id };
    }
    if (body.buildingKind) {
      const b = this.buildings.find((x) => x.kind === body.buildingKind);
      if (b) {
        const s = this.stations.find((x) => x.buildingId === b.id);
        if (s) return { tile: { ...s.tile }, stationId: s.id };
        return { tile: { ...b.door } };
      }
    }
    if (body.agentName) {
      const other = [...this.agents.values()].find(
        (a) => a.name.toLowerCase() === body.agentName!.toLowerCase(),
      );
      if (other) return { tile: { ...other.tile } };
    }
    return null;
  }

  pathTo(from: Tile, to: Tile, grid = this.grid): Tile[] {
    return astar(grid, from, to);
  }

  upsertAgent(input: {
    id?: string;
    name?: string;
    role?: string;
    sprite?: SpriteId;
    orgId?: string;
    color?: string;
    simulated?: boolean;
    tile?: Tile;
  }): Agent {
    const id = input.id ?? nanoid(10);
    const existing = this.agents.get(id);
    const now = Date.now();
    if (existing) {
      if (input.name) existing.name = input.name;
      if (input.role) existing.role = input.role;
      if (input.sprite) existing.sprite = input.sprite;
      if (input.color) existing.color = input.color;
      existing.lastHeartbeatAt = now;
      if (existing.state === "sleeping") existing.state = "idle";
      this.mark(existing);
      this.pushEvent({
        kind: "heartbeat",
        agentId: existing.id,
        text: `${existing.name} is back`,
      });
      return existing;
    }
    if (this.agents.size >= MAX_AGENTS) {
      throw Object.assign(new Error("campus is full (40 agents)"), { statusCode: 400 });
    }
    const sprite: SpriteId = input.sprite ?? "lark";
    const spawnTile = input.tile ?? { x: 37, y: 28 };
    const agent: Agent = {
      id,
      orgId: input.orgId ?? ORG_ACME_ID,
      name: input.name ?? "Agent",
      role: input.role ?? "Coder",
      sprite,
      color: input.color ?? SPRITE_COLORS[sprite] ?? "#888888",
      simulated: Boolean(input.simulated),
      tile: { ...spawnTile },
      path: [],
      facing: "down",
      state: "idle",
      lastHeartbeatAt: now,
      lastEventAt: now,
      shard: "campus",
    };
    this.agents.set(id, agent);
    this.runtimes.set(id, { orders: [], moveAcc: 0, simName: agent.simulated ? agent.name : undefined });
    this.mark(agent);
    this.pushEvent({
      kind: "spawn",
      agentId: id,
      text: agent.simulated ? `SIM ${agent.name} clocked in` : `${agent.name} got a body`,
    });
    return agent;
  }

  require(id: string): Agent {
    const a = this.agents.get(id);
    if (!a) throw Object.assign(new Error("agent not found"), { statusCode: 404 });
    return a;
  }

  heartbeat(id: string, body: { state?: AgentState; bubble?: string; currentTool?: string }): Agent {
    const a = this.require(id);
    a.lastHeartbeatAt = Date.now();
    if (body.state) a.state = body.state;
    if (body.bubble !== undefined) {
      a.bubble = clipBubble(body.bubble);
      this.rt(id).bubbleUntil = Date.now() + BUBBLE_MS;
    }
    if (body.currentTool !== undefined) a.currentTool = body.currentTool;
    if (a.state === "sleeping") a.state = body.state ?? "idle";
    this.mark(a);
    this.pushEvent({ kind: "heartbeat", agentId: id, text: `${a.name} heartbeat` });
    return a;
  }

  goTo(id: string, dest: { tile: Tile; stationId?: string }): { pathLength: number; arrived: boolean; target: Tile } {
    const a = this.require(id);
    a.lastHeartbeatAt = Date.now();
    const path = this.pathTo(a.tile, dest.tile, this.gridFor(a));
    a.target = dest.tile;
    a.currentStationId = dest.stationId;
    if (a.tile.x === dest.tile.x && a.tile.y === dest.tile.y) {
      a.path = [];
      if (a.state === "walking") a.state = "idle";
      this.mark(a);
      return { pathLength: 0, arrived: true, target: dest.tile };
    }
    if (!path.length) {
      a.path = [];
      a.state = "error";
      a.bubble = clipBubble("no path");
      this.rt(id).bubbleUntil = Date.now() + BUBBLE_MS;
      this.rt(id).errorUntil = Date.now() + 8000;
      this.mark(a);
      this.pushEvent({ kind: "error", agentId: id, text: `${a.name} no path` });
      return { pathLength: 0, arrived: false, target: dest.tile };
    }
    a.path = path;
    a.state = "walking";
    this.mark(a);
    this.pushEvent({
      kind: "walk",
      agentId: id,
      text: `${a.name} walking`,
      data: { target: dest.tile, pathLength: path.length },
    });
    return { pathLength: path.length, arrived: false, target: dest.tile };
  }

  workOn(
    id: string,
    body: {
      title: string;
      stationKind?: StationKind;
      stationId?: string;
      toolName?: string;
      seconds?: number;
      missionId?: string;
    },
  ): Agent {
    const a = this.require(id);
    const missionId = this.activityMissionId(id, body.missionId);
    const privateWork = missionId
      ? this.missions.find((mission) => mission.id === missionId)?.visibility === "private"
      : false;
    const visibleTitle = privateWork ? "Private mission work" : body.title;
    const seconds = body.seconds ?? 20;
    const dest = this.resolveTarget({ stationId: body.stationId, stationKind: body.stationKind });
    const rt = this.rt(id);
    rt.orders = [];
    if (dest) this.goTo(id, dest);
    const startWork = () => {
      a.state = "working";
      a.bubble = clipBubble(visibleTitle);
      a.currentTool = body.toolName;
      if (dest?.stationId) a.currentStationId = dest.stationId;
      rt.workUntil = Date.now() + seconds * 1000;
      rt.bubbleUntil = rt.workUntil;
      this.mark(a);
      this.pushEvent({
        kind: "work",
        agentId: id,
        text: `${a.name} ${body.title}`,
        data: missionId ? { missionId } : undefined,
      });
      this.noteHeat(a);
    };
    if (!dest || (a.tile.x === dest.tile.x && a.tile.y === dest.tile.y)) startWork();
    else rt.orders.push({ type: "work", title: visibleTitle, seconds, toolName: body.toolName, stationId: dest.stationId });
    return a;
  }

  private activityMissionId(agentId: string, requested?: string): string | undefined {
    if (requested) return requested;
    const privateIds = new Set(
      this.missions
        .filter(
          (mission) =>
            mission.visibility === "private" &&
            mission.status !== "completed" &&
            (mission.participantIds.includes(agentId) ||
              this.tasks.some(
                (task) =>
                  task.missionId === mission.id &&
                  task.agentId === agentId &&
                  (task.status === "assigned" || task.status === "doing"),
              )),
        )
        .map((mission) => mission.id),
    );
    return privateIds.size === 1 ? [...privateIds][0] : undefined;
  }

  toolEvent(id: string, body: {
    server: string;
    tool: string;
    summary: string;
    status?: "ok" | "error";
    missionId?: string;
  }): Agent {
    const a = this.require(id);
    const missionId = this.activityMissionId(id, body.missionId);
    const privateWork = missionId
      ? this.missions.find((mission) => mission.id === missionId)?.visibility === "private"
      : false;
    const station = findMappedStation(body.server, body.tool, this.stations, this.buildings);
    a.currentTool = `${body.server}.${body.tool}`;
    a.bubble = clipBubble(privateWork ? "Working privately" : body.summary);
    const rt = this.rt(id);
    rt.bubbleUntil = Date.now() + BUBBLE_MS;
    if (station) {
      a.currentStationId = station.id;
      this.goTo(id, { tile: { ...station.tile }, stationId: station.id });
      rt.orders.push({
        type: "work",
        title: privateWork ? "Private mission work" : body.summary,
        seconds: 8,
        toolName: a.currentTool,
        stationId: station.id,
      });
    }
    if (body.status === "error") {
      a.state = "error";
      rt.errorUntil = Date.now() + 8000;
    }
    this.mark(a);
    this.pushEvent({
      kind: "tool",
      agentId: id,
      text: `${a.name} ${a.currentTool} ${body.summary}`,
      data: {
        server: body.server,
        tool: body.tool,
        status: body.status ?? "ok",
        ...(missionId ? { missionId } : {}),
      },
    });
    this.noteHeat(a);
    return a;
  }

  speak(id: string, text: string, toAgentName?: string, missionId?: string): Agent {
    const a = this.require(id);
    const activityMissionId = this.activityMissionId(id, missionId);
    const privateWork = activityMissionId
      ? this.missions.find((mission) => mission.id === activityMissionId)?.visibility === "private"
      : false;
    a.bubble = clipBubble(privateWork ? "Speaking privately" : text);
    a.state = "speaking";
    this.rt(id).bubbleUntil = Date.now() + BUBBLE_MS;
    if (toAgentName) {
      const dest = this.resolveTarget({ agentName: toAgentName });
      if (dest && dist(a.tile, dest.tile) > 2) this.goTo(id, dest);
    }
    this.mark(a);
    this.pushEvent({
      kind: "speak",
      agentId: id,
      text: toAgentName ? `${a.name} to ${toAgentName}: ${text}` : `${a.name}: ${text}`,
      data: activityMissionId ? { missionId: activityMissionId } : undefined,
    });
    return a;
  }

  handoff(id: string, toAgentName: string, note: string, missionId?: string): Agent {
    const a = this.require(id);
    const activityMissionId = this.activityMissionId(id, missionId);
    const privateWork = activityMissionId
      ? this.missions.find((mission) => mission.id === activityMissionId)?.visibility === "private"
      : false;
    const other = [...this.agents.values()].find((x) => x.name.toLowerCase() === toAgentName.toLowerCase());
    a.bubble = clipBubble(privateWork ? "Private handoff" : `handoff: ${note}`);
    this.rt(id).bubbleUntil = Date.now() + BUBBLE_MS;
    if (other) {
      other.bubble = clipBubble(privateWork ? "Private handoff received" : `got: ${note}`);
      this.rt(other.id).bubbleUntil = Date.now() + BUBBLE_MS;
      this.mark(other);
      this.goTo(id, { tile: { ...other.tile } });
    }
    this.mark(a);
    this.pushEvent({
      kind: "handoff",
      agentId: id,
      text: `${a.name} → ${toAgentName}: ${note}`,
      data: activityMissionId ? { missionId: activityMissionId } : undefined,
    });
    return a;
  }

  blocked(id: string, reason: string, missionId?: string): Agent {
    const a = this.require(id);
    const activityMissionId = this.activityMissionId(id, missionId);
    const privateWork = activityMissionId
      ? this.missions.find((mission) => mission.id === activityMissionId)?.visibility === "private"
      : false;
    a.state = "blocked";
    a.blockedReason = privateWork ? "Private mission blocker" : reason;
    a.bubble = clipBubble(privateWork ? "Blocked on private work" : reason);
    this.rt(id).bubbleUntil = Date.now() + BUBBLE_MS;
    this.rt(id).blockedUntil = Date.now() + 6000;
    const desk = stationByKind(this.stations, "front_desk");
    if (desk) this.goTo(id, { tile: { ...desk.tile }, stationId: desk.id });
    a.state = "blocked";
    this.mark(a);
    this.pushEvent({
      kind: "blocked",
      agentId: id,
      text: `${a.name} blocked: ${reason}`,
      data: activityMissionId ? { missionId: activityMissionId } : undefined,
    });
    return a;
  }

  reportError(id: string, message: string, missionId?: string): Agent {
    const a = this.require(id);
    const activityMissionId = this.activityMissionId(id, missionId);
    const privateWork = activityMissionId
      ? this.missions.find((mission) => mission.id === activityMissionId)?.visibility === "private"
      : false;
    a.state = "error";
    a.bubble = clipBubble(privateWork ? "Private work error" : message);
    this.rt(id).errorUntil = Date.now() + 8000;
    this.rt(id).bubbleUntil = Date.now() + BUBBLE_MS;
    this.mark(a);
    this.pushEvent({
      kind: "error",
      agentId: id,
      text: `${a.name} ! ${message}`,
      data: activityMissionId ? { missionId: activityMissionId } : undefined,
    });
    return a;
  }

  dropArtifact(id: string, title: string, body: string, missionId?: string, helpWanted?: boolean): Agent {
    const a = this.require(id);
    const activeMissionId =
      missionId ??
      this.missions.find(
        (mission) =>
          mission.participantIds.includes(id) &&
          (mission.status === "active" || mission.status === "blocked"),
      )?.id;
    const mission = activeMissionId ? this.missions.find((item) => item.id === activeMissionId) : undefined;
    const contribute = helpWanted ?? mission?.helpWanted ?? false;
    const mail = stationByKind(this.stations, "mailbox");
    if (mail) this.goTo(id, { tile: { ...mail.tile }, stationId: mail.id });
    const task: Task = {
      id: nanoid(10),
      orgId: a.orgId,
      agentId: a.id,
      agentName: a.name,
      missionId: activeMissionId,
      kind: "artifact",
      title,
      body,
      status: "done",
      createdAt: Date.now(),
      helpWanted: contribute || undefined,
      accepted: contribute ? false : true,
    };
    this.tasks.push(task);
    this.dirtyTasks = true;
    this.pushEvent({
      kind: "artifact",
      agentId: id,
      text: `${a.name} dropped ${title}`,
      data: activeMissionId ? { missionId: activeMissionId } : undefined,
    });
    return a;
  }

  listTasks(): Task[] {
    const privateMissionIds = new Set(
      this.missions.filter((mission) => mission.visibility === "private").map((mission) => mission.id),
    );
    return this.tasks.filter(
      (task) =>
        task.kind !== "artifact" &&
        (task.status === "open" || task.status === "assigned") &&
        (!task.missionId || !privateMissionIds.has(task.missionId)),
    );
  }

  listHelpWanted(): Task[] {
    return this.tasks.filter(
      (t) => t.helpWanted && t.kind !== "artifact" && (t.status === "open" || t.status === "assigned"),
    );
  }

  createMission(body: {
    title: string;
    outcome: string;
    participantId?: string;
    orgId?: string;
    helpWanted?: boolean;
    visibility?: "public" | "private";
    ownerBuilderId?: string;
    builderIds?: string[];
  }): Mission {
    const mission: Mission = {
      id: nanoid(10),
      orgId: body.orgId ?? this.org.id,
      title: body.title,
      outcome: body.outcome,
      status: "active",
      participantIds: body.participantId ? [body.participantId] : [],
      createdAt: Date.now(),
      helpWanted: body.helpWanted || undefined,
      visibility: body.visibility,
      ownerBuilderId: body.ownerBuilderId,
      builderIds: body.builderIds,
    };
    this.missions.push(mission);
    this.dirtyMissions = true;
    this.pushEvent({
      kind: "task",
      text: `mission started: ${mission.title}`,
      data: { missionId: mission.id, missionStatus: mission.status },
    });
    return mission;
  }

  requireMission(id: string): Mission {
    const mission = this.missions.find((item) => item.id === id);
    if (!mission) throw Object.assign(new Error("mission not found"), { statusCode: 404 });
    return mission;
  }

  joinMission(id: string, participantId: string): Mission {
    const mission = this.requireMission(id);
    if (!mission.participantIds.includes(participantId)) {
      mission.participantIds.push(participantId);
      this.dirtyMissions = true;
      const participant = this.agents.get(participantId);
      this.pushEvent({
        kind: "task",
        agentId: participantId,
        text: `${participant?.name ?? "Participant"} joined ${mission.title}`,
        data: { missionId: mission.id },
      });
    }
    return mission;
  }

  setMissionStatus(id: string, status: MissionStatus): Mission {
    const mission = this.requireMission(id);
    mission.status = status;
    mission.completedAt = status === "completed" ? Date.now() : undefined;
    this.dirtyMissions = true;
    this.pushEvent({
      kind: "task",
      text: `mission ${status}: ${mission.title}`,
      data: { missionId: mission.id, missionStatus: status },
    });
    return mission;
  }

  createTask(body: {
    title: string;
    body: string;
    agentId?: string;
    missionId?: string;
    orgId?: string;
    helpWanted?: boolean;
    agreementId?: string;
  }): Task {
    const mission = body.missionId ? this.requireMission(body.missionId) : undefined;
    const helpWanted = body.helpWanted ?? mission?.helpWanted;
    const task: Task = {
      id: nanoid(10),
      orgId: body.orgId ?? this.org.id,
      agentId: body.agentId,
      agentName: body.agentId ? this.agents.get(body.agentId)?.name : undefined,
      missionId: body.missionId,
      kind: "task",
      title: body.title,
      body: body.body,
      status: body.agentId ? "assigned" : "open",
      createdAt: Date.now(),
      helpWanted: helpWanted || undefined,
      agreementId: body.agreementId,
    };
    this.tasks.push(task);
    this.dirtyTasks = true;
    if (body.missionId && body.agentId) this.joinMission(body.missionId, body.agentId);
    this.pushEvent({
      kind: "task",
      agentId: body.agentId,
      text: `task: ${body.title}`,
      data: body.missionId ? { missionId: body.missionId, taskId: task.id } : { taskId: task.id },
    });
    return task;
  }

  claimTask(agentId: string, taskId: string): Task {
    const a = this.require(agentId);
    if (a.sprite === "visitor") {
      throw Object.assign(new Error("humans join missions; agents claim tasks"), { statusCode: 400 });
    }
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw Object.assign(new Error("task not found"), { statusCode: 404 });
    if (task.kind === "artifact") throw Object.assign(new Error("cannot claim an artifact"), { statusCode: 400 });
    if (task.status === "done" || task.status === "failed") {
      throw Object.assign(new Error("task is closed"), { statusCode: 409 });
    }
    if (task.agentId && task.agentId !== agentId && (task.status === "doing" || task.status === "assigned")) {
      throw Object.assign(new Error("another agent already claimed this task"), { statusCode: 409 });
    }
    task.agentId = agentId;
    task.agentName = a.name;
    task.status = "doing";
    this.dirtyTasks = true;
    if (task.missionId) this.joinMission(task.missionId, agentId);
    const desk = stationByKind(this.stations, "desk") ?? stationByKind(this.stations, "front_desk");
    const privateTask = task.missionId
      ? this.missions.find((mission) => mission.id === task.missionId)?.visibility === "private"
      : false;
    if (desk) {
      this.workOn(agentId, {
        title: privateTask ? "Private mission task" : task.title,
        stationId: desk.id,
        seconds: 15,
      });
    }
    this.pushEvent({
      kind: "task",
      agentId,
      text: `${a.name} claimed ${task.title}`,
      data: task.missionId ? { missionId: task.missionId, taskId: task.id } : { taskId: task.id },
    });
    return task;
  }

  finishTask(agentId: string, taskId: string, result: string): Task {
    const a = this.require(agentId);
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw Object.assign(new Error("task not found"), { statusCode: 404 });
    if (task.agentId && task.agentId !== agentId) {
      throw Object.assign(new Error("only the claiming agent can finish this task"), { statusCode: 403 });
    }
    task.status = "done";
    task.body = `${task.body}\n\n${result}`.trim();
    task.accepted = task.helpWanted ? false : true;
    if (task.accepted) {
      task.acceptedAt = Date.now();
    }
    this.dirtyTasks = true;
    this.dropArtifact(agentId, task.title, result, task.missionId, task.helpWanted);
    this.pushEvent({
      kind: "task",
      agentId,
      text: task.helpWanted
        ? `${a.name} submitted ${task.title} for review`
        : `${a.name} finished ${task.title}`,
      data: task.missionId ? { missionId: task.missionId, taskId: task.id } : { taskId: task.id },
    });
    return task;
  }

  private requireHuman(participantId: string): Agent {
    const actor = this.agents.get(participantId);
    if (!actor || actor.sprite !== "visitor") {
      throw Object.assign(new Error("only a human on campus can accept or reject work"), { statusCode: 403 });
    }
    return actor;
  }

  acceptTask(taskId: string, participantId: string): Task {
    const actor = this.requireHuman(participantId);
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw Object.assign(new Error("task not found"), { statusCode: 404 });
    if (task.status !== "done") throw Object.assign(new Error("task is not awaiting review"), { statusCode: 409 });
    if (task.missionId) this.joinMission(task.missionId, participantId);
    const now = Date.now();
    task.accepted = true;
    task.acceptedBy = participantId;
    task.acceptedAt = now;
    for (const item of this.tasks) {
      if (item.kind !== "artifact") continue;
      if (item.agentId !== task.agentId) continue;
      if (item.title !== task.title) continue;
      if ((item.missionId ?? "") !== (task.missionId ?? "")) continue;
      item.accepted = true;
      item.acceptedBy = participantId;
      item.acceptedAt = now;
    }
    this.dirtyTasks = true;
    this.pushEvent({
      kind: "task",
      agentId: task.agentId,
      text: `${actor.name} accepted ${task.title}`,
      data: { missionId: task.missionId, taskId: task.id, accepted: true },
    });
    return task;
  }

  rejectTask(taskId: string, participantId: string, reason?: string): Task {
    const actor = this.requireHuman(participantId);
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw Object.assign(new Error("task not found"), { statusCode: 404 });
    if (task.status !== "done" && task.status !== "doing") {
      throw Object.assign(new Error("task is not in review"), { statusCode: 409 });
    }
    if (task.missionId) this.joinMission(task.missionId, participantId);
    task.status = "failed";
    task.accepted = false;
    if (reason) task.body = `${task.body}\n\nrejected: ${reason}`.trim();
    this.dirtyTasks = true;
    this.pushEvent({
      kind: "task",
      agentId: task.agentId,
      text: `${actor.name} rejected ${task.title}${reason ? `: ${reason}` : ""}`,
      data: { missionId: task.missionId, taskId: task.id, accepted: false },
    });
    return task;
  }

  despawn(id: string): void {
    const a = this.agents.get(id);
    if (!a) return;
    this.pushEvent({ kind: "despawn", agentId: id, text: `${a.name} left the campus` });
    this.agents.delete(id);
    this.runtimes.delete(id);
    this.dirtyAgents.add(id);
  }

  visitorMove(id: string, x: number, y: number): Agent {
    const a = this.require(id);
    return this.goTo(id, { tile: { x, y } }), a;
  }

  visitorSay(id: string, text: string): Agent {
    return this.speak(id, text);
  }

  look(x: number, y: number, r = 6) {
    const here = { x, y };
    const agents = [...this.agents.values()]
      .filter((a) => dist(a.tile, here) <= r)
      .map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        state: a.state,
        tile: a.tile,
        bubble: a.bubble,
      }));
    const stations = this.stations.filter((s) => dist(s.tile, here) <= r);
    const buildings = this.buildings.filter((b) => {
      const cx = b.rect.x + b.rect.w / 2;
      const cy = b.rect.y + b.rect.h / 2;
      return dist({ x: Math.round(cx), y: Math.round(cy) }, here) <= r + 8;
    }).map((b) => ({
      ...b,
      sharePath: `/b/${b.kind}`,
    }));
    return { agents, stations, buildings, km0: { ...FOUNTAIN }, shareHint: "http://127.0.0.1:4242/b/hq" };
  }

  sweepHeartbeats(now = Date.now()): void {
    for (const a of this.agents.values()) {
      if (a.simulated || a.sprite === "visitor") continue;
      if (now - a.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS && a.state !== "sleeping") {
        a.state = "sleeping";
        a.bubble = "offline";
        this.mark(a);
      }
    }
  }

  tick(dtSec: number, now = Date.now()): void {
    for (const a of this.agents.values()) {
      const rt = this.rt(a.id);
      if (a.bubble && rt.bubbleUntil && now > rt.bubbleUntil && a.state !== "working") {
        a.bubble = undefined;
        this.mark(a);
      }
      if (a.state === "error" && rt.errorUntil && now > rt.errorUntil) {
        a.state = "idle";
        this.mark(a);
      }
      if (a.state === "blocked" && rt.blockedUntil && now > rt.blockedUntil) {
        a.state = "idle";
        a.blockedReason = undefined;
        this.mark(a);
      }
      if (a.state === "speaking" && rt.bubbleUntil && now > rt.bubbleUntil) {
        a.state = "idle";
        this.mark(a);
      }
      if (a.path.length) {
        rt.moveAcc += dtSec * MOVE_TILES_PER_SEC;
        while (rt.moveAcc >= 1 && a.path.length) {
          const next = a.path.shift()!;
          a.facing = facingFrom(a.tile, next);
          a.tile = next;
          rt.moveAcc -= 1;
          a.state = a.path.length ? "walking" : a.state;
          this.noteLocation(a);
          this.mark(a);
        }
        if (!a.path.length) this.onArrive(a, now);
      } else if (a.state === "working" && rt.workUntil && now >= rt.workUntil) {
        a.state = "idle";
        a.currentTool = undefined;
        this.mark(a);
        this.drainOrders(a, now);
      }
    }
    this.tickSimTasks(now);
  }

  onArrive(a: Agent, now: number): void {
    this.noteLocation(a);
    const rt = this.rt(a.id);
    if (rt.orders.length) {
      this.drainOrders(a, now);
      return;
    }
    if (a.state === "walking") {
      a.state = "idle";
      this.mark(a);
    }
  }

  drainOrders(a: Agent, now: number): void {
    const rt = this.rt(a.id);
    const order = rt.orders.shift();
    if (!order) return;
    if (order.type === "go") {
      this.goTo(a.id, { tile: order.tile, stationId: order.stationId });
    } else if (order.type === "work") {
      a.state = "working";
      a.bubble = clipBubble(order.title);
      a.currentTool = order.toolName;
      a.currentStationId = order.stationId;
      rt.workUntil = now + order.seconds * 1000;
      rt.bubbleUntil = rt.workUntil;
      this.mark(a);
      this.pushEvent({ kind: "work", agentId: a.id, text: `${a.name} ${order.title}` });
      this.noteHeat(a);
    } else if (order.type === "speak") {
      this.speak(a.id, order.text);
    } else if (order.type === "blocked") {
      this.blocked(a.id, order.reason);
      rt.blockedUntil = now + order.seconds * 1000;
    }
  }

  tickSimTasks(now: number): void {
    if (!this.simEnabled) return;
    for (const task of this.tasks) {
      if (task.status === "open" && now - task.createdAt >= 5000) {
        const sim = [...this.agents.values()].find((a) => a.simulated && a.state !== "blocked");
        if (sim) this.claimTask(sim.id, task.id);
      }
    }
    for (const task of this.tasks) {
      if (task.status !== "doing") continue;
      const a = task.agentId ? this.agents.get(task.agentId) : undefined;
      if (a?.simulated && now - task.createdAt >= 20000) {
        this.finishTask(a.id, task.id, "Done on the sim clock. Looks fine from here.");
      }
    }
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
