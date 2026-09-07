import { describe, expect, it } from "vitest";
import { astar, buildCollisionGrid, seedBuildings, seedStations } from "@district/shared";
import { World } from "./world.js";
import { startSimulator, stopSimulator } from "./simulator.js";

describe("hub pathfinding", () => {
  const buildings = seedBuildings();
  const stations = seedStations();
  const grid = buildCollisionGrid(buildings, stations);
  const hq = buildings.find((b) => b.kind === "hq")!;
  const lab = buildings.find((b) => b.kind === "lab")!;

  it("A* HQ door → Lab door", () => {
    const path = astar(grid, hq.door, lab.door);
    expect(path.length).toBeGreaterThan(0);
    expect(path.at(-1)).toEqual(lab.door);
  });

  it("A* to a wall returns []", () => {
    const wall = { x: hq.rect.x - 1, y: hq.rect.y };
    expect(astar(grid, hq.door, wall)).toEqual([]);
  });
});

describe("heartbeat sweep", () => {
  it("marks sleeping after 60s stale", () => {
    const world = new World();
    const a = world.upsertAgent({ id: "liveagent1", name: "Claude", sprite: "yuki", simulated: false });
    a.lastHeartbeatAt = Date.now() - 60_000;
    world.sweepHeartbeats();
    expect(world.require(a.id).state).toBe("sleeping");
    expect(world.require(a.id).bubble).toBe("offline");
  });
});

describe("simulator", () => {
  it("start creates 6 SIM agents; stop removes only those", () => {
    const world = new World();
    const live = world.upsertAgent({ id: "realagent1", name: "Claude", sprite: "moss", simulated: false });
    startSimulator(world);
    const sims = [...world.agents.values()].filter((a) => a.simulated);
    expect(sims).toHaveLength(6);
    expect(world.agents.get(live.id)?.simulated).toBe(false);
    stopSimulator(world);
    expect([...world.agents.values()].filter((a) => a.simulated)).toHaveLength(0);
    expect(world.agents.has(live.id)).toBe(true);
  });
});

describe("avenue shard", () => {
  it("refuses claim/takeover and teleports visitor to KM 0", () => {
    const world = new World();
    const v = world.upsertAgent({ id: "visitor_test", name: "Visitor", sprite: "visitor", simulated: false });
    const refuse = world.refuseAvenueCommerce();
    expect(refuse.statusCode).toBe(403);
    expect(refuse.error.toLowerCase()).toContain("not for sale");
    const moved = world.setShard(v.id, "avenue");
    expect(moved.shard).toBe("avenue");
    expect(moved.tile).toEqual({ x: 39, y: 26 });
    const back = world.setShard(v.id, "campus");
    expect(back.shard).toBe("campus");
    const card = world.snapshot().avenue?.plots.find((p) => p.slug === "bitgrid");
    expect(card?.href).toContain("bitgrid");
    world.dropPostcard(v.id);
    expect(world.tasks.some((t) => t.title === "Campus postcard")).toBe(true);
  });
});
