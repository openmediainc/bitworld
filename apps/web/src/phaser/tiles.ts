import {
  FLOOR_BY_KIND,
  FOUNTAIN,
  MAP_H,
  MAP_W,
  NORTH_DOOR_KINDS,
  PALETTE,
  ROOF_BY_KIND,
  TILE_SIZE,
  furnitureTile,
  type AvenuePlot,
  type Building,
  type Station,
} from "@district/shared";
import { pixelTextTexture } from "./font";

function hex(c: string): number {
  return Number.parseInt(c.replace("#", ""), 16);
}

export function hashBuildings(buildings: Building[]): string {
  return buildings.map((b) => `${b.id}:${b.rect.x},${b.rect.y},${b.rect.w},${b.rect.h}`).join("|");
}

export function drawCampus(
  scene: Phaser.Scene,
  buildings: Building[],
  stations: Station[],
): Phaser.GameObjects.RenderTexture {
  const w = MAP_W * TILE_SIZE;
  const h = MAP_H * TILE_SIZE;
  const g = scene.add.graphics();
  g.setVisible(false);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = (x + y) % 2 === 0 ? PALETTE.grass : PALETTE.grassDark;
      g.fillStyle(hex(c), 1);
      g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  for (const b of buildings) {
    if (b.kind === "plaza") {
      g.fillStyle(hex(PALETTE.path), 1);
      g.fillRect(b.rect.x * TILE_SIZE, b.rect.y * TILE_SIZE, b.rect.w * TILE_SIZE, b.rect.h * TILE_SIZE);
      continue;
    }
    g.fillStyle(hex(FLOOR_BY_KIND[b.kind] ?? PALETTE.floorHq), 1);
    g.fillRect(b.rect.x * TILE_SIZE, b.rect.y * TILE_SIZE, b.rect.w * TILE_SIZE, b.rect.h * TILE_SIZE);
    const x0 = b.rect.x - 1;
    const x1 = b.rect.x + b.rect.w;
    const yN0 = b.rect.y - 2;
    const yN1 = b.rect.y - 1;
    const yS = b.rect.y + b.rect.h;
    g.fillStyle(hex(PALETTE.wall), 1);
    g.fillRect(x0 * TILE_SIZE, yN0 * TILE_SIZE, (b.rect.w + 2) * TILE_SIZE, 2 * TILE_SIZE);
    g.fillRect(x0 * TILE_SIZE, yN0 * TILE_SIZE, TILE_SIZE, (b.rect.h + 3) * TILE_SIZE);
    g.fillRect(x1 * TILE_SIZE, yN0 * TILE_SIZE, TILE_SIZE, (b.rect.h + 3) * TILE_SIZE);
    g.fillRect(x0 * TILE_SIZE, yS * TILE_SIZE, (b.rect.w + 2) * TILE_SIZE, TILE_SIZE);
    g.fillStyle(hex(ROOF_BY_KIND[b.kind] ?? PALETTE.roofHq), 1);
    g.fillRect(x0 * TILE_SIZE, yN0 * TILE_SIZE, (b.rect.w + 2) * TILE_SIZE, 2 * TILE_SIZE);
    g.fillStyle(hex(PALETTE.wallHighlight), 1);
    g.fillRect(x0 * TILE_SIZE, yN1 * TILE_SIZE, (b.rect.w + 2) * TILE_SIZE, 1);
    const door = b.door;
    if (NORTH_DOOR_KINDS.has(b.kind)) {
      g.fillStyle(hex(PALETTE.path), 1);
      g.fillRect(door.x * TILE_SIZE, yN0 * TILE_SIZE, TILE_SIZE, 2 * TILE_SIZE);
    } else {
      g.fillStyle(hex(PALETTE.path), 1);
      g.fillRect(door.x * TILE_SIZE, yS * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  g.fillStyle(hex(PALETTE.water), 1);
  g.fillRect(FOUNTAIN.x * TILE_SIZE, FOUNTAIN.y * TILE_SIZE, 32, 32);
  for (const s of stations) {
    const furn = furnitureTile(s, buildings) ?? { x: s.tile.x, y: s.tile.y - 1 };
    drawStation(g, s.kind, furn.x * TILE_SIZE, furn.y * TILE_SIZE);
  }
  const rt = scene.add.renderTexture(0, 0, w, h);
  rt.setOrigin(0, 0);
  rt.draw(g);
  g.destroy();
  rt.setDepth(0);
  return rt;
}

export function drawAvenue(scene: Phaser.Scene, plots: AvenuePlot[]): Phaser.GameObjects.RenderTexture {
  const w = MAP_W * TILE_SIZE;
  const h = MAP_H * TILE_SIZE;
  const g = scene.add.graphics();
  g.setVisible(false);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const street = y >= 22 && y < 32;
      const c = street
        ? (x + y) % 2 === 0
          ? PALETTE.path
          : PALETTE.pathDark
        : (x + y) % 2 === 0
          ? PALETTE.grass
          : PALETTE.grassDark;
      g.fillStyle(hex(c), 1);
      g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  for (const p of plots) {
    g.fillStyle(hex(PALETTE.floorHq), 1);
    g.fillRect(p.rect.x * TILE_SIZE, p.rect.y * TILE_SIZE, p.rect.w * TILE_SIZE, p.rect.h * TILE_SIZE);
    const x0 = p.rect.x - 1;
    const x1 = p.rect.x + p.rect.w;
    const yN0 = p.rect.y - 2;
    const yS = p.rect.y + p.rect.h;
    g.fillStyle(hex(PALETTE.wall), 1);
    g.fillRect(x0 * TILE_SIZE, yN0 * TILE_SIZE, (p.rect.w + 2) * TILE_SIZE, 2 * TILE_SIZE);
    g.fillRect(x0 * TILE_SIZE, yN0 * TILE_SIZE, TILE_SIZE, (p.rect.h + 3) * TILE_SIZE);
    g.fillRect(x1 * TILE_SIZE, yN0 * TILE_SIZE, TILE_SIZE, (p.rect.h + 3) * TILE_SIZE);
    g.fillRect(x0 * TILE_SIZE, yS * TILE_SIZE, (p.rect.w + 2) * TILE_SIZE, TILE_SIZE);
    g.fillStyle(hex(p.color), 1);
    g.fillRect(x0 * TILE_SIZE, yN0 * TILE_SIZE, (p.rect.w + 2) * TILE_SIZE, 2 * TILE_SIZE);
    g.fillStyle(hex(PALETTE.path), 1);
    g.fillRect(p.door.x * TILE_SIZE, yS * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    if (p.kind === "billboard") {
      g.fillStyle(hex("#F7931A"), 1);
      g.fillRect((p.rect.x + 1) * TILE_SIZE, (p.rect.y + 2) * TILE_SIZE, (p.rect.w - 2) * TILE_SIZE, 3 * TILE_SIZE);
    }
    if (p.kind === "empty") {
      g.fillStyle(hex("#3a322a"), 0.5);
      g.fillRect(p.rect.x * TILE_SIZE, p.rect.y * TILE_SIZE, p.rect.w * TILE_SIZE, p.rect.h * TILE_SIZE);
    }
  }
  g.fillStyle(hex("#F7931A"), 1);
  g.fillRect(39 * TILE_SIZE + 4, 26 * TILE_SIZE + 4, 8, 8);
  const rt = scene.add.renderTexture(0, 0, w, h);
  rt.setOrigin(0, 0);
  rt.draw(g);
  g.destroy();
  rt.setDepth(0);
  return rt;
}

function drawStation(g: Phaser.GameObjects.Graphics, kind: Station["kind"], x: number, y: number): void {
  switch (kind) {
    case "desk":
    case "front_desk":
      g.fillStyle(hex("#6B5346"), 1);
      g.fillRect(x + 1, y + 8, 14, 6);
      g.fillStyle(hex("#2B2F3A"), 1);
      g.fillRect(x + 4, y + 2, 8, 6);
      g.fillStyle(hex("#7ec8ff"), 1);
      g.fillRect(x + 5, y + 3, 6, 4);
      break;
    case "library":
      g.fillStyle(hex("#3E5A7A"), 1);
      g.fillRect(x + 1, y + 1, 14, 14);
      g.fillStyle(hex("#C45C26"), 1);
      g.fillRect(x + 3, y + 3, 3, 10);
      g.fillStyle(hex("#D4A017"), 1);
      g.fillRect(x + 7, y + 3, 3, 10);
      g.fillStyle(hex("#2F9E6A"), 1);
      g.fillRect(x + 11, y + 3, 2, 10);
      break;
    case "terminal":
      g.fillStyle(hex("#1F242C"), 1);
      g.fillRect(x + 2, y + 3, 12, 10);
      g.fillStyle(hex("#3E8948"), 1);
      g.fillRect(x + 4, y + 5, 8, 6);
      break;
    case "lab":
      g.fillStyle(hex("#D5E0D6"), 1);
      g.fillRect(x + 2, y + 6, 12, 8);
      g.fillStyle(hex("#3D7EA6"), 1);
      g.fillRect(x + 4, y + 2, 3, 6);
      g.fillStyle(hex("#C43C3C"), 1);
      g.fillRect(x + 9, y + 2, 3, 6);
      break;
    case "server_rack":
      g.fillStyle(hex("#1a1d22"), 1);
      g.fillRect(x + 3, y + 1, 10, 14);
      g.fillStyle(hex("#3E8948"), 1);
      g.fillRect(x + 5, y + 3, 2, 2);
      g.fillStyle(hex("#C45C26"), 1);
      g.fillRect(x + 9, y + 6, 2, 2);
      g.fillStyle(hex("#5B8DEF"), 1);
      g.fillRect(x + 5, y + 9, 2, 2);
      break;
    case "cafe":
      g.fillStyle(hex("#6B5346"), 1);
      g.fillRect(x + 5, y + 4, 6, 10);
      g.fillStyle(hex("#B85C38"), 1);
      g.fillRect(x + 6, y + 2, 4, 3);
      g.fillStyle(hex("#f3ead8"), 1);
      g.fillRect(x + 7, y + 1, 2, 2);
      break;
    case "board":
    case "meeting_table":
      g.fillStyle(hex("#E6DCC8"), 1);
      g.fillRect(x + 1, y + 2, 14, 12);
      g.fillStyle(hex("#3E5A7A"), 1);
      g.fillRect(x + 3, y + 4, 10, 1);
      g.fillRect(x + 3, y + 7, 7, 1);
      break;
    case "mailbox":
      g.fillStyle(hex("#7A3E2E"), 1);
      g.fillRect(x + 4, y + 4, 8, 10);
      g.fillStyle(hex("#C7A36A"), 1);
      g.fillRect(x + 6, y + 6, 4, 3);
      break;
    default:
      g.fillStyle(hex("#6B5346"), 1);
      g.fillRect(x + 3, y + 3, 10, 10);
  }
}

export function makeFountainSparkle(scene: Phaser.Scene): Phaser.GameObjects.Rectangle {
  const spark = scene.add.rectangle(
    FOUNTAIN.x * TILE_SIZE + 20,
    FOUNTAIN.y * TILE_SIZE + 8,
    2,
    2,
    0xffffff,
  );
  spark.setOrigin(0, 0);
  spark.setDepth(2);
  scene.time.addEvent({
    delay: 400,
    loop: true,
    callback: () => spark.setVisible(!spark.visible),
  });
  return spark;
}

export function addRoofLabels(scene: Phaser.Scene, buildings: Building[]): Phaser.GameObjects.Image[] {
  const out: Phaser.GameObjects.Image[] = [];
  for (const b of buildings) {
    if (b.kind === "plaza") continue;
    const x = (b.rect.x + b.rect.w / 2) * TILE_SIZE;
    const y = (b.rect.y - 1.4) * TILE_SIZE;
    const key = `roof-${b.id}`;
    pixelTextTexture(scene, key, b.name);
    out.push(scene.add.image(x, y, key).setOrigin(0.5).setDepth(3));
  }
  return out;
}
