import type { Building, Tile } from "./types.js";

export function tileInRect(tile: Tile, b: Building): boolean {
  const r = b.rect;
  return tile.x >= r.x && tile.y >= r.y && tile.x < r.x + r.w && tile.y < r.y + r.h;
}

export function buildingAt(buildings: Building[], tile: Tile): Building | undefined {
  return buildings.find((b) => b.kind !== "plaza" && tileInRect(tile, b));
}
