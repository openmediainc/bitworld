import { FOUNTAIN, MAP_H, MAP_W, NORTH_DOOR_KINDS } from "./constants.js";
import type { Building, Station, Tile } from "./types.js";

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

function block(grid: boolean[][], x: number, y: number): void {
  if (inBounds(x, y)) grid[y][x] = false;
}

function walk(grid: boolean[][], x: number, y: number): void {
  if (inBounds(x, y)) grid[y][x] = true;
}

export function furnitureTile(station: Station, buildings: Building[]): Tile | null {
  const b = buildings.find((x) => x.id === station.buildingId);
  if (!b || b.kind === "plaza") return null;
  const north = NORTH_DOOR_KINDS.has(b.kind);
  const tile = north
    ? { x: station.tile.x, y: station.tile.y + 1 }
    : { x: station.tile.x, y: station.tile.y - 1 };
  const r = b.rect;
  if (tile.x < r.x || tile.y < r.y || tile.x > r.x + r.w - 1 || tile.y > r.y + r.h - 1) {
    return null;
  }
  return tile;
}

function paintWalls(grid: boolean[][], b: Building): void {
  const { x, y, w, h } = b.rect;
  const x0 = x - 1;
  const x1 = x + w;
  const yNorth0 = y - 2;
  const yNorth1 = y - 1;
  const ySouth = y + h;
  for (let tx = x0; tx <= x1; tx++) {
    block(grid, tx, yNorth0);
    block(grid, tx, yNorth1);
    block(grid, tx, ySouth);
  }
  for (let ty = yNorth0; ty <= ySouth; ty++) {
    block(grid, x0, ty);
    block(grid, x1, ty);
  }
  if (NORTH_DOOR_KINDS.has(b.kind)) {
    walk(grid, b.door.x, yNorth0);
    walk(grid, b.door.x, yNorth1);
    walk(grid, b.door.x, b.door.y);
  } else {
    walk(grid, b.door.x, ySouth);
    walk(grid, b.door.x, b.door.y);
  }
}

/** true = walkable */
export function buildCollisionGrid(buildings: Building[], stations: Station[]): boolean[][] {
  const grid: boolean[][] = Array.from({ length: MAP_H }, () => Array<boolean>(MAP_W).fill(true));
  for (const b of buildings) {
    if (b.kind === "plaza") continue;
    paintWalls(grid, b);
  }
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      block(grid, FOUNTAIN.x + dx, FOUNTAIN.y + dy);
    }
  }
  for (const s of stations) {
    const furn = furnitureTile(s, buildings);
    if (furn) block(grid, furn.x, furn.y);
    walk(grid, s.tile.x, s.tile.y);
  }
  return grid;
}

export function isWalkable(grid: boolean[][], x: number, y: number): boolean {
  return inBounds(x, y) && grid[y][x];
}
