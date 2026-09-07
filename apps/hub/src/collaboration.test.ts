import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { CollaborationService } from "./collaboration.js";
import { registerHttp } from "./http.js";
import { BuilderTokenStore, OwnerStore } from "./tokens.js";
import { World } from "./world.js";

const roots: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "district-collaboration-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
  const dir = tempDir();
  const world = new World();
  const service = new CollaborationService(world, dir);
  const owner = service.register({
    handle: "owner",
    displayName: "Owner",
    skills: ["product"],
  });
  const provider = service.register({
    handle: "provider",
    displayName: "Provider",
    skills: ["typescript"],
  });
  return { dir, world, service, owner, provider };
}

describe("builder collaboration", () => {
  it("keeps private mission content out of public snapshots and deltas", () => {
    const { world, service, owner } = setup();
    const mission = service.createMission(owner.id, {
      title: "Secret launch",
      outcome: "Private source ships",
      visibility: "private",
    });
    const agent = world.upsertAgent({ id: "owner_agent", name: "Owner Agent" });
    service.bindAgent(owner.id, agent.id);
    world.takeDelta();
    const task = world.createTask({
      title: "Private task",
      body: "secret",
      missionId: mission.id,
      helpWanted: true,
    });
    expect(task.helpWanted).toBeUndefined();
    world.claimTask(agent.id, task.id);
    world.toolEvent(agent.id, {
      server: "github",
      tool: "get_file",
      summary: "reading secret launch plan",
    });
    const publicSnapshot = world.snapshot();
    expect(publicSnapshot).toMatchObject({
      missions: [],
      tasks: [],
      agents: [expect.objectContaining({ bubble: "Working privately" })],
    });
    expect(JSON.stringify(publicSnapshot)).not.toContain("reading secret launch plan");
    expect(JSON.stringify(publicSnapshot)).not.toContain("Private task");
    expect(JSON.stringify(world.dashboard())).not.toContain("Private task");
    expect(JSON.stringify(world.helpWantedBoard())).not.toContain("Private task");
    expect(JSON.stringify(world.listHelpWanted())).not.toContain("Private task");
    for (const building of world.buildings) {
      expect(JSON.stringify(world.buildingCard(building.id))).not.toContain("reading secret launch plan");
    }
    const delta = world.takeDelta();
    expect(delta?.missions).toEqual([]);
    expect(delta?.tasks).toEqual([]);
    expect(JSON.stringify(delta?.events)).not.toContain("reading secret launch plan");
    expect(JSON.stringify(delta?.events)).not.toContain("Private task");
    expect(service.workspace(owner.id).missions).toEqual([
      expect.objectContaining({ id: mission.id, title: "Secret launch" }),
    ]);
    expect(JSON.stringify(service.workspace(owner.id).events)).toContain(
      "reading secret launch plan",
    );
  });

  it("uses expiring single-use invites to build a durable relationship", () => {
    const { service, owner, provider } = setup();
    const mission = service.createMission(owner.id, {
      title: "Build together",
      outcome: "PR merged",
      visibility: "private",
    });
    const { token } = service.createInvite(owner.id, mission.id, 72);
    service.acceptInvite(provider.id, token);
    expect(service.acceptInvite(provider.id, token).id).toBe(mission.id);
    expect(service.workspace(owner.id).relationships).toEqual([
      expect.objectContaining({
        builderId: provider.id,
        sharedMissionIds: [mission.id],
      }),
    ]);
    const nextMission = service.createMission(owner.id, {
      title: "Build together again",
      outcome: "Second PR merged",
      visibility: "private",
    });
    const targeted = service.createInvite(owner.id, nextMission.id, 72, provider.id);
    expect(service.workspace(provider.id).notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "invite", inviteId: targeted.invite.id }),
      ]),
    );
    service.acceptTargetedInvite(provider.id, targeted.invite.id);
    expect(service.workspace(provider.id).missions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: nextMission.id })]),
    );
  });

  it("requires an explicit mission for activity when an agent has multiple private missions", () => {
    const { world, service, owner } = setup();
    const agent = world.upsertAgent({ id: "multi_agent", name: "Multi Agent" });
    service.bindAgent(owner.id, agent.id);
    const first = service.createMission(owner.id, { title: "First", outcome: "One" });
    const second = service.createMission(owner.id, { title: "Second", outcome: "Two" });
    world.joinMission(first.id, agent.id);
    world.joinMission(second.id, agent.id);
    expect(() => service.resolveAgentActivityMission(agent.id)).toThrow(/missionId is required/);
    expect(service.resolveAgentActivityMission(agent.id, second.id)).toBe(second.id);
  });

  it("grants and revokes metadata-only capabilities", () => {
    const { world, service, owner, provider } = setup();
    const providerAgent = world.upsertAgent({ id: "agent_provider", name: "Provider Agent" });
    const enrollment = service.createFleetEnrollment(provider.id);
    service.enrollAgent(providerAgent.id, enrollment.token);
    expect(() => service.enrollAgent("another_agent", enrollment.token)).toThrow(/no longer valid/);
    const mission = service.createMission(owner.id, {
      title: "Repository work",
      outcome: "Issue fixed",
    });
    service.acceptInvite(provider.id, service.createInvite(owner.id, mission.id, 72).token);
    const resource = service.addResource(owner.id, mission.id, {
      kind: "github_repo",
      label: "App",
      url: "https://github.com/example/app",
    });
    const grant = service.grant(owner.id, mission.id, {
      resourceId: resource.id,
      granteeAgentId: providerAgent.id,
      actions: ["contents:read", "pull_requests:create"],
    });
    expect(service.activeGrantsForAgent(providerAgent.id)).toEqual([grant]);
    expect(service.agentWorkspace(providerAgent.id)).toMatchObject({
      agentId: providerAgent.id,
      builder: { id: provider.id },
      resources: [{ id: resource.id }],
    });
    service.revokeGrant(owner.id, grant.id);
    expect(service.activeGrantsForAgent(providerAgent.id)).toEqual([]);
    expect(JSON.stringify(resource)).not.toContain("token");
  });

  it("enforces agreement parties and records approval as relationship evidence", () => {
    const { world, service, owner, provider } = setup();
    const mission = service.createMission(owner.id, {
      title: "Contracted work",
      outcome: "Artifact approved",
    });
    service.acceptInvite(provider.id, service.createInvite(owner.id, mission.id, 72).token);
    const task = world.createTask({ title: "Produce patch", body: "", missionId: mission.id });
    const agreement = service.createAgreement(owner.id, {
      missionId: mission.id,
      taskId: task.id,
      providerBuilderId: provider.id,
      title: "Produce patch",
      acceptanceCriteria: ["Tests pass", "Owner approves"],
      consideration: {
        kind: "external",
        amountMinor: 10000,
        currency: "USD",
        externalReference: "https://escrow.example/agreement/1",
      },
    });
    expect(() => service.transitionAgreement(owner.id, agreement.id, "accept")).toThrow(
      /provider/,
    );
    service.transitionAgreement(provider.id, agreement.id, "accept");
    expect(task.status).toBe("assigned");
    service.transitionAgreement(provider.id, agreement.id, "start");
    expect(task.status).toBe("doing");
    service.transitionAgreement(provider.id, agreement.id, "deliver", {
      deliveryNote: "https://github.com/example/app/pull/1",
    });
    expect(task).toMatchObject({ status: "done", accepted: false });
    service.transitionAgreement(owner.id, agreement.id, "approve");
    expect(task).toMatchObject({ status: "done", accepted: true, acceptedBy: owner.id });
    expect(service.workspace(owner.id).relationships[0]).toMatchObject({
      builderId: provider.id,
      approvedAgreements: 1,
    });
  });

  it("lets another builder discover and claim a public agreement without exposing settlement URLs", () => {
    const { service, owner, provider } = setup();
    const mission = service.createMission(owner.id, {
      title: "Open source release",
      outcome: "Public issue closed",
      visibility: "public",
    });
    const agreement = service.createAgreement(owner.id, {
      missionId: mission.id,
      openToBuilders: true,
      title: "Fix public issue",
      acceptanceCriteria: ["PR passes CI"],
      consideration: {
        kind: "external",
        amountMinor: 5000,
        currency: "USD",
        externalReference: "https://escrow.example/private/1",
      },
    });
    expect(JSON.stringify(service.opportunities())).not.toContain("escrow.example");
    expect(() => service.claimAgreement(owner.id, agreement.id)).toThrow(/own agreement/);
    service.claimAgreement(provider.id, agreement.id);
    service.transitionAgreement(provider.id, agreement.id, "accept");
    expect(service.workspace(provider.id).agreements).toEqual([
      expect.objectContaining({ id: agreement.id, status: "accepted" }),
    ]);
  });

  it("rejects impossible and self-dealing agreement parties", () => {
    const { world, service, owner, provider } = setup();
    const third = service.register({ handle: "third", displayName: "Third", skills: [] });
    const agent = world.upsertAgent({ id: "third_agent", name: "Third Agent" });
    service.bindAgent(third.id, agent.id);
    const mission = service.createMission(owner.id, {
      title: "Party validation",
      outcome: "Valid agreement",
      visibility: "public",
    });
    service.acceptInvite(provider.id, service.createInvite(owner.id, mission.id, 72).token);
    service.acceptInvite(third.id, service.createInvite(owner.id, mission.id, 72).token);
    const base = {
      missionId: mission.id,
      title: "Work",
      acceptanceCriteria: ["Done"],
      consideration: { kind: "volunteer" as const },
    };
    expect(() => service.createAgreement(owner.id, base)).toThrow(/needs a provider/);
    expect(() =>
      service.createAgreement(owner.id, { ...base, providerBuilderId: owner.id }),
    ).toThrow(/different builders/);
    expect(() =>
      service.createAgreement(owner.id, {
        ...base,
        providerBuilderId: provider.id,
        providerAgentId: agent.id,
      }),
    ).toThrow(/does not belong/);
    expect(() =>
      service.createAgreement(provider.id, { ...base, openToBuilders: true }),
    ).toThrow(/only the mission owner/);
  });

  it("persists blocker notifications for mission participants without active tasks", () => {
    const { dir, world, service, owner } = setup();
    const agent = world.upsertAgent({ id: "blocked_agent", name: "Blocked Agent" });
    service.bindAgent(owner.id, agent.id);
    const mission = service.createMission(owner.id, {
      title: "Blocked mission",
      outcome: "Unblocked",
      visibility: "private",
    });
    world.joinMission(mission.id, agent.id);
    service.notifyBlocked(agent.id, "Need a decision");
    const reloaded = new CollaborationService(world, dir);
    expect(reloaded.workspace(owner.id).notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "blocked", missionId: mission.id }),
      ]),
    );
  });

  it("rejects self-invites and invitations to completed missions", () => {
    const { world, service, owner, provider } = setup();
    const mission = service.createMission(owner.id, {
      title: "Invite validation",
      outcome: "Valid membership",
    });
    const invite = service.createInvite(owner.id, mission.id, 72);
    expect(() => service.acceptInvite(owner.id, invite.token)).toThrow(/own invite/);
    const revoked = service.createInvite(owner.id, mission.id, 72);
    service.revokeInvite(owner.id, revoked.invite.id);
    expect(() => service.acceptInvite(provider.id, revoked.token)).toThrow(/no longer valid/);
    world.setMissionStatus(mission.id, "completed");
    expect(() => service.createInvite(owner.id, mission.id, 72)).toThrow(/completed/);
  });

  it("authorizes direct MCP-backed activity routes and keeps fleet ids reserved", async () => {
    const { dir, world, service, owner, provider } = setup();
    const owners = new OwnerStore(dir);
    const builderTokens = new BuilderTokenStore(dir);
    const app = Fastify({ logger: false });
    registerHttp(app, world, owners, builderTokens, service);
    const agent = world.upsertAgent({ id: "route_agent", name: "Route Agent" });
    service.bindAgent(provider.id, agent.id);
    const token = owners.claim(agent.id)!;
    const mission = service.createMission(owner.id, {
      title: "Private route",
      outcome: "Authorized event",
      visibility: "private",
    });
    const denied = await app.inject({
      method: "POST",
      url: `/api/agents/${agent.id}/tool`,
      headers: { "x-district-token": token },
      payload: {
        server: "github",
        tool: "read",
        summary: "must not be injected",
        missionId: mission.id,
      },
    });
    expect(denied.statusCode).toBe(403);
    service.acceptInvite(provider.id, service.createInvite(owner.id, mission.id, 72).token);
    const allowed = await app.inject({
      method: "POST",
      url: `/api/agents/${agent.id}/blocked`,
      headers: { "x-district-token": token },
      payload: { reason: "Need owner", missionId: mission.id },
    });
    expect(allowed.statusCode).toBe(200);
    expect(service.workspace(owner.id).notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "blocked" })]),
    );
    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/agents/${agent.id}/heartbeat`,
      headers: { "x-district-token": token },
      payload: { bubble: "secret customer name", currentTool: "secret/file.txt" },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.body).not.toContain("secret customer");
    expect(heartbeat.body).not.toContain("secret/file.txt");
    const despawned = await app.inject({
      method: "POST",
      url: `/api/agents/${agent.id}/despawn`,
      headers: { "x-district-token": token },
    });
    expect(despawned.statusCode).toBe(200);
    expect(owners.verify(agent.id, token)).toBe(true);
    const hijack = await app.inject({
      method: "POST",
      url: "/api/agents/upsert",
      payload: { id: agent.id, name: "Hijacker" },
    });
    expect(hijack.statusCode).toBe(403);
    await app.close();
  });

  it("registers and authenticates a builder over HTTP", async () => {
    const dir = tempDir();
    const world = new World();
    const owners = new OwnerStore(dir);
    const builderTokens = new BuilderTokenStore(dir);
    const service = new CollaborationService(world, dir);
    const app = Fastify({ logger: false });
    registerHttp(app, world, owners, builderTokens, service);

    const registered = await app.inject({
      method: "POST",
      url: "/api/builders/register",
      payload: { handle: "real_builder", displayName: "Real Builder", skills: ["ops"] },
    });
    expect(registered.statusCode).toBe(200);
    const profile = registered.json() as { id: string };
    const token = registered.headers["x-builder-token"];
    expect(token).toBeTypeOf("string");

    const denied = await app.inject({ method: "GET", url: "/api/workspace" });
    expect(denied.statusCode).toBe(401);
    const agentCannotApprove = await app.inject({
      method: "POST",
      url: "/api/agreements/fake/approve",
      headers: { "x-district-token": "agent-token-is-not-a-builder-token" },
      payload: {},
    });
    expect(agentCannotApprove.statusCode).toBe(401);
    const workspace = await app.inject({
      method: "GET",
      url: "/api/workspace",
      headers: { "x-builder-id": profile.id, "x-builder-token": String(token) },
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({
      builder: { id: profile.id, displayName: "Real Builder" },
    });
    world.upsertAgent({ id: "visitor_local", name: "Visitor", sprite: "visitor" });
    const presence = await app.inject({
      method: "POST",
      url: "/api/builders/me/presence",
      headers: { "x-builder-id": profile.id, "x-builder-token": String(token) },
      payload: { visitorId: "visitor_local" },
    });
    expect(presence.statusCode).toBe(200);
    const twinBuilders = await app.inject({
      method: "POST",
      url: "/api/mcp/list_builders",
      payload: {},
    });
    expect(twinBuilders.statusCode).toBe(200);
    expect(twinBuilders.json()).toEqual([
      expect.objectContaining({ id: profile.id }),
    ]);
    await app.close();
  });
});
