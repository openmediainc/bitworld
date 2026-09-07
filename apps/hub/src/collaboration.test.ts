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
    const task = world.createTask({ title: "Private task", body: "secret", missionId: mission.id });
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
    expect(() => service.acceptInvite(provider.id, token)).toThrow(/no longer valid/);
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
      actions: ["contents:read", "pull_requests:write"],
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
    const { service, owner, provider } = setup();
    const mission = service.createMission(owner.id, {
      title: "Contracted work",
      outcome: "Artifact approved",
    });
    service.acceptInvite(provider.id, service.createInvite(owner.id, mission.id, 72).token);
    const agreement = service.createAgreement(owner.id, {
      missionId: mission.id,
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
    service.transitionAgreement(provider.id, agreement.id, "start");
    service.transitionAgreement(provider.id, agreement.id, "deliver", {
      deliveryNote: "https://github.com/example/app/pull/1",
    });
    service.transitionAgreement(owner.id, agreement.id, "approve");
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
    service.claimAgreement(provider.id, agreement.id);
    service.transitionAgreement(provider.id, agreement.id, "accept");
    expect(service.workspace(provider.id).agreements).toEqual([
      expect.objectContaining({ id: agreement.id, status: "accepted" }),
    ]);
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
    await app.close();
  });
});
