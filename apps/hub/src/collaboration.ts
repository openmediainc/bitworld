import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  AgreementStatus,
  AgentWorkspace,
  BuilderNotification,
  BuilderProfile,
  CapabilityGrant,
  CollaborationAudit,
  CollaborationWorkspace,
  Mission,
  MissionInvite,
  MissionResource,
  RelationshipSummary,
  WorkAgreement,
  WorkConsideration,
} from "@district/shared";
import type { World } from "./world.js";
import { GitHubConnector } from "./github.js";

type StoredInvite = MissionInvite & { tokenHash: string };
type FleetEnrollment = {
  id: string;
  builderId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  agentId?: string;
};
type CollaborationBlob = {
  builders: BuilderProfile[];
  invites: StoredInvite[];
  resources: MissionResource[];
  grants: CapabilityGrant[];
  agreements: WorkAgreement[];
  notifications: BuilderNotification[];
  audit: CollaborationAudit[];
  fleetEnrollments: FleetEnrollment[];
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

function atomicWrite(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export class CollaborationService {
  builders: BuilderProfile[] = [];
  invites: StoredInvite[] = [];
  resources: MissionResource[] = [];
  grants: CapabilityGrant[] = [];
  agreements: WorkAgreement[] = [];
  notifications: BuilderNotification[] = [];
  audit: CollaborationAudit[] = [];
  fleetEnrollments: FleetEnrollment[] = [];
  private readonly file: string;
  private readonly github = new GitHubConnector();

  constructor(
    private readonly world: World,
    private readonly dir: string,
  ) {
    this.file = path.join(dir, "collaboration.json");
    try {
      const blob = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<CollaborationBlob>;
      this.builders = blob.builders ?? [];
      this.invites = blob.invites ?? [];
      this.resources = blob.resources ?? [];
      this.grants = blob.grants ?? [];
      this.agreements = blob.agreements ?? [];
      this.notifications = blob.notifications ?? [];
      this.audit = blob.audit ?? [];
      this.fleetEnrollments = blob.fleetEnrollments ?? [];
    } catch {
      /* first run */
    }
    if (process.env.DISTRICT_NOTIFICATION_WEBHOOK) {
      queueMicrotask(() => {
        for (const notification of this.notifications.filter((item) => !item.webhookDeliveredAt)) {
          this.dispatchNotification(notification);
        }
      });
    }
  }

  persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomicWrite(this.file, {
      builders: this.builders,
      invites: this.invites,
      resources: this.resources,
      grants: this.grants,
      agreements: this.agreements,
      notifications: this.notifications,
      audit: this.audit.slice(-5000),
      fleetEnrollments: this.fleetEnrollments.slice(-1000),
    } satisfies CollaborationBlob);
  }

  register(input: {
    handle: string;
    displayName: string;
    bio?: string;
    skills: string[];
    availability?: BuilderProfile["availability"];
    collaborationTerms?: string;
  }): BuilderProfile {
    if (this.builders.some((builder) => builder.handle === input.handle)) {
      fail("builder handle is already taken", 409);
    }
    const now = Date.now();
    const builder: BuilderProfile = {
      id: `builder_${nanoid(12)}`,
      handle: input.handle,
      displayName: input.displayName,
      bio: input.bio,
      skills: input.skills,
      availability: input.availability ?? "available",
      collaborationTerms: input.collaborationTerms,
      agentIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.builders.push(builder);
    this.record("builder", builder.id, "builder.registered", "builder", builder.id);
    this.persist();
    return builder;
  }

  requireBuilder(id: string): BuilderProfile {
    const builder = this.builders.find((item) => item.id === id);
    if (!builder) fail("builder not found", 404);
    return builder;
  }

  publicBuilders(): BuilderProfile[] {
    return this.builders.map(({ visitorId: _visitorId, ...builder }) => builder);
  }

  updateBuilder(
    id: string,
    input: {
      displayName?: string;
      bio?: string;
      skills?: string[];
      availability?: BuilderProfile["availability"];
      collaborationTerms?: string;
    },
  ): BuilderProfile {
    const builder = this.requireBuilder(id);
    if (input.displayName !== undefined) builder.displayName = input.displayName;
    if (input.bio !== undefined) builder.bio = input.bio;
    if (input.skills !== undefined) builder.skills = input.skills;
    if (input.availability !== undefined) builder.availability = input.availability;
    if (input.collaborationTerms !== undefined) builder.collaborationTerms = input.collaborationTerms;
    builder.updatedAt = Date.now();
    this.record("builder", id, "builder.updated", "builder", id);
    this.persist();
    return builder;
  }

  recordTokenRotation(builderId: string): void {
    this.requireBuilder(builderId);
    this.record("builder", builderId, "builder.token_rotated", "builder", builderId);
    this.persist();
  }

  bindAgent(builderId: string, agentId: string): BuilderProfile {
    const builder = this.requireBuilder(builderId);
    const current = this.builders.find((item) => item.agentIds.includes(agentId));
    if (current && current.id !== builderId) fail("agent is already bound to another builder", 409);
    if (!this.world.agents.has(agentId)) fail("agent must be connected before it can join a fleet", 409);
    if (!builder.agentIds.includes(agentId)) builder.agentIds.push(agentId);
    builder.updatedAt = Date.now();
    this.record("builder", builderId, "fleet.agent_bound", "agent", agentId);
    this.persist();
    return builder;
  }

  createFleetEnrollment(builderId: string, expiresInMinutes = 15) {
    this.requireBuilder(builderId);
    const token = crypto.randomBytes(24).toString("base64url");
    const enrollment: FleetEnrollment = {
      id: `fleet_${nanoid(12)}`,
      builderId,
      tokenHash: sha256(token),
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresInMinutes * 60 * 1000,
    };
    this.fleetEnrollments.push(enrollment);
    this.record("builder", builderId, "fleet.enrollment_created", "fleet_enrollment", enrollment.id);
    this.persist();
    return { token, expiresAt: enrollment.expiresAt };
  }

  enrollAgent(agentId: string, token: string): BuilderProfile {
    const enrollment = this.fleetEnrollments.find((item) => item.tokenHash === sha256(token));
    if (!enrollment) fail("fleet enrollment not found", 404);
    if (enrollment.usedAt || enrollment.expiresAt <= Date.now()) {
      fail("fleet enrollment is no longer valid", 409);
    }
    enrollment.usedAt = Date.now();
    enrollment.agentId = agentId;
    let builder: BuilderProfile;
    try {
      builder = this.bindAgent(enrollment.builderId, agentId);
    } catch (error) {
      enrollment.usedAt = undefined;
      enrollment.agentId = undefined;
      throw error;
    }
    this.record("agent", agentId, "fleet.enrolled", "builder", builder.id);
    this.persist();
    return builder;
  }

  bindVisitor(builderId: string, visitorId: string): BuilderProfile {
    const builder = this.requireBuilder(builderId);
    const visitor = this.world.agents.get(visitorId);
    if (!visitor || visitor.sprite !== "visitor") fail("visitor must be connected", 409);
    builder.visitorId = visitorId;
    builder.updatedAt = Date.now();
    this.record("builder", builderId, "presence.bound", "visitor", visitorId);
    this.persist();
    return builder;
  }

  builderForAgent(agentId: string): BuilderProfile | undefined {
    return this.builders.find((builder) => builder.agentIds.includes(agentId));
  }

  agentWorkspace(agentId: string): AgentWorkspace {
    const builder = this.builderForAgent(agentId);
    if (!builder) fail("agent is not enrolled in a builder fleet", 403);
    const missions = this.world.missions.filter((mission) => mission.builderIds?.includes(builder.id));
    const missionIds = new Set(missions.map((mission) => mission.id));
    const grants = this.activeGrantsForAgent(agentId);
    const resourceIds = new Set(grants.map((grant) => grant.resourceId));
    const { visitorId: _visitorId, ...safeBuilder } = builder;
    return {
      agentId,
      builder: safeBuilder,
      missions,
      tasks: this.world.tasks.filter((task) => task.missionId && missionIds.has(task.missionId)),
      resources: this.resources.filter((resource) => resourceIds.has(resource.id)),
      grants,
      agreements: this.agreements.filter(
        (agreement) =>
          agreement.providerBuilderId === builder.id &&
          (!agreement.providerAgentId || agreement.providerAgentId === agentId),
      ),
    };
  }

  requireAgentMissionAccess(agentId: string, missionId: string): BuilderProfile {
    const mission = this.world.missions.find((item) => item.id === missionId);
    if (!mission) fail("mission not found", 404);
    const builder = this.builderForAgent(agentId);
    if (!builder || !mission.builderIds?.includes(builder.id)) {
      fail("agent's builder has not joined this private mission", 403);
    }
    return builder;
  }

  createMission(
    builderId: string,
    input: { title: string; outcome: string; visibility?: "public" | "private"; helpWanted?: boolean },
  ): Mission {
    this.requireBuilder(builderId);
    const visibility = input.visibility ?? "private";
    if (visibility === "private" && input.helpWanted) {
      fail("private missions cannot appear on the public help-wanted board");
    }
    const mission = this.world.createMission({
      title: input.title,
      outcome: input.outcome,
      helpWanted: visibility === "public" ? input.helpWanted : false,
    });
    mission.visibility = visibility;
    mission.ownerBuilderId = builderId;
    mission.builderIds = [builderId];
    this.world.dirtyMissions = true;
    this.record("builder", builderId, "mission.created", "mission", mission.id, mission.id, {
      visibility,
    });
    this.world.persistToDirectory(this.dir);
    this.persist();
    return mission;
  }

  accessibleMissions(builderId: string): Mission[] {
    return this.world.missions.filter(
      (mission) =>
        (!mission.ownerBuilderId && mission.visibility !== "private") ||
        mission.ownerBuilderId === builderId ||
        mission.builderIds?.includes(builderId),
    );
  }

  requireMember(builderId: string, missionId: string): Mission {
    this.requireBuilder(builderId);
    const mission = this.world.missions.find((item) => item.id === missionId);
    if (!mission) fail("mission not found", 404);
    if (
      mission.ownerBuilderId &&
      mission.ownerBuilderId !== builderId &&
      !mission.builderIds?.includes(builderId)
    ) {
      fail("builder cannot access this mission", 403);
    }
    if (mission.visibility === "private" && !mission.ownerBuilderId) {
      fail("private mission has no controlling builder", 403);
    }
    return mission;
  }

  requireOwner(builderId: string, missionId: string): Mission {
    const mission = this.requireMember(builderId, missionId);
    if (mission.ownerBuilderId !== builderId) fail("only the mission owner can do this", 403);
    return mission;
  }

  createInvite(
    builderId: string,
    missionId: string,
    expiresInHours: number,
    inviteeBuilderId?: string,
  ) {
    const mission = this.requireOwner(builderId, missionId);
    const recent = this.invites.filter(
      (invite) => invite.createdBy === builderId && invite.createdAt > Date.now() - 60 * 60 * 1000,
    );
    if (recent.length >= 20) fail("invite rate limit exceeded", 429);
    if (inviteeBuilderId) {
      this.requireBuilder(inviteeBuilderId);
      if (mission.builderIds?.includes(inviteeBuilderId)) fail("builder is already in the mission", 409);
      if (
        this.invites.some(
          (invite) =>
            invite.missionId === missionId &&
            invite.inviteeBuilderId === inviteeBuilderId &&
            !invite.acceptedAt &&
            !invite.revokedAt &&
            invite.expiresAt > Date.now(),
        )
      ) {
        fail("an active invite already exists for this builder", 409);
      }
    }
    const token = crypto.randomBytes(24).toString("base64url");
    const invite: StoredInvite = {
      id: `invite_${nanoid(12)}`,
      missionId,
      createdBy: builderId,
      inviteeBuilderId,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresInHours * 60 * 60 * 1000,
      tokenHash: sha256(token),
    };
    this.invites.push(invite);
    if (inviteeBuilderId) {
      this.notify(
        inviteeBuilderId,
        "invite",
        `${this.requireBuilder(builderId).displayName} invited you to ${mission.title}`,
        mission.id,
        undefined,
        invite.id,
      );
    }
    this.record("builder", builderId, "invite.created", "invite", invite.id, missionId);
    this.persist();
    return { invite: this.publicInvite(invite), token };
  }

  acceptInvite(builderId: string, token: string): Mission {
    this.requireBuilder(builderId);
    const hash = sha256(token);
    const invite = this.invites.find((item) => item.tokenHash === hash);
    if (!invite) fail("invite not found", 404);
    return this.acceptStoredInvite(builderId, invite);
  }

  acceptTargetedInvite(builderId: string, inviteId: string): Mission {
    const invite = this.invites.find((item) => item.id === inviteId);
    if (!invite || invite.inviteeBuilderId !== builderId) fail("invite not found", 404);
    return this.acceptStoredInvite(builderId, invite);
  }

  private acceptStoredInvite(builderId: string, invite: StoredInvite): Mission {
    this.requireBuilder(builderId);
    if (invite.inviteeBuilderId && invite.inviteeBuilderId !== builderId) {
      fail("invite belongs to another builder", 403);
    }
    if (invite.revokedAt || invite.acceptedAt || invite.expiresAt <= Date.now()) {
      fail("invite is no longer valid", 409);
    }
    const mission = this.world.missions.find((item) => item.id === invite.missionId);
    if (!mission) fail("mission not found", 404);
    mission.builderIds = [...new Set([...(mission.builderIds ?? []), builderId])];
    invite.acceptedBy = builderId;
    invite.acceptedAt = Date.now();
    this.world.dirtyMissions = true;
    this.notify(builderId, "invite", `Joined ${mission.title}`, mission.id);
    this.notify(invite.createdBy, "invite", `${this.requireBuilder(builderId).displayName} joined ${mission.title}`, mission.id);
    this.record("builder", builderId, "invite.accepted", "mission", mission.id, mission.id);
    this.world.persistToDirectory(this.dir);
    this.persist();
    return mission;
  }

  addResource(
    builderId: string,
    missionId: string,
    input: {
      kind: MissionResource["kind"];
      label: string;
      url: string;
      providerInstallationId?: number;
    },
  ): MissionResource {
    this.requireOwner(builderId, missionId);
    const parsed = new URL(input.url);
    if (!["https:", "http:"].includes(parsed.protocol)) fail("resource URL must use http or https");
    const resource: MissionResource = {
      id: `resource_${nanoid(12)}`,
      missionId,
      kind: input.kind,
      label: input.label,
      url: input.url,
      providerInstallationId: input.providerInstallationId,
      createdBy: builderId,
      createdAt: Date.now(),
    };
    this.resources.push(resource);
    this.record("builder", builderId, "resource.linked", "resource", resource.id, missionId, {
      kind: resource.kind,
      host: parsed.host,
    });
    this.persist();
    return resource;
  }

  grant(
    builderId: string,
    missionId: string,
    input: {
      resourceId: string;
      granteeBuilderId?: string;
      granteeAgentId?: string;
      actions: string[];
      expiresAt?: number;
    },
  ): CapabilityGrant {
    const mission = this.requireOwner(builderId, missionId);
    const resource = this.resources.find(
      (item) => item.id === input.resourceId && item.missionId === mission.id,
    );
    if (!resource) fail("resource not found in mission", 404);
    if (input.granteeBuilderId && !mission.builderIds?.includes(input.granteeBuilderId)) {
      fail("grantee builder has not joined the mission", 409);
    }
    if (input.granteeAgentId) {
      const owner = this.builderForAgent(input.granteeAgentId);
      if (!owner || !mission.builderIds?.includes(owner.id)) {
        fail("grantee agent must belong to a mission member", 409);
      }
    }
    const grant: CapabilityGrant = {
      id: `grant_${nanoid(12)}`,
      missionId,
      resourceId: resource.id,
      granteeBuilderId: input.granteeBuilderId,
      granteeAgentId: input.granteeAgentId,
      actions: [...new Set(input.actions)],
      createdBy: builderId,
      createdAt: Date.now(),
      expiresAt: input.expiresAt,
    };
    this.grants.push(grant);
    this.record("builder", builderId, "capability.granted", "grant", grant.id, missionId, {
      actions: grant.actions,
      granteeBuilderId: grant.granteeBuilderId,
      granteeAgentId: grant.granteeAgentId,
    });
    if (grant.granteeBuilderId) {
      this.notify(grant.granteeBuilderId, "assignment", `New capability for ${resource.label}`, missionId);
    }
    this.persist();
    return grant;
  }

  revokeGrant(builderId: string, grantId: string): CapabilityGrant {
    const grant = this.grants.find((item) => item.id === grantId);
    if (!grant) fail("grant not found", 404);
    this.requireOwner(builderId, grant.missionId);
    if (!grant.revokedAt) grant.revokedAt = Date.now();
    this.record("builder", builderId, "capability.revoked", "grant", grant.id, grant.missionId);
    this.persist();
    return grant;
  }

  activeGrantsForAgent(agentId: string): CapabilityGrant[] {
    const builder = this.builderForAgent(agentId);
    const now = Date.now();
    return this.grants.filter(
      (grant) =>
        !grant.revokedAt &&
        (!grant.expiresAt || grant.expiresAt > now) &&
        (grant.granteeAgentId === agentId || grant.granteeBuilderId === builder?.id),
    );
  }

  async executeGitHub(
    agentId: string,
    resourceId: string,
    action: "issues:read" | "issues:comment" | "contents:read" | "contents:write" | "branches:create" | "pull_requests:create",
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const resource = this.resources.find((item) => item.id === resourceId);
    if (!resource || resource.kind !== "github_repo") fail("GitHub resource not found", 404);
    const grant = this.activeGrantsForAgent(agentId).find(
      (item) => item.resourceId === resourceId && item.actions.includes(action),
    );
    if (!grant) fail(`agent lacks ${action} on this resource`, 403);
    try {
      const result = await this.github.execute(resource, action, input);
      this.record("agent", agentId, "github.executed", "resource", resource.id, resource.missionId, {
        action,
        grantId: grant.id,
        status: "ok",
      });
      this.persist();
      return result;
    } catch (error) {
      this.record("agent", agentId, "github.executed", "resource", resource.id, resource.missionId, {
        action,
        grantId: grant.id,
        status: "error",
      });
      this.persist();
      throw error;
    }
  }

  notifyBlocked(agentId: string, reason: string): void {
    const missionIds = new Set(
      this.world.tasks
        .filter(
          (task) =>
            task.agentId === agentId &&
            task.missionId &&
            (task.status === "assigned" || task.status === "doing"),
        )
        .map((task) => task.missionId!),
    );
    for (const mission of this.world.missions) {
      if (!missionIds.has(mission.id) && !mission.participantIds.includes(agentId)) continue;
      for (const builderId of mission.builderIds ?? []) {
        this.notify(builderId, "blocked", `${agentId} is blocked: ${reason}`, mission.id);
      }
      this.record("agent", agentId, "agent.blocked", "mission", mission.id, mission.id, { reason });
    }
    if (missionIds.size) this.persist();
  }

  createAgreement(
    builderId: string,
    input: {
      missionId: string;
      taskId?: string;
      providerBuilderId?: string;
      providerAgentId?: string;
      openToBuilders?: boolean;
      title: string;
      acceptanceCriteria: string[];
      consideration: WorkConsideration;
    },
  ): WorkAgreement {
    const mission = this.requireMember(builderId, input.missionId);
    if (input.openToBuilders && mission.visibility === "private") {
      fail("private agreements cannot be listed publicly");
    }
    if (input.openToBuilders && (input.providerBuilderId || input.providerAgentId)) {
      fail("an open agreement cannot already have a provider");
    }
    if (input.providerBuilderId && !mission.builderIds?.includes(input.providerBuilderId)) {
      fail("provider must join the mission before receiving an agreement", 409);
    }
    if (input.providerAgentId) {
      const owner = this.builderForAgent(input.providerAgentId);
      if (!owner || !mission.builderIds?.includes(owner.id)) {
        fail("provider agent must belong to a mission member", 409);
      }
    }
    if (input.consideration.kind === "external") {
      if (
        input.consideration.amountMinor !== undefined &&
        !input.consideration.currency
      ) {
        fail("currency is required when an amount is recorded");
      }
      if (input.consideration.externalReference) {
        const protocol = new URL(input.consideration.externalReference).protocol;
        if (!["https:", "http:"].includes(protocol)) {
          fail("external settlement reference must use http or https");
        }
      }
    }
    const linkedTask = input.taskId
      ? this.world.tasks.find(
          (item) => item.id === input.taskId && item.missionId === mission.id,
        )
      : undefined;
    if (input.taskId && !linkedTask) fail("task not found in mission", 404);
    const agreement: WorkAgreement = {
      id: `agreement_${nanoid(12)}`,
      missionId: mission.id,
      taskId: input.taskId,
      requesterBuilderId: builderId,
      providerBuilderId: input.providerBuilderId,
      providerAgentId: input.providerAgentId,
      openToBuilders: input.openToBuilders || undefined,
      title: input.title,
      acceptanceCriteria: input.acceptanceCriteria,
      consideration: input.consideration,
      status: "proposed",
      createdAt: Date.now(),
    };
    this.agreements.push(agreement);
    if (linkedTask) {
      linkedTask.agreementId = agreement.id;
      this.world.dirtyTasks = true;
    }
    if (agreement.providerBuilderId) {
      this.notify(
        agreement.providerBuilderId,
        "assignment",
        `Agreement proposed: ${agreement.title}`,
        mission.id,
        agreement.id,
      );
    }
    this.record("builder", builderId, "agreement.proposed", "agreement", agreement.id, mission.id, {
      consideration: agreement.consideration.kind,
    });
    this.world.persistToDirectory(this.dir);
    this.persist();
    return agreement;
  }

  opportunities(): WorkAgreement[] {
    return this.agreements
      .filter(
        (agreement) => agreement.openToBuilders && agreement.status === "proposed" && !agreement.providerBuilderId,
      )
      .map((agreement) => ({
        ...agreement,
        consideration:
          agreement.consideration.kind === "external"
            ? {
                kind: "external" as const,
                amountMinor: agreement.consideration.amountMinor,
                currency: agreement.consideration.currency,
              }
            : agreement.consideration,
      }));
  }

  claimAgreement(builderId: string, agreementId: string): WorkAgreement {
    const builder = this.requireBuilder(builderId);
    const agreement = this.agreements.find((item) => item.id === agreementId);
    if (!agreement) fail("agreement not found", 404);
    if (!agreement.openToBuilders || agreement.status !== "proposed" || agreement.providerBuilderId) {
      fail("agreement is not open for claiming", 409);
    }
    const mission = this.world.missions.find((item) => item.id === agreement.missionId);
    if (!mission || mission.visibility === "private") fail("agreement is not public", 403);
    mission.builderIds = [...new Set([...(mission.builderIds ?? []), builderId])];
    agreement.providerBuilderId = builderId;
    agreement.openToBuilders = false;
    this.world.dirtyMissions = true;
    this.notify(agreement.requesterBuilderId, "assignment", `${builder.displayName} claimed ${agreement.title}`, mission.id, agreement.id);
    this.record("builder", builderId, "agreement.claimed", "agreement", agreement.id, mission.id);
    this.world.persistToDirectory(this.dir);
    this.persist();
    return agreement;
  }

  claimAgreementAsAgent(agentId: string, agreementId: string): WorkAgreement {
    const builder = this.builderForAgent(agentId);
    if (!builder) fail("agent is not enrolled in a builder fleet", 403);
    const agreement = this.claimAgreement(builder.id, agreementId);
    agreement.providerAgentId = agentId;
    this.record("agent", agentId, "agreement.claimed_for_fleet", "agreement", agreement.id, agreement.missionId);
    this.persist();
    return agreement;
  }

  transitionAgreement(
    builderId: string,
    agreementId: string,
    action: "accept" | "start" | "deliver" | "approve" | "dispute" | "cancel",
    input: { deliveryNote?: string; reason?: string } = {},
  ): WorkAgreement {
    const agreement = this.agreements.find((item) => item.id === agreementId);
    if (!agreement) fail("agreement not found", 404);
    this.requireMember(builderId, agreement.missionId);
    const requester = builderId === agreement.requesterBuilderId;
    const provider = builderId === agreement.providerBuilderId;
    const now = Date.now();
    const allowed: Record<typeof action, AgreementStatus[]> = {
      accept: ["proposed"],
      start: ["accepted"],
      deliver: ["accepted", "in_progress"],
      approve: ["delivered"],
      dispute: ["accepted", "in_progress", "delivered"],
      cancel: ["proposed", "accepted"],
    };
    if (!allowed[action].includes(agreement.status)) {
      fail(`cannot ${action} an agreement in ${agreement.status}`, 409);
    }
    if (["accept", "start", "deliver"].includes(action) && !provider) {
      fail("only the provider can do this", 403);
    }
    if (["approve", "cancel"].includes(action) && !requester) {
      fail("only the requester can do this", 403);
    }
    if (action === "dispute" && !requester && !provider) {
      fail("only an agreement party can dispute it", 403);
    }
    if (action === "accept") {
      agreement.status = "accepted";
      agreement.acceptedAt = now;
    } else if (action === "start") {
      agreement.status = "in_progress";
    } else if (action === "deliver") {
      if (!input.deliveryNote) fail("delivery note is required");
      agreement.status = "delivered";
      agreement.deliveryNote = input.deliveryNote;
      agreement.deliveredAt = now;
      this.notify(agreement.requesterBuilderId, "delivery", `Delivered: ${agreement.title}`, agreement.missionId, agreement.id);
    } else if (action === "approve") {
      agreement.status = "approved";
      agreement.approvedAt = now;
      if (agreement.providerBuilderId) {
        this.notify(agreement.providerBuilderId, "approval", `Approved: ${agreement.title}`, agreement.missionId, agreement.id);
      }
    } else if (action === "dispute") {
      if (!input.reason) fail("dispute reason is required");
      agreement.status = "disputed";
      agreement.disputeReason = input.reason;
      agreement.disputedAt = now;
      const other = requester ? agreement.providerBuilderId : agreement.requesterBuilderId;
      if (other) this.notify(other, "dispute", `Disputed: ${agreement.title}`, agreement.missionId, agreement.id);
    } else {
      agreement.status = "cancelled";
      agreement.cancelledAt = now;
    }
    this.record("builder", builderId, `agreement.${action}`, "agreement", agreement.id, agreement.missionId);
    this.persist();
    return agreement;
  }

  deliverAsAgent(agentId: string, agreementId: string, deliveryNote: string): WorkAgreement {
    const agreement = this.agreements.find((item) => item.id === agreementId);
    if (!agreement) fail("agreement not found", 404);
    const builder = this.builderForAgent(agentId);
    if (!builder || agreement.providerBuilderId !== builder.id) {
      fail("agent does not belong to the provider's fleet", 403);
    }
    if (agreement.providerAgentId && agreement.providerAgentId !== agentId) {
      fail("agreement is assigned to another agent", 403);
    }
    if (!["accepted", "in_progress"].includes(agreement.status)) {
      fail(`cannot deliver an agreement in ${agreement.status}`, 409);
    }
    agreement.providerAgentId = agreement.providerAgentId ?? agentId;
    agreement.status = "delivered";
    agreement.deliveryNote = deliveryNote;
    agreement.deliveredAt = Date.now();
    this.notify(agreement.requesterBuilderId, "delivery", `Delivered: ${agreement.title}`, agreement.missionId, agreement.id);
    this.record("agent", agentId, "agreement.deliver", "agreement", agreement.id, agreement.missionId);
    this.persist();
    return agreement;
  }

  workspace(builderId: string): CollaborationWorkspace {
    const builder = this.requireBuilder(builderId);
    const missions = this.accessibleMissions(builderId);
    const missionIds = new Set(missions.map((mission) => mission.id));
    const memberMissionIds = new Set(
      missions
        .filter(
          (mission) =>
            !mission.ownerBuilderId ||
            mission.ownerBuilderId === builderId ||
            mission.builderIds?.includes(builderId),
        )
        .map((mission) => mission.id),
    );
    const relatedBuilderIds = new Set<string>([builderId]);
    for (const mission of missions) {
      for (const id of mission.builderIds ?? []) relatedBuilderIds.add(id);
    }
    return {
      builder,
      builders: this.builders
        .filter((item) => relatedBuilderIds.has(item.id))
        .map((item) => {
          if (item.id === builderId) return item;
          const { visitorId: _visitorId, ...safe } = item;
          return safe;
        }),
      directory: this.publicBuilders(),
      missions,
      tasks: this.world.tasks.filter(
        (task) => !task.missionId || missionIds.has(task.missionId),
      ),
      invites: this.invites
        .filter((invite) => {
          const mission = this.world.missions.find((item) => item.id === invite.missionId);
          return invite.createdBy === builderId || mission?.builderIds?.includes(builderId);
        })
        .map((invite) => this.publicInvite(invite)),
      resources: this.resources.filter((item) => memberMissionIds.has(item.missionId)),
      grants: this.grants.filter((item) => memberMissionIds.has(item.missionId)),
      agreements: this.agreements.filter(
        (item) =>
          memberMissionIds.has(item.missionId) &&
          (item.requesterBuilderId === builderId || item.providerBuilderId === builderId),
      ),
      opportunities: this.opportunities(),
      notifications: this.notifications
        .filter((item) => item.builderId === builderId)
        .sort((a, b) => b.createdAt - a.createdAt),
      relationships: this.relationships(builderId),
      audit: this.audit
        .filter(
          (item) =>
            (item.missionId ? memberMissionIds.has(item.missionId) : item.actorId === builderId),
        )
        .slice(-250),
    };
  }

  markNotificationRead(builderId: string, notificationId: string): BuilderNotification {
    const notification = this.notifications.find(
      (item) => item.id === notificationId && item.builderId === builderId,
    );
    if (!notification) fail("notification not found", 404);
    notification.readAt = notification.readAt ?? Date.now();
    this.persist();
    return notification;
  }

  private relationships(builderId: string): RelationshipSummary[] {
    const map = new Map<string, RelationshipSummary>();
    for (const mission of this.world.missions) {
      if (!mission.builderIds?.includes(builderId)) continue;
      for (const otherId of mission.builderIds) {
        if (otherId === builderId) continue;
        const other = this.builders.find((builder) => builder.id === otherId);
        if (!other) continue;
        const current = map.get(otherId) ?? {
          builderId: otherId,
          displayName: other.displayName,
          sharedMissionIds: [],
          approvedAgreements: 0,
          lastCollaboratedAt: mission.createdAt,
        };
        current.sharedMissionIds.push(mission.id);
        current.lastCollaboratedAt = Math.max(
          current.lastCollaboratedAt,
          mission.completedAt ?? mission.createdAt,
        );
        map.set(otherId, current);
      }
    }
    for (const agreement of this.agreements) {
      if (agreement.status !== "approved" || !agreement.providerBuilderId) continue;
      const otherId =
        agreement.requesterBuilderId === builderId
          ? agreement.providerBuilderId
          : agreement.providerBuilderId === builderId
            ? agreement.requesterBuilderId
            : undefined;
      if (otherId && map.has(otherId)) map.get(otherId)!.approvedAgreements += 1;
    }
    return [...map.values()].sort((a, b) => b.lastCollaboratedAt - a.lastCollaboratedAt);
  }

  private notify(
    builderId: string,
    kind: BuilderNotification["kind"],
    text: string,
    missionId?: string,
    agreementId?: string,
    inviteId?: string,
  ): void {
    const notification: BuilderNotification = {
      id: `notification_${nanoid(12)}`,
      builderId,
      kind,
      text,
      missionId,
      agreementId,
      inviteId,
      createdAt: Date.now(),
    };
    this.notifications.push(notification);
    this.dispatchNotification(notification);
  }

  private dispatchNotification(notification: BuilderNotification): void {
    const webhook = process.env.DISTRICT_NOTIFICATION_WEBHOOK;
    if (!webhook) return;
    const builder = this.builders.find((item) => item.id === notification.builderId);
    notification.webhookAttemptedAt = Date.now();
    void fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.DISTRICT_NOTIFICATION_SECRET
          ? { authorization: `Bearer ${process.env.DISTRICT_NOTIFICATION_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        event: "district.notification",
        builder: builder ? { id: builder.id, handle: builder.handle } : { id: notification.builderId },
        notification,
      }),
      signal: AbortSignal.timeout(5000),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`webhook ${response.status}`);
        notification.webhookDeliveredAt = Date.now();
        this.persist();
      })
      .catch((error) => {
        this.persist();
        console.error("[district] notification webhook failed", error);
      });
  }

  private record(
    actorType: CollaborationAudit["actorType"],
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    missionId?: string,
    data?: Record<string, unknown>,
  ): void {
    this.audit.push({
      id: `audit_${nanoid(12)}`,
      at: Date.now(),
      actorType,
      actorId,
      action,
      targetType,
      targetId,
      missionId,
      data,
    });
  }

  private publicInvite(invite: StoredInvite): MissionInvite {
    const { tokenHash: _tokenHash, ...safe } = invite;
    return safe;
  }
}
