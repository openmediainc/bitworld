import Phaser from "phaser";
import {
  FOUNTAIN,
  MAP_H,
  MAP_W,
  TILE_SIZE,
  astar,
  buildCollisionGrid,
  dist,
  furnitureTile,
  buildingAt,
  type Agent,
  type Snapshot,
  type Station,
  type Tile,
} from "@district/shared";
import { bindCamera, centerAvenue, centerFountain } from "./camera";
import { ensureSpriteTextures } from "./sprites";
import { addRoofLabels, drawAvenue, drawCampus, hashBuildings, makeFountainSparkle } from "./tiles";
import { pixelTextTexture } from "./font";

export type SceneHooks = {
  onSelectAgent: (id: string | null) => void;
  onSelectStation: (id: string | null) => void;
  onSelectBuilding?: (id: string | null) => void;
  onInteract: (kind: "agent" | "station" | "desk", id: string) => void;
  sendMove: (x: number, y: number) => void;
  onHelp: () => void;
  onFollow: (id: string | null) => void;
  visitorId?: string;
};

type SpritePack = {
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  heat: Phaser.GameObjects.Rectangle;
  labelKey: string;
};

export class DistrictScene extends Phaser.Scene {
  hooks: SceneHooks = {
    onSelectAgent: () => undefined,
    onSelectStation: () => undefined,
    onInteract: () => undefined,
    sendMove: () => undefined,
    onHelp: () => undefined,
    onFollow: () => undefined,
  };
  snapshot: Snapshot | null = null;
  grid: boolean[][] = [];
  sprites = new Map<string, SpritePack>();
  selectedId: string | null = null;
  followId: string | null = null;
  buildingHash = "";
  viewShard: "campus" | "avenue" = "campus";
  roofLabels: Phaser.GameObjects.Image[] = [];
  mapRt?: Phaser.GameObjects.RenderTexture;
  selRect?: Phaser.GameObjects.Rectangle;
  night?: Phaser.GameObjects.Rectangle;
  leds: Phaser.GameObjects.Rectangle[] = [];
  heatGlow: Phaser.GameObjects.Rectangle[] = [];
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  stepAcc = 0;
  lastStepAt = 0;
  zAcc = 0;

  constructor() {
    super("district");
  }

