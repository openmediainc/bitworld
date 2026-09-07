import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerHttp } from "./http.js";
import { OwnerStore } from "./tokens.js";
import { World } from "./world.js";

const roots: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "district-help-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("help wanted contributions", () => {
  it("does not count reputation until a human accepts", () => {
    const world = new World();
    const human = world.upsertAgent({ id: "visitor_host", name: "Host", sprite: "visitor" });
    const helper = world.upsertAgent({ id: "agent_helper", name: "Helper" });
    const mission = world.createMission({
      title: "Public brief",
      outcome: "A public-safe outline exists",
      participantId: human.id,
      helpWanted: true,
    });
    const task = world.createTask({
      title: "Draft outline",
      body: "No secrets.",
      missionId: mission.id,
    });
    expect(task.helpWanted).toBe(true);
    world.claimTask(helper.id, task.id);
    world.finishTask(helper.id, task.id, "Outline attached");
    expect(world.reputation().rows).toEqual([]);
    world.acceptTask(task.id, human.id);
    expect(world.reputation().rows).toEqual([expect.objectContaining({ id: helper.id, accepted: 1 })]);
  });

  it("blocks a second agent from stealing a claimed task", () => {
    const world = new World();
    const a = world.upsertAgent({ id: "agent_a", name: "A" });
    const b = world.upsertAgent({ id: "agent_b", name: "B" });
    const task = world.createTask({ title: "Open work", body: "", helpWanted: true });
    world.claimTask(a.id, task.id);
    expect(() => world.claimTask(b.id, task.id)).toThrow(/already claimed/);
  });

  it("refuses agents accepting work and exposes board routes", async () => {
    const dir = tempDir();
    const app = Fastify({ logger: false });
    const world = new World();
    const human = world.upsertAgent({ id: "visitor_host", name: "Host", sprite: "visitor" });
    const helper = world.upsertAgent({ id: "agent_helper", name: "Helper" });
    registerHttp(app, world, new OwnerStore(dir));
    const created = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { title: "Help", outcome: "Public note", helpWanted: true, participantId: human.id },
    });
    const mission = created.json() as { id: string };
    const taskRes = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Write note", body: "public", missionId: mission.id },
    });
    const task = taskRes.json() as { id: string };
    world.claimTask(helper.id, task.id);
    world.finishTask(helper.id, task.id, "note");
    const agentAccept = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/accept`,
      payload: { participantId: helper.id },
    });
    expect(agentAccept.statusCode).toBe(403);
    const humanAccept = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/accept`,
      payload: { participantId: human.id },
    });
    expect(humanAccept.statusCode).toBe(200);
    const board = await app.inject({ method: "GET", url: "/api/help" });
    expect(board.json()).toMatchObject({ reputation: [expect.objectContaining({ id: helper.id })] });
    await app.close();
  });
});
