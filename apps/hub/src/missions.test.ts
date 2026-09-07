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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "district-mission-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.DATA_DIR;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("live missions", () => {
  it("coordinates two humans and two agents around persisted tasks", () => {
    const dir = tempDir();
    process.env.DATA_DIR = dir;
    const world = new World();
    const humanA = world.upsertAgent({ id: "visitor_alpha", name: "Alex", sprite: "visitor" });
    const humanB = world.upsertAgent({ id: "visitor_beta", name: "Blair", sprite: "visitor" });
    const agentA = world.upsertAgent({ id: "agent_research", name: "Scout" });
    const agentB = world.upsertAgent({ id: "agent_build", name: "Maker" });
    const mission = world.createMission({
      title: "Launch brief",
      outcome: "A reviewed brief is ready to publish",
      participantId: humanA.id,
    });
    world.joinMission(mission.id, humanB.id);
    const research = world.createTask({
      title: "Research",
      body: "",
      missionId: mission.id,
      agentId: agentA.id,
    });
    const build = world.createTask({
      title: "Draft",
      body: "",
      missionId: mission.id,
      agentId: agentB.id,
    });
    world.claimTask(agentA.id, research.id);
    world.finishTask(agentA.id, research.id, "Sources attached");
    world.claimTask(agentB.id, build.id);
    world.finishTask(agentB.id, build.id, "Draft attached");
    world.setMissionStatus(mission.id, "completed");
    world.persist();

    const restored = World.loadFromDisk();
    expect(restored.requireMission(mission.id).status).toBe("completed");
    expect(restored.requireMission(mission.id).participantIds).toEqual(
      expect.arrayContaining([humanA.id, humanB.id, agentA.id, agentB.id]),
    );
    expect(
      restored.tasks.filter(
        (task) => task.missionId === mission.id && task.kind !== "artifact" && task.status === "done",
      ),
    ).toHaveLength(2);
    expect(restored.tasks.filter((task) => task.missionId === mission.id && task.kind === "artifact")).toHaveLength(2);
  });

  it("exposes create, join, status, and mission task routes", async () => {
    const dir = tempDir();
    const app = Fastify({ logger: false });
    const world = new World();
    registerHttp(app, world, new OwnerStore(dir));

    const created = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { title: "Ship", outcome: "Release is live", participantId: "visitor_one" },
    });
    expect(created.statusCode).toBe(200);
    const mission = created.json() as { id: string };

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/missions/${mission.id}/join`,
          payload: { participantId: "visitor_two" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          payload: { title: "Verify", body: "", missionId: mission.id, agentId: "agent_a" },
        })
      ).statusCode,
    ).toBe(200);
    const completed = await app.inject({
      method: "POST",
      url: `/api/missions/${mission.id}/status`,
      payload: { status: "completed" },
    });
    expect(completed.json()).toMatchObject({ status: "completed" });
    await app.close();
  });
});
