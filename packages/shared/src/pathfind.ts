import { ASTAR_MAX_NODES, MAP_H, MAP_W } from "./constants.js";
import { isWalkable } from "./collision.js";
import type { Tile } from "./types.js";

const DIRS: Tile[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

function key(t: Tile): string {
  return `${t.x},${t.y}`;
}

function heuristic(a: Tile, b: Tile): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** 4-connected A*. Returns remaining tiles including goal, excluding start. [] on fail. */
export function astar(grid: boolean[][], start: Tile, goal: Tile, maxNodes = ASTAR_MAX_NODES): Tile[] {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!isWalkable(grid, start.x, start.y) || !isWalkable(grid, goal.x, goal.y)) return [];

  const open: Array<{ t: Tile; f: number }> = [{ t: start, f: heuristic(start, goal) }];
  const came = new Map<string, Tile>();
  const gScore = new Map<string, number>([[key(start), 0]]);
  const inOpen = new Set<string>([key(start)]);
  let expanded = 0;

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    inOpen.delete(key(current.t));
    expanded++;
    if (expanded > maxNodes) return [];
    if (current.t.x === goal.x && current.t.y === goal.y) {
      const path: Tile[] = [];
      let c: Tile | undefined = current.t;
      while (c && !(c.x === start.x && c.y === start.y)) {
        path.push(c);
        c = came.get(key(c));
      }
      path.reverse();
      return path;
    }
    for (const d of DIRS) {
      const n = { x: current.t.x + d.x, y: current.t.y + d.y };
      if (n.x < 0 || n.y < 0 || n.x >= MAP_W || n.y >= MAP_H) continue;
      if (!isWalkable(grid, n.x, n.y)) continue;
      const tentative = (gScore.get(key(current.t)) ?? Infinity) + 1;
      const nk = key(n);
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        came.set(nk, current.t);
        gScore.set(nk, tentative);
        if (!inOpen.has(nk)) {
          open.push({ t: n, f: tentative + heuristic(n, goal) });
          inOpen.add(nk);
        }
      }
    }
  }
  return [];
}
