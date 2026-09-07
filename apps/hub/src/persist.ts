import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Agent, Org, Building, Mission, Station, Task, WorldEvent } from "@district/shared";

export type PersistBlob = {
  org: Org;
  buildings: Building[];
  stations: Station[];
  agents: Agent[];
  tasks: Task[];
  missions?: Mission[];
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

export function backupDir(): string {
  if (process.env.BACKUP_DIR) return path.resolve(process.env.BACKUP_DIR);
  return path.join(os.homedir(), "Library", "Application Support", "District", "backups");
}

function atomicWrite(file: string, json: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2), { mode: 0o600 });
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
    blob.agents.filter((a) => a.sprite !== "visitor" && !a.simulated),
  );
  atomicWrite(path.join(dir, "events.json"), blob.events);
  atomicWrite(path.join(dir, "tasks.json"), blob.tasks);
  atomicWrite(path.join(dir, "missions.json"), blob.missions ?? []);
}

export function backupData(sourceDir: string, destinationDir = backupDir(), keep = 30): string {
  fs.mkdirSync(destinationDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const finalDir = path.join(destinationDir, `district-data-${stamp}`);
  const tempDir = `${finalDir}.tmp`;
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    for (const name of fs.readdirSync(sourceDir)) {
      if (!name.endsWith(".json")) continue;
      fs.copyFileSync(path.join(sourceDir, name), path.join(tempDir, name));
    }
    fs.renameSync(tempDir, finalDir);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }

  const complete = fs
    .readdirSync(destinationDir)
    .filter((name) => name.startsWith("district-data-") && !name.endsWith(".tmp"))
    .sort()
    .reverse();
  for (const name of complete.slice(keep)) {
    fs.rmSync(path.join(destinationDir, name), { recursive: true, force: true });
  }
  return finalDir;
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
    const missions = fs.existsSync(path.join(dir, "missions.json"))
      ? (JSON.parse(fs.readFileSync(path.join(dir, "missions.json"), "utf8")) as Mission[])
      : [];
    return {
      org: world.org,
      buildings: world.buildings,
      stations: world.stations,
      agents: agents.filter((a) => a.sprite !== "visitor"),
      events,
      tasks,
      missions,
      simEnabled: world.simEnabled ?? true,
      campusVisits: world.campusVisits ?? 0,
      buildingVisits: world.buildingVisits ?? {},
      founders: world.founders ?? {},
    };
  } catch (error) {
    throw new Error(`could not load District state from ${dir}`, { cause: error });
  }
}
