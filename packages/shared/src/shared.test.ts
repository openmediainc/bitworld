import { describe, expect, it } from "vitest";
import { astar } from "./pathfind.js";
import { buildCollisionGrid } from "./collision.js";
import { mapToolToStationKind } from "./stations.js";
import { seedBuildings, seedOrg, seedStations } from "./seed.js";
import { snapshotSchema } from "./schemas.js";
import { AVENUE_REFUSE, seedAvenuePlots } from "./avenue.js";
import { BITGRID_URL } from "./constants.js";

describe("station mapping", () => {
  it("maps github to servers", () => {
    expect(mapToolToStationKind("github", "list_prs")).toEqual({
      stationKind: "server_rack",
      buildingKind: "servers",
    });
  });
  it("maps pytest to lab", () => {
    expect(mapToolToStationKind("pytest", "run")).toEqual({
      stationKind: "lab",
      buildingKind: "lab",
    });
  });
  it("maps unknown to hq desk", () => {
    expect(mapToolToStationKind("unknown-tool", "frob")).toEqual({
      stationKind: "desk",
      buildingKind: "hq",
    });
  });
});

describe("pathfinding on seeded campus", () => {
  const buildings = seedBuildings();
  const stations = seedStations();
  const grid = buildCollisionGrid(buildings, stations);
  const hq = buildings.find((b) => b.kind === "hq")!;
  const lab = buildings.find((b) => b.kind === "lab")!;

  it("finds HQ door → Lab door", () => {
    const path = astar(grid, hq.door, lab.door);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(lab.door);
  });

  it("returns [] for a wall", () => {
    const wall = { x: hq.rect.x - 1, y: hq.rect.y };
    expect(grid[wall.y][wall.x]).toBe(false);
    const path = astar(grid, hq.door, wall);
    expect(path).toEqual([]);
  });
});

describe("zod snapshot", () => {
  it("accepts a seeded snapshot", () => {
    const now = Date.now();
    const parsed = snapshotSchema.parse({
      t: now,
      org: seedOrg(),
      buildings: seedBuildings(),
      stations: seedStations(),
      agents: [],
      tasks: [],
      events: [],
    });
    expect(parsed.org.id).toBe("org_acme");
    expect(parsed.buildings).toHaveLength(9);
  });
});

describe("avenue shard", () => {
  it("seeds 8 plots, none for sale, BitGrid is a billboard", () => {
    const plots = seedAvenuePlots();
    expect(plots).toHaveLength(8);
    expect(plots.every((p) => p.forSale === false)).toBe(true);
    const grid = plots.find((p) => p.slug === "bitgrid");
    expect(grid?.kind).toBe("billboard");
    expect(grid?.href).toBe(BITGRID_URL);
    expect(AVENUE_REFUSE.toLowerCase()).toContain("not for sale");
  });
});
