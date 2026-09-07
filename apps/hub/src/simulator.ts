import { SPRITE_COLORS, type SpriteId, type StationKind } from "@district/shared";
import type { World } from "./world.js";

type Step =
  | { kind: "work"; stationKind: StationKind; seconds: number; title: string; tool?: string }
  | { kind: "speak"; text: string }
  | { kind: "handoff"; to: string; note: string }
  | { kind: "blocked"; reason: string; seconds: number }
  | { kind: "rack"; seconds: number };

const CASTS: Array<{
  id: string;
  name: string;
  role: string;
  sprite: SpriteId;
  tile: { x: number; y: number };
  loop: Step[];
}> = [
  {
    id: "sim_yuki001",
    name: "Yuki",
    role: "Coder",
    sprite: "yuki",
    tile: { x: 36, y: 28 },
    loop: [
      { kind: "work", stationKind: "terminal", seconds: 12, title: "compiling the mood", tool: "bash" },
      { kind: "work", stationKind: "library", seconds: 8, title: "reading the docs that exist", tool: "search" },
      { kind: "work", stationKind: "desk", seconds: 10, title: "typing like it matters" },
    ],
  },
  {
    id: "sim_kael001",
    name: "Kael",
    role: "Architect",
    sprite: "kael",
    tile: { x: 38, y: 29 },
    loop: [
      { kind: "work", stationKind: "board", seconds: 10, title: "boxing the system", tool: "plan" },
      { kind: "speak", text: "plan: keep the physics honest" },
      { kind: "handoff", to: "Yuki", note: "spec's on the board" },
    ],
  },
  {
    id: "sim_nora001",
    name: "Nora",
    role: "Support",
    sprite: "nora",
    tile: { x: 41, y: 28 },
    loop: [
      { kind: "work", stationKind: "front_desk", seconds: 6, title: "taking names" },
      { kind: "work", stationKind: "mailbox", seconds: 8, title: "sorting the polite tickets" },
      { kind: "work", stationKind: "cafe", seconds: 5, title: "one espresso, then another" },
    ],
  },
  {
    id: "sim_rex0001",
    name: "Rex",
    role: "QA",
    sprite: "rex",
    tile: { x: 43, y: 29 },
    loop: [
      { kind: "work", stationKind: "lab", seconds: 14, title: "poking the tests", tool: "pytest" },
      { kind: "blocked", reason: "flaky test", seconds: 6 },
    ],
  },
  {
    id: "sim_iris001",
    name: "Iris",
    role: "Research",
    sprite: "iris",
    tile: { x: 35, y: 30 },
    loop: [
      { kind: "work", stationKind: "library", seconds: 16, title: "in the stacks", tool: "read" },
      { kind: "speak", text: "finding: the fountain is load-bearing" },
    ],
  },
  {
    id: "sim_cobb001",
    name: "Cobb",
    role: "Ops",
    sprite: "cobb",
    tile: { x: 42, y: 30 },
    loop: [{ kind: "rack", seconds: 9 }],
  },
];

const RACKS = ["st_github_", "st_browser", "st_docs___", "st_slack__"];

export function startSimulator(world: World): { count: number } {
  world.simEnabled = true;
  for (const c of CASTS) {
    const a = world.upsertAgent({
      id: c.id,
      name: c.name,
      role: c.role,
      sprite: c.sprite,
      color: SPRITE_COLORS[c.sprite],
      simulated: true,
      tile: c.tile,
    });
    const rt = world.rt(a.id);
    rt.simName = c.name;
    rt.simStep = 0;
    rt.simWaitUntil = 0;
  }
  return { count: 6 };
}

export function stopSimulator(world: World): { removed: number } {
  world.simEnabled = false;
  let removed = 0;
  for (const a of [...world.agents.values()]) {
    if (a.simulated) {
      world.despawn(a.id);
      removed++;
    }
  }
  return { removed };
}

export function simTick(world: World, now = Date.now()): void {
  if (!world.simEnabled) return;
  for (const c of CASTS) {
    const a = world.agents.get(c.id);
    if (!a) continue;
    const rt = world.rt(a.id);
    if (a.path.length) continue;
    if (a.state === "working" && rt.workUntil && now < rt.workUntil) continue;
    if (a.state === "blocked" && rt.blockedUntil && now < rt.blockedUntil) continue;
    if (rt.simWaitUntil && now < rt.simWaitUntil) continue;
    if (rt.orders.length) continue;

    const stepIdx = rt.simStep ?? 0;
    const step = c.loop[stepIdx % c.loop.length];
    rt.simStep = stepIdx + 1;

    if (step.kind === "work") {
      world.workOn(a.id, {
        title: step.title,
        stationKind: step.stationKind,
        toolName: step.tool,
        seconds: step.seconds,
      });
    } else if (step.kind === "speak") {
      world.speak(a.id, step.text);
      rt.simWaitUntil = now + 3000;
    } else if (step.kind === "handoff") {
      world.handoff(a.id, step.to, step.note);
      rt.simWaitUntil = now + 4000;
    } else if (step.kind === "blocked") {
      if (world.rng() < 0.55) {
        world.blocked(a.id, step.reason);
        rt.blockedUntil = now + step.seconds * 1000;
      } else {
        rt.simWaitUntil = now + 1000;
      }
    } else if (step.kind === "rack") {
      const rackId = RACKS[stepIdx % RACKS.length];
      const heat = 20 + Math.floor(world.rng() * 61);
      a.tokenSpendHint = heat;
      world.workOn(a.id, {
        title: `spinning ${rackId.replace("st_", "").replace(/_/g, "")}`,
        stationId: rackId,
        seconds: step.seconds,
        toolName: "ops.rotate",
      });
    }
  }
}