  create(): void {
    ensureSpriteTextures(this);
    this.cameras.main.setBackgroundColor("#2F6B38");
    this.cameras.main.roundPixels = true;
    bindCamera(this);
    this.selRect = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE).setStrokeStyle(1, 0xffffff).setDepth(8).setVisible(false);
    this.night = this.add
      .rectangle((MAP_W * TILE_SIZE) / 2, (MAP_H * TILE_SIZE) / 2, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE, 0x081018, 0)
      .setDepth(19);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D,E,C,H,SPACE,ENTER,ESC,ONE") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (p.getDistance() > 6) return;
      const tile = this.worldToTile(p.worldX, p.worldY);
      const agent = this.agentAt(tile);
      if (agent) {
        this.selectedId = agent.id;
        this.hooks.onSelectAgent(agent.id);
        return;
      }
      const station = this.stationAt(tile);
      if (station) {
        this.hooks.onSelectStation(station.id);
        return;
      }
      const bldg = this.snapshot
        ? this.viewShard === "avenue"
          ? this.snapshot.avenue?.plots.find(
              (p) => tile.x >= p.rect.x && tile.y >= p.rect.y && tile.x < p.rect.x + p.rect.w && tile.y < p.rect.y + p.rect.h,
            )
          : buildingAt(this.snapshot.buildings, tile)
        : undefined;
      if (bldg) {
        this.hooks.onSelectBuilding?.(bldg.id);
        return;
      }
      const visitor = this.visitor();
      if (visitor) {
        const path = astar(this.grid, visitor.tile, tile);
        if (path.length || (visitor.tile.x === tile.x && visitor.tile.y === tile.y)) {
          this.hooks.sendMove(tile.x, tile.y);
        }
      } else {
        this.hooks.sendMove(tile.x, tile.y);
      }
    });
    const kb = this.input.keyboard!;
    kb.on("keydown-C", () => {
      if (this.viewShard === "avenue") centerAvenue(this);
      else centerFountain(this);
    });
    kb.on("keydown-H", () => this.hooks.onHelp());
    kb.on("keydown-ESC", () => this.hooks.onSelectAgent(null));
    kb.on("keydown-SPACE", () => {
      const next = this.followId ? null : this.selectedId;
      this.followId = next;
      this.hooks.onFollow(next);
    });
    kb.on("keydown-ONE", () => {
      if (this.selectedId) {
        this.followId = this.selectedId;
        this.hooks.onFollow(this.selectedId);
        this.cameras.main.setZoom(4);
      }
    });
    kb.on("keydown-E", () => this.interact());
    kb.on("keydown-ENTER", () => this.interact());
    kb.on("keydown-W", () => this.tryStep(0, -1));
    kb.on("keydown-A", () => this.tryStep(-1, 0));
    kb.on("keydown-S", () => this.tryStep(0, 1));
    kb.on("keydown-D", () => this.tryStep(1, 0));
    kb.on("keydown-UP", () => this.tryStep(0, -1));
    kb.on("keydown-LEFT", () => this.tryStep(-1, 0));
    kb.on("keydown-DOWN", () => this.tryStep(0, 1));
    kb.on("keydown-RIGHT", () => this.tryStep(1, 0));
  }

  visitor(): Agent | undefined {
    return (
      this.snapshot?.agents.find((a) => a.sprite === "visitor" && a.id === this.hooks.visitorId) ??
      this.snapshot?.agents.find((a) => a.sprite === "visitor")
    );
  }

  applySnapshot(snap: Snapshot): void {
    this.snapshot = snap;
    const shardKey = this.viewShard;
    const h =
      shardKey === "avenue"
        ? `avenue|${(snap.avenue?.plots ?? []).map((p) => p.id).join(",")}`
        : hashBuildings(snap.buildings);
    if (h !== this.buildingHash) {
      this.mapRt?.destroy();
      for (const img of this.roofLabels) img.destroy();
      this.roofLabels = [];
      if (shardKey === "avenue" && snap.avenue) {
        this.mapRt = drawAvenue(this, snap.avenue.plots);
        this.roofLabels = addRoofLabels(
          this,
          snap.avenue.plots.map((p) => ({
            id: p.id,
            orgId: p.orgId ?? "org_empty",
            name: p.orgName,
            kind: "house" as const,
            rect: p.rect,
            door: p.door,
          })),
        );
        this.grid = buildCollisionGrid(
          snap.avenue.plots.map((p) => ({
            id: p.id,
            orgId: p.orgId ?? "org_empty",
            name: p.orgName,
            kind: "house" as const,
            rect: p.rect,
            door: p.door,
          })),
          [],
        );
      } else {
        this.mapRt = drawCampus(this, snap.buildings, snap.stations);
        this.roofLabels = addRoofLabels(this, snap.buildings);
        makeFountainSparkle(this);
        this.placeLeds(snap);
        this.grid = buildCollisionGrid(snap.buildings, snap.stations);
      }
      this.buildingHash = h;
    }
    if (shardKey === "campus") this.paintHeat(snap);
    const visible = snap.agents.filter((a) => (a.shard ?? "campus") === this.viewShard || a.sprite === "visitor");
    const seen = new Set<string>();
    for (const a of visible) {
      if (a.sprite !== "visitor" && (a.shard ?? "campus") !== this.viewShard) continue;
      seen.add(a.id);
      this.upsertAgent(a);
    }
    for (const [id, pack] of this.sprites) {
      if (!seen.has(id)) this.destroyPack(id, pack);
    }
  }

  setViewShard(shard: "campus" | "avenue"): void {
    this.viewShard = shard;
    this.buildingHash = "";
    if (this.snapshot) this.applySnapshot(this.snapshot);
  }

  placeLeds(snap: Snapshot): void {
    for (const led of this.leds) led.destroy();
    this.leds = [];
    for (const s of snap.stations) {
      if (s.kind !== "server_rack") continue;
      const furn = furnitureTile(s, snap.buildings);
      if (!furn) continue;
      const led = this.add.rectangle(furn.x * TILE_SIZE + 6, furn.y * TILE_SIZE + 4, 2, 2, 0x3e8948).setDepth(4);
      this.leds.push(led);
    }
  }

  paintHeat(snap: Snapshot): void {
    for (const g of this.heatGlow) g.destroy();
    this.heatGlow = [];
    const stats = snap.buildingStats ?? [];
    for (const b of snap.buildings) {
      if (b.kind === "plaza") continue;
      const heat = stats.find((s) => s.buildingId === b.id)?.heat ?? 0;
      if (heat <= 0) continue;
      const extra = Math.ceil(heat / 40);
      const g = this.add
        .rectangle(
          (b.rect.x + b.rect.w / 2) * TILE_SIZE,
          (b.rect.y - 2 - extra) * TILE_SIZE,
          (b.rect.w + 2) * TILE_SIZE,
          extra * TILE_SIZE,
          0xffcc66,
          Math.min(0.45, heat / 140),
        )
        .setDepth(2);
      this.heatGlow.push(g);
    }
  }

  panToBuilding(id: string): void {
    const b = this.snapshot?.buildings.find((x) => x.id === id || x.kind === id);
    if (!b) return;
    this.cameras.main.pan(b.door.x * TILE_SIZE, b.door.y * TILE_SIZE, 240, "Linear");
  }

  takePostcard(): void {
    this.game.renderer.snapshot((img) => {
      const el = img as HTMLImageElement;
      const a = document.createElement("a");
      a.href = el.src;
      a.download = `district-${Date.now()}.png`;
      a.click();
    });
  }

  applyAgents(agents: Agent[]): void {
    if (!this.snapshot) return;
    const byId = new Map(this.snapshot.agents.map((a) => [a.id, a]));
    for (const a of agents) byId.set(a.id, a);
    this.snapshot.agents = [...byId.values()];
    for (const a of agents) this.upsertAgent(a);
  }

  destroyPack(id: string, pack: SpritePack): void {
    pack.img.destroy();
    pack.label.destroy();
    pack.icon.destroy();
    pack.bubble.destroy();
    pack.heat.destroy();
    this.sprites.delete(id);
  }

  removeAgent(id: string): void {
    const pack = this.sprites.get(id);
    if (pack) this.destroyPack(id, pack);
    if (this.snapshot) this.snapshot.agents = this.snapshot.agents.filter((a) => a.id !== id);
  }

  upsertAgent(a: Agent): void {
    let pack = this.sprites.get(a.id);
    const key = `sprite-${a.sprite}`;
    const px = a.tile.x * TILE_SIZE + 8;
    const py = a.tile.y * TILE_SIZE + 8;
    if (!pack) {
      const img = this.add.image(px, py, key);
      img.setDisplaySize(16, 16);
      img.setDepth(10);
      const labelKey = `lbl-${a.id}`;
      pixelTextTexture(this, labelKey, a.name);
      const label = this.add.image(px, py + 11, labelKey).setOrigin(0.5, 0).setDepth(11);
      const icon = this.add.text(px, py - 12, "", { fontSize: "10px", color: "#fff" }).setOrigin(0.5).setDepth(12);
      const bubble = this.add
        .text(px, py - 16, "", {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "10px",
          color: "#140f0c",
          backgroundColor: "#f3ead8",
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(12);
      const heat = this.add.rectangle(px, py, 18, 18).setStrokeStyle(1, 0xc43c3c, 0).setDepth(9);
      pack = { img, label, icon, bubble, heat, labelKey };
      this.sprites.set(a.id, pack);
    }
    pack.img.setData("baseY", py);
    pack.img.setData("baseX", px);
    const duration = 250;
    if (Math.abs(pack.img.x - px) > 1 || Math.abs((pack.img.getData("baseY") as number) - py) > 1) {
      this.tweens.add({
        targets: [pack.img, pack.heat],
        x: px,
        y: py,
        duration,
        ease: "Linear",
        onUpdate: () => pack.img.setData("baseY", pack.img.y),
      });
    } else {
      pack.img.setPosition(px, py);
      pack.heat.setPosition(px, py);
    }
    const rate = a.state === "working" ? 120 : 200;
    const frame = a.state === "walking" || a.state === "working" ? Math.floor(this.time.now / rate) % 2 : 0;
    const facing = a.facing ?? "down";
    try {
      pack.img.setTexture(key, `${facing}-${frame}`);
    } catch {
      pack.img.setTexture(key);
    }
    const name = `${a.simulated ? "SIM " : ""}${a.name}`;
    if (pack.img.getData("label") !== name) {
      pixelTextTexture(this, pack.labelKey, name);
      pack.label.setTexture(pack.labelKey);
      pack.img.setData("label", name);
    }
    pack.label.setPosition(px, py + 9);
    pack.bubble.setText(a.bubble ?? (a.state === "working" ? "..." : ""));
    pack.bubble.setVisible(Boolean(a.bubble) || a.state === "working" || a.state === "speaking");
    pack.bubble.setPosition(px, py - 12);
    pack.icon.setPosition(px, py - 14);
    if (a.state === "blocked") pack.icon.setText("?").setColor("#c45c26").setVisible(true);
    else if (a.state === "error") pack.icon.setText("!").setColor("#c43c3c").setVisible(true);
    else pack.icon.setVisible(false);
    pack.heat.setStrokeStyle(1, 0xc43c3c, (a.tokenSpendHint ?? 0) / 100);
    pack.img.setData("agentId", a.id);
    pack.img.setData("state", a.state);
  }

  agentAt(tile: Tile): Agent | undefined {
    return this.snapshot?.agents.find((a) => a.tile.x === tile.x && a.tile.y === tile.y);
  }

  stationAt(tile: Tile): Station | undefined {
    return this.snapshot?.stations.find((s) => Math.abs(s.tile.x - tile.x) + Math.abs(s.tile.y - tile.y) <= 1);
  }

  worldToTile(wx: number, wy: number): Tile {
    return {
      x: Phaser.Math.Clamp(Math.floor(wx / TILE_SIZE), 0, MAP_W - 1),
      y: Phaser.Math.Clamp(Math.floor(wy / TILE_SIZE), 0, MAP_H - 1),
    };
  }

  interact(): void {
    const visitor = this.visitor();
    if (!visitor) return;
    const nearA = this.snapshot?.agents.find((a) => a.id !== visitor.id && dist(a.tile, visitor.tile) <= 1);
    if (nearA) {
      this.selectedId = nearA.id;
      this.hooks.onSelectAgent(nearA.id);
      this.hooks.onInteract("agent", nearA.id);
      return;
    }
    const st = this.snapshot?.stations.find((s) => dist(s.tile, visitor.tile) <= 1);
    if (st) {
      this.hooks.onSelectStation(st.id);
      this.hooks.onInteract(st.kind === "front_desk" || st.kind === "desk" ? "desk" : "station", st.id);
    }
  }

  panToAgent(id: string): void {
    const a = this.snapshot?.agents.find((x) => x.id === id);
    if (!a) return;
    this.cameras.main.pan(a.tile.x * TILE_SIZE, a.tile.y * TILE_SIZE, 200, "Linear");
    this.selectedId = id;
  }

  setFollow(id: string | null): void {
    this.followId = id;
  }

  tryStep(dx: number, dy: number): void {
    const visitor = this.visitor();
    if (!visitor) return;
    const nx = visitor.tile.x + dx;
    const ny = visitor.tile.y + dy;
    if (!this.grid[ny]?.[nx]) return;
    this.hooks.sendMove(nx, ny);
    visitor.tile = { x: nx, y: ny };
    this.upsertAgent(visitor);
  }

  update(t: number, dt: number): void {
    const k = this.wasd;
    const held =
      this.cursors.left.isDown ||
      this.cursors.right.isDown ||
      this.cursors.up.isDown ||
      this.cursors.down.isDown ||
      k.A?.isDown ||
      k.D?.isDown ||
      k.W?.isDown ||
      k.S?.isDown;
    if (held && t - this.lastStepAt > 140) {
      this.lastStepAt = t;
      if (this.cursors.left.isDown || k.A?.isDown) this.tryStep(-1, 0);
      else if (this.cursors.right.isDown || k.D?.isDown) this.tryStep(1, 0);
      else if (this.cursors.up.isDown || k.W?.isDown) this.tryStep(0, -1);
      else if (this.cursors.down.isDown || k.S?.isDown) this.tryStep(0, 1);
    }
    const cycle = 4 * 60 * 1000;
    const phase = (t % cycle) / cycle;
    const night = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    this.night?.setAlpha(night * 0.35);
    if (this.leds.length) {
      const on = Math.floor(t / 280) % 2 === 0;
      this.leds.forEach((led, i) => led.setFillStyle(on === (i % 2 === 0) ? 0x3e8948 : 0xc45c26));
    }
    this.zAcc += dt;
    for (const [id, pack] of this.sprites) {
      const state = pack.img.getData("state") as string;
      const baseY = Number(pack.img.getData("baseY") ?? pack.img.y);
      const bob = state === "idle" && Math.floor(t / 280) % 2 === 0 ? -1 : 0;
      pack.img.y = baseY + bob;
      if (state === "sleeping" && this.zAcc > 700) {
        const z = this.add.text(pack.img.x + 6, pack.img.y - 10, "z", { fontSize: "8px", color: "#c9d4e0" }).setDepth(13);
        this.tweens.add({
          targets: z,
          y: z.y - 10,
          alpha: 0,
          duration: 900,
          onComplete: () => z.destroy(),
        });
      }
      void id;
    }
    if (this.zAcc > 700) this.zAcc = 0;
    if (this.selectedId && this.selRect) {
      const a = this.snapshot?.agents.find((x) => x.id === this.selectedId);
      if (a) this.selRect.setVisible(true).setPosition(a.tile.x * TILE_SIZE + 8, a.tile.y * TILE_SIZE + 8);
    } else this.selRect?.setVisible(false);
    if (this.followId) {
      const a = this.snapshot?.agents.find((x) => x.id === this.followId);
      if (a) this.cameras.main.centerOn(a.tile.x * TILE_SIZE, a.tile.y * TILE_SIZE);
    }
    const cam = this.cameras.main;
    cam.scrollX = Math.round(cam.scrollX);
    cam.scrollY = Math.round(cam.scrollY);
  }
}

export function gameConfig(parent: HTMLElement, width: number, height: number): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width,
    height,
    backgroundColor: "#2F6B38",
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scene: [DistrictScene],
  };
}
