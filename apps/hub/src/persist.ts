import fs from "node:fs";
import path from "node:path";
import type { Agent, Org, Building, Station, Task, WorldEvent } from "@district/shared";

export type PersistBlob = {
  org: Org;
  buildings: Building[];
  stations: Station[];
  agents: Agent[];
  tasks: Task[];
  events: WorldEvent[];
  simEnabled: boolean;
  campusVisits?: number;
  buildingVisits?: Record<string, number>;
  founders?: Record<string, { agentId: string; name: string }>;
};

export function dataDir(root = process.cwd()): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  return path.resolve(root, "data");
}

function atomicWrite(file: string, json: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
  fs.renameSync(tmp, file);
}

export function persistAll(dir: string, blob: PersistBlob): void {
  fs.mkdirSync(dir, { recursive: true });
  atomicWrite(path.join(dir, "world.json"), {
    org: blob.org,
    buildings: blob.buildings,
    stations: blob.stations,
    simEnabled: blob.simEnabled,
    campusVisits: blob.campusVisits ?? 0,
    buildingVisits: blob.buildingVisits ?? {},
    founders: blob.founders ?? {},
  });
  atomicWrite(path.join(dir, "orgs.json"), [blob.org]);
  atomicWrite(
    path.join(dir, "agents.json"),
    blob.agents.filter((a) => a.sprite !== "visitor"),
  );
  atomicWrite(path.join(dir, "events.json"), blob.events);
  atomicWrite(path.join(dir, "tasks.json"), blob.tasks);
}

export function loadAll(dir: string): PersistBlob | null {
  const worldPath = path.join(dir, "world.json");
  if (!fs.existsSync(worldPath)) return null;
  try {
    const world = JSON.parse(fs.readFileSync(worldPath, "utf8")) as {
      org: Org;
      buildings: Building[];
      stations: Station[];
      simEnabled?: boolean;
      campusVisits?: number;
      buildingVisits?: Record<string, number>;
      founders?: Record<string, { agentId: string; name: string }>;
    };
    const agents = fs.existsSync(path.join(dir, "agents.json"))
      ? (JSON.parse(fs.readFileSync(path.join(dir, "agents.json"), "utf8")) as Agent[])
      : [];
    const events = fs.existsSync(path.join(dir, "events.json"))
      ? (JSON.parse(fs.readFileSync(path.join(dir, "events.json"), "utf8")) as WorldEvent[])
      : [];
    const tasks = fs.existsSync(path.join(dir, "tasks.json"))
      ? (JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8")) as Task[])
      : [];
    return {
      org: world.org,
      buildings: world.buildings,
      stations: world.stations,
      agents: agents.filter((a) => a.sprite !== "visitor"),
      events,
      tasks,
      simEnabled: world.simEnabled ?? true,
      campusVisits: world.campusVisits ?? 0,
      buildingVisits: world.buildingVisits ?? {},
      founders: world.founders ?? {},
    };
  } catch {
    return null;
  }
}
