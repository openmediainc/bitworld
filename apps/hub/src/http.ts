import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError, type ZodType } from "zod";
import {
  artifactBodySchema,
  agreementActionBodySchema,
  agreementCreateBodySchema,
  bindVisitorBodySchema,
  blockedBodySchema,
  builderCreateBodySchema,
  builderUpdateBodySchema,
  claimTaskBodySchema,
  errorBodySchema,
  finishTaskBodySchema,
  fleetEnrollmentAcceptBodySchema,
  fleetEnrollmentCreateBodySchema,
  goToBodySchema,
  handoffBodySchema,
  heartbeatBodySchema,
  lookQuerySchema,
  missionCreateBodySchema,
  missionJoinBodySchema,
  missionStatusBodySchema,
  grantCreateBodySchema,
  githubActionBodySchema,
  inviteAcceptBodySchema,
  inviteCreateBodySchema,
  resourceCreateBodySchema,
  speakBodySchema,
  spawnBodySchema,
  shardBodySchema,
  taskCreateBodySchema,
  taskReviewBodySchema,
  toolEventBodySchema,
  visitorMoveBodySchema,
  visitorSayBodySchema,
  workOnBodySchema,
  reportBodySchema,
  VISITOR_ID,
} from "@district/shared";
import type { World } from "./world.js";
import { startSimulator, stopSimulator } from "./simulator.js";
import {
  BUILDER_ID_HEADER,
  BUILDER_TOKEN_HEADER,
  BuilderTokenStore,
  TOKEN_HEADER,
  type OwnerStore,
} from "./tokens.js";
import { esc, page, rulesPage } from "./publicPages.js";
import { dataDir } from "./persist.js";
import { CollaborationService } from "./collaboration.js";

function issues(err: ZodError) {
  return { error: "invalid body", issues: err.issues };
}

async function parse<T>(schema: ZodType<T>, req: FastifyRequest, reply: FastifyReply): Promise<T | null> {
  try {
    return schema.parse(req.body ?? {});
  } catch (e) {
    if (e instanceof ZodError) {
      reply.code(400).send(issues(e));
      return null;
    }
    throw e;
  }
}

function agentIdFrom(req: FastifyRequest, paramsId?: string): string {
  if (paramsId) return paramsId;
  const body = (req.body ?? {}) as { agentId?: string; id?: string };
  const header = req.headers["x-agent-id"];
  return body.agentId || body.id || (typeof header === "string" ? header : "") || "";
}

function tokenFrom(req: FastifyRequest): string {
  const h = req.headers[TOKEN_HEADER];
  return typeof h === "string" ? h : "";
}

function routeError(reply: FastifyReply, error: unknown) {
  const value = error as Error & { statusCode?: number };
  return reply.code(value.statusCode ?? 500).send({ error: value.message });
}

export function registerHttp(
  app: FastifyInstance,
  world: World,
  owners: OwnerStore,
  builderTokens = new BuilderTokenStore(dataDir()),
  collaboration = new CollaborationService(world, dataDir()),
): void {
  const apiKey = process.env.API_KEY ?? "";
  const adminKey = process.env.DISTRICT_ADMIN_KEY ?? "";
  const registrations = new Map<string, number[]>();

  app.addHook("preHandler", async (req, reply) => {
    if (!apiKey) return;
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const sent = req.headers["x-api-key"];
    if (sent !== apiKey) {
      return reply.code(401).send({ error: "missing or bad x-api-key" });
    }
  });

  /**
   * Ownership, not authentication. Anyone may spawn; only the session holding
   * an agent's token may act as it. An id nobody has claimed is claimed by its
   * first writer (trust on first use) and the token comes back once in the
   * x-district-token header — so joining needs no credential at all.
   */
  const own = (req: FastifyRequest, reply: FastifyReply, id: string): boolean => {
    if (!id) {
      reply.code(400).send({ error: "missing agent id" });
      return false;
    }
    if (id === VISITOR_ID) return true;
    if (owners.verify(id, tokenFrom(req))) return true;
    const minted = owners.claim(id);
    if (minted) {
      reply.header(TOKEN_HEADER, minted);
      return true;
    }
    reply.code(403).send({
      error: "another session owns this agent; send its x-district-token header",
    });
    return false;
  };

  const admin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!adminKey) {
      reply.code(403).send({ error: "disabled; set DISTRICT_ADMIN_KEY on the hub to enable" });
      return false;
    }
    if (req.headers["x-admin-key"] !== adminKey) {
      reply.code(403).send({ error: "missing or bad x-admin-key" });
      return false;
    }
    return true;
  };

  const authenticatedBuilder = (
    req: FastifyRequest,
    reply: FastifyReply,
  ): string | null => {
    const id = req.headers[BUILDER_ID_HEADER];
    const token = req.headers[BUILDER_TOKEN_HEADER];
    if (
      typeof id !== "string" ||
      typeof token !== "string" ||
      !builderTokens.verify(id, token)
    ) {
      reply.code(401).send({ error: "missing or bad builder identity" });
      return null;
    }
    return id;
  };

  const optionalBuilder = (req: FastifyRequest): string | undefined => {
    const id = req.headers[BUILDER_ID_HEADER];
    const token = req.headers[BUILDER_TOKEN_HEADER];
    return typeof id === "string" &&
      typeof token === "string" &&
      builderTokens.verify(id, token)
      ? id
      : undefined;
  };

  const agentActivity = (
    reply: FastifyReply,
    agentId: string,
    requested?: string,
  ): { missionId?: string } | null => {
    try {
      return { missionId: collaboration.resolveAgentActivityMission(agentId, requested) };
    } catch (error) {
      routeError(reply, error);
      return null;
    }
  };

  app.get("/health", async () => ({
    ok: true,
    agents: world.agents.size,
    t: Date.now(),
  }));

  app.get("/api/info", async () => ({
    root: process.env.DISTRICT_ROOT ?? process.cwd(),
    hubUrl: process.env.PUBLIC_ORIGIN
      ? `${process.env.PUBLIC_ORIGIN}${process.env.BASE_PATH ?? ""}`
      : `http://127.0.0.1:${process.env.PORT ?? 4242}`,
    apiKeyRequired: Boolean(process.env.API_KEY),
    mcpEntry: "packages/mcp-server/src/index.ts",
  }));

  app.get("/rules", async (_req, reply) => {
    reply.type("text/html").send(rulesPage());
  });
  app.get("/b/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const plot = world.avenuePlots.find((p) => p.slug === slug || p.id === slug);
    if (plot) {
      const href = plot.href ? `<p><a href="${plot.href}">${plot.kind === "billboard" ? "Open BitGrid" : "Visit"}</a></p>` : "";
      reply.type("text/html").send(
        page(
          `${plot.address} — ${plot.orgName}`,
          `<h1>${plot.orgName}</h1><p class="meta">${plot.address} · ${plot.kind} · not for sale</p>${href}`,
        ),
      );
      return;
    }
    const card = world.buildingCard(slug);
    if (!card) return reply.code(404).type("text/html").send(page("Not found", "<p>No such building.</p>"));
    const occ = card.occupants.map((a) => esc(a.name)).join(", ") || "empty";
    const ev = card.events
      .slice(-8)
      .map((e) => `<li>${e.kind}: ${esc(e.text)}</li>`)
      .join("");
    reply.type("text/html").send(
      page(
        card.building.name,
        `<h1>${esc(card.building.name)}</h1>
         <p class="meta">#${card.building.kind} · /b/${card.building.kind} · visits ${card.stats?.visits ?? 0} · heat ${card.stats?.heat ?? 0}</p>
         <p>founded by ${esc(card.stats?.foundedByName ?? "nobody yet")}</p>
         <p>inside: ${occ}</p>
         <ul>${ev}</ul>
         <p class="meta"><a href="http://127.0.0.1:5173/#${card.building.kind}">open on campus</a></p>`,
      ),
    );
  });
  app.get("/api/labor", async () => world.laborBoard());
  app.get("/api/help", async () => world.helpWantedBoard());
  app.get("/api/reputation", async () => world.reputation());
  app.get("/help", async (_req, reply) => {
    const board = world.helpWantedBoard();
    const tasks = board.tasks
      .map((t) => {
        const who = t.agentId ? ` · ${esc(t.agentName ?? t.agentId)}` : " · unclaimed";
        return `<li><code>${esc(t.id)}</code> ${esc(t.title)} · ${t.status}${who}</li>`;
      })
      .join("");
    const reps = board.reputation
      .slice(0, 12)
      .map((r) => `<li>${esc(r.name)}: ${r.accepted} accepted</li>`)
      .join("");
    reply.type("text/html").send(
      page(
        "Help wanted",
        `<h1>Help wanted</h1>
         <p class="meta">${board.disclaimer}</p>
         <p>Agents: <code>list_help_wanted</code> then <code>claim_task</code>. Humans accept artifacts on campus.</p>
         <h2>Open work</h2>
         <ul>${tasks || "<li>None right now.</li>"}</ul>
         <h2>Accepted reputation</h2>
         <ul>${reps || "<li>Nobody has an accepted contribution yet.</li>"}</ul>`,
      ),
    );
  });

  app.get("/api/builders", async () => collaboration.publicBuilders());
  app.post("/api/builders/register", async (req, reply) => {
    const now = Date.now();
    if (registrations.size > 10_000) {
      for (const [ip, attempts] of registrations) {
        if (!attempts.some((at) => at > now - 60 * 60 * 1000)) registrations.delete(ip);
      }
    }
    const recent = (registrations.get(req.ip) ?? []).filter((at) => at > now - 60 * 60 * 1000);
    if (recent.length >= 5) return reply.code(429).send({ error: "builder registration rate limit exceeded" });
    recent.push(now);
    registrations.set(req.ip, recent);
    const body = await parse(builderCreateBodySchema, req, reply);
    if (!body) return;
    try {
      const profile = collaboration.register({ ...body, skills: body.skills ?? [] });
      let token: string;
      try {
        token = builderTokens.issue(profile.id);
      } catch (error) {
        collaboration.rollbackRegistration(profile.id);
        throw error;
      }
      reply.header(BUILDER_TOKEN_HEADER, token);
      return profile;
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/builders/me", async (req, reply) => {
    const id = authenticatedBuilder(req, reply);
    if (!id) return;
    const body = await parse(builderUpdateBodySchema, req, reply);
    if (!body) return;
    try {
      return collaboration.updateBuilder(id, body);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/builders/me/rotate-token", async (req, reply) => {
    const id = authenticatedBuilder(req, reply);
    if (!id) return;
    const token = builderTokens.rotate(id);
    reply.header(BUILDER_TOKEN_HEADER, token);
    try {
      collaboration.recordTokenRotation(id);
    } catch (error) {
      console.error("[district] could not audit builder token rotation", error);
    }
    return { ok: true };
  });
  app.post("/api/builders/me/agents/:id/remove", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const { id } = req.params as { id: string };
    try {
      const builder = collaboration.removeAgent(builderId, id);
      world.despawn(id);
      try {
        owners.release(id);
      } catch (error) {
        console.error("[district] fleet agent removed but its id remains reserved", error);
      }
      return builder;
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/builders/me/fleet-enrollments", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(fleetEnrollmentCreateBodySchema, req, reply);
    if (!body) return;
    try {
      return collaboration.createFleetEnrollment(builderId, body.expiresInMinutes ?? 15);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/agents/:id/join-fleet", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!owners.verify(id, tokenFrom(req))) {
      return reply.code(403).send({ error: "agent ownership token required" });
    }
    const body = await parse(fleetEnrollmentAcceptBodySchema, req, reply);
    if (!body) return;
    try {
      const { visitorId: _visitorId, ...builder } = collaboration.enrollAgent(id, body.token);
      return builder;
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/builders/me/presence", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(bindVisitorBodySchema, req, reply);
    if (!body) return;
    try {
      return collaboration.bindVisitor(builderId, body.visitorId);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.get("/api/workspace", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    try {
      return collaboration.workspace(builderId);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/collaboration/missions", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(missionCreateBodySchema, req, reply);
    if (!body) return;
    try {
      return collaboration.createMission(builderId, body);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/missions/:id/invites", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(inviteCreateBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.createInvite(builderId, id, body.expiresInHours ?? 72, body.inviteeBuilderId);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/invites/accept", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(inviteAcceptBodySchema, req, reply);
    if (!body) return;
    try {
      return collaboration.acceptInvite(builderId, body.token);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/invites/:id/accept", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.acceptTargetedInvite(builderId, id);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/invites/:id/revoke", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.revokeInvite(builderId, id);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/missions/:id/resources", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(resourceCreateBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.addResource(builderId, id, body);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/missions/:id/grants", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(grantCreateBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.grant(builderId, id, body);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/grants/:id/revoke", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.revokeGrant(builderId, id);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.get("/api/agents/:id/capabilities", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!owners.verify(id, tokenFrom(req))) {
      return reply.code(403).send({ error: "agent ownership token required" });
    }
    return collaboration.activeGrantsForAgent(id);
  });
  app.get("/api/agents/:id/workspace", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!owners.verify(id, tokenFrom(req))) {
      return reply.code(403).send({ error: "agent ownership token required" });
    }
    try {
      return collaboration.agentWorkspace(id);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/agents/:id/github", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!owners.verify(id, tokenFrom(req))) {
      return reply.code(403).send({ error: "agent ownership token required" });
    }
    const body = await parse(githubActionBodySchema, req, reply);
    if (!body) return;
    try {
      return await collaboration.executeGitHub(id, body.resourceId, body.action, body.input ?? {});
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/agreements", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const body = await parse(agreementCreateBodySchema, req, reply);
    if (!body) return;
    try {
      return collaboration.createAgreement(builderId, body);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.get("/api/opportunities", async () => collaboration.opportunities());
  app.post("/api/agreements/:id/claim", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.claimAgreement(builderId, id);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/agreements/:id/claim-agent", async (req, reply) => {
    const agentId = agentIdFrom(req);
    if (!agentId || !owners.verify(agentId, tokenFrom(req))) {
      return reply.code(403).send({ error: "agent ownership token required" });
    }
    const { id } = req.params as { id: string };
    try {
      return collaboration.claimAgreementAsAgent(agentId, id);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  for (const action of ["accept", "start", "deliver", "approve", "dispute", "cancel"] as const) {
    app.post(`/api/agreements/:id/${action}`, async (req, reply) => {
      const builderId = authenticatedBuilder(req, reply);
      if (!builderId) return;
      const body = await parse(agreementActionBodySchema, req, reply);
      if (!body) return;
      const { id } = req.params as { id: string };
      try {
        return collaboration.transitionAgreement(builderId, id, action, body);
      } catch (error) {
        return routeError(reply, error);
      }
    });
  }
  app.post("/api/agreements/:id/deliver-agent", async (req, reply) => {
    const agentId = agentIdFrom(req);
    if (!agentId || !owners.verify(agentId, tokenFrom(req))) {
      return reply.code(403).send({ error: "agent ownership token required" });
    }
    const body = await parse(agreementActionBodySchema, req, reply);
    if (!body) return;
    if (!body.deliveryNote) return reply.code(400).send({ error: "delivery note is required" });
    const { id } = req.params as { id: string };
    try {
      return collaboration.deliverAsAgent(agentId, id, body.deliveryNote);
    } catch (error) {
      return routeError(reply, error);
    }
  });
  app.post("/api/notifications/:id/read", async (req, reply) => {
    const builderId = authenticatedBuilder(req, reply);
    if (!builderId) return;
    const { id } = req.params as { id: string };
    try {
      return collaboration.markNotificationRead(builderId, id);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.get("/api/dashboard", async () => world.dashboard());
  app.post("/api/report", async (req, reply) => {
    const body = await parse(reportBodySchema, req, reply);
    if (!body) return;
    return world.fileReport(body.text);
  });
  app.get("/api/snapshot", async () => world.snapshot());
  app.get("/api/avenue", async () => ({
    km0: world.snapshot().avenue?.km0,
    plots: world.avenuePlots,
    refuse: world.refuseAvenueCommerce().error,
  }));
  app.post("/api/avenue/claim", async (_req, reply) => {
    const r = world.refuseAvenueCommerce();
    return reply.code(r.statusCode).send({ error: r.error });
  });
  app.post("/api/avenue/takeover", async (_req, reply) => {
    const r = world.refuseAvenueCommerce();
    return reply.code(r.statusCode).send({ error: r.error });
  });
  app.get("/api/buildings", async () => world.computeBuildingStats());
  app.get("/api/buildings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = world.buildingCard(id);
    if (!card) return reply.code(404).send({ error: "building not found" });
    return card;
  });
  app.get("/api/agents", async () => [...world.agents.values()]);
  app.get("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = world.agents.get(id);
    if (!a) return reply.code(404).send({ error: "agent not found" });
    return a;
  });
  app.get("/api/events", async (req) => {
    const q = req.query as { limit?: string };
    const requested = Number(q.limit ?? 50);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(Math.trunc(requested), 500))
      : 50;
    const privateIds = new Set(
      world.missions.filter((mission) => mission.visibility === "private").map((mission) => mission.id),
    );
    return world.events
      .filter((event) => {
        const missionId = event.data?.missionId;
        return typeof missionId !== "string" || !privateIds.has(missionId);
      })
      .slice(-limit);
  });
  app.get("/api/tasks", async () => world.snapshot().tasks);
  app.get("/api/missions", async () => world.snapshot().missions);
  app.get("/api/missions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const mission = world.missions.find((item) => item.id === id);
    if (!mission) return reply.code(404).send({ error: "mission not found" });
    if (mission.visibility === "private") {
      const builderId = optionalBuilder(req);
      if (!builderId) return reply.code(404).send({ error: "mission not found" });
      try {
        collaboration.requireMember(builderId, mission.id);
      } catch {
        return reply.code(404).send({ error: "mission not found" });
      }
    }
    return mission;
  });
  app.get("/api/world/look", async (req, reply) => {
    try {
      const q = lookQuerySchema.parse(req.query);
      return world.look(q.x, q.y, q.r ?? 6);
    } catch (e) {
      if (e instanceof ZodError) return reply.code(400).send(issues(e));
      throw e;
    }
  });

  app.post("/api/tasks", async (req, reply) => {
    const body = await parse(taskCreateBodySchema, req, reply);
    if (!body) return;
    if (body.missionId) {
      const mission = world.missions.find((item) => item.id === body.missionId);
      if (mission?.visibility === "private" && body.helpWanted) {
        return reply.code(400).send({ error: "private mission tasks cannot be help wanted" });
      }
      if (mission?.status === "completed") {
        return reply.code(409).send({ error: "cannot add tasks to a completed mission" });
      }
      if (mission?.ownerBuilderId) {
        const builderId = authenticatedBuilder(req, reply);
        if (!builderId) return;
        try {
          collaboration.requireMember(builderId, mission.id);
          if (body.agentId) collaboration.requireAgentMissionAccess(body.agentId, mission.id);
        } catch (error) {
          return routeError(reply, error);
        }
      }
    }
    return world.createTask({ ...body, body: body.body ?? "" });
  });

  app.post("/api/tasks/:id/accept", async (req, reply) => {
    const body = await parse(taskReviewBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    try {
      const task = world.tasks.find((item) => item.id === id);
      const mission = task?.missionId
        ? world.missions.find((item) => item.id === task.missionId)
        : undefined;
      if (mission?.ownerBuilderId) {
        const builderId = authenticatedBuilder(req, reply);
        if (!builderId) return;
        collaboration.requireMember(builderId, mission.id);
        const builder = collaboration.requireBuilder(builderId);
        return world.acceptTaskByBuilder(id, builder.id, builder.displayName);
      }
      return world.acceptTask(id, body.participantId);
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  app.post("/api/tasks/:id/reject", async (req, reply) => {
    const body = await parse(taskReviewBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    try {
      const task = world.tasks.find((item) => item.id === id);
      const mission = task?.missionId
        ? world.missions.find((item) => item.id === task.missionId)
        : undefined;
      if (mission?.ownerBuilderId) {
        const builderId = authenticatedBuilder(req, reply);
        if (!builderId) return;
        collaboration.requireMember(builderId, mission.id);
        const builder = collaboration.requireBuilder(builderId);
        return world.rejectTaskByBuilder(id, builder.id, builder.displayName, body.reason);
      }
      return world.rejectTask(id, body.participantId, body.reason);
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  app.post("/api/missions", async (req, reply) => {
    const body = await parse(missionCreateBodySchema, req, reply);
    if (!body) return;
    if (body.visibility === "private") {
      return reply.code(400).send({ error: "private missions require a builder identity" });
    }
    return world.createMission({ ...body, visibility: "public" });
  });

  app.post("/api/missions/:id/join", async (req, reply) => {
    const body = await parse(missionJoinBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    const mission = world.missions.find((item) => item.id === id);
    if (mission?.ownerBuilderId) {
      const builderId = authenticatedBuilder(req, reply);
      if (!builderId) return;
      try {
        collaboration.requireMember(builderId, id);
        if (collaboration.requireBuilder(builderId).visitorId !== body.participantId) {
          return reply.code(403).send({ error: "join must use the builder's bound visitor" });
        }
      } catch (error) {
        return routeError(reply, error);
      }
    }
    return world.joinMission(id, body.participantId);
  });

  app.post("/api/missions/:id/status", async (req, reply) => {
    const body = await parse(missionStatusBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    const mission = world.missions.find((item) => item.id === id);
    if (mission?.ownerBuilderId) {
      const builderId = authenticatedBuilder(req, reply);
      if (!builderId) return;
      try {
        collaboration.requireOwner(builderId, id);
      } catch (error) {
        return routeError(reply, error);
      }
    }
    return world.setMissionStatus(id, body.status);
  });

  app.post("/api/sim/start", async (req, reply) => {
    if (!admin(req, reply)) return;
    return startSimulator(world);
  });
  app.post("/api/sim/stop", async (req, reply) => {
    if (!admin(req, reply)) return;
    return stopSimulator(world);
  });

  app.post("/api/visitor/move", async (req, reply) => {
    const body = await parse(visitorMoveBodySchema, req, reply);
    if (!body) return;
    if (!world.agents.has(VISITOR_ID)) {
      world.upsertAgent({
        id: VISITOR_ID,
        name: "Visitor",
        role: "Human",
        sprite: "visitor",
        tile: { x: 37, y: 28 },
      });
    }
    world.goTo(VISITOR_ID, { tile: body });
    return world.require(VISITOR_ID);
  });

  app.post("/api/visitor/say", async (req, reply) => {
    const body = await parse(visitorSayBodySchema, req, reply);
    if (!body) return;
    if (!world.agents.has(VISITOR_ID)) {
      world.upsertAgent({
        id: VISITOR_ID,
        name: "Visitor",
        role: "Human",
        sprite: "visitor",
        tile: { x: 37, y: 28 },
      });
    }
    return world.speak(VISITOR_ID, body.text);
  });

  app.post("/api/agents/upsert", async (req, reply) => {
    const body = await parse(spawnBodySchema, req, reply);
    if (!body) return;
    if (body.id && !own(req, reply, body.id)) return;
    const agent = world.upsertAgent(body);
    const minted = owners.claim(agent.id);
    if (minted) reply.header(TOKEN_HEADER, minted);
    return agent;
  });

  app.post("/api/agents/:id/heartbeat", async (req, reply) => {
    const body = await parse(heartbeatBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    return world.heartbeat(
      id,
      collaboration.agentHasActivePrivateMission(id)
        ? {
            ...body,
            bubble: body.bubble === undefined ? undefined : "Working privately",
            currentTool: body.currentTool === undefined ? undefined : "private",
          }
        : body,
    );
  });

  app.post("/api/agents/:id/go_to", async (req, reply) => {
    const body = await parse(goToBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    const dest = world.resolveTarget(body);
    if (!dest) return reply.code(400).send({ error: "could not resolve destination" });
    return world.goTo(id, dest);
  });

  app.post("/api/agents/:id/work_on", async (req, reply) => {
    const body = await parse(workOnBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    const activity = agentActivity(reply, id, body.missionId);
    if (!activity) return;
    return world.workOn(id, { ...body, missionId: activity.missionId });
  });

  app.post("/api/agents/:id/speak", async (req, reply) => {
    const body = await parse(speakBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    const activity = agentActivity(reply, id, body.missionId);
    if (!activity) return;
    return world.speak(id, body.text, body.toAgentName, activity.missionId);
  });

  app.post("/api/agents/:id/handoff", async (req, reply) => {
    const body = await parse(handoffBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    const activity = agentActivity(reply, id, body.missionId);
    if (!activity) return;
    return world.handoff(id, body.toAgentName, body.note, activity.missionId);
  });

  app.post("/api/agents/:id/blocked", async (req, reply) => {
    const body = await parse(blockedBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    const activity = agentActivity(reply, id, body.missionId);
    if (!activity) return;
    const result = world.blocked(id, body.reason, activity.missionId);
    collaboration.notifyBlocked(id, body.reason, activity.missionId);
    return result;
  });

  app.post("/api/agents/:id/error", async (req, reply) => {
    const body = await parse(errorBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    const activity = agentActivity(reply, id, body.missionId);
    if (!activity) return;
    return world.reportError(id, body.message, activity.missionId);
  });

  app.post("/api/agents/:id/tool", async (req, reply) => {
    const body = await parse(toolEventBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    const activity = agentActivity(reply, id, body.missionId);
    if (!activity) return;
    return world.toolEvent(id, { ...body, missionId: activity.missionId });
  });

  app.post("/api/agents/:id/despawn", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    world.despawn(id);
    if (!collaboration.builderForAgent(id)) owners.release(id);
    return { ok: true };
  });

  app.post("/api/agents/:id/shard", async (req, reply) => {
    const body = await parse(shardBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    return world.setShard(id, body.shard);
  });

  // spawn is how you join and list_tasks is public reading; everything else
  // acts as a specific agent and needs that agent's token.
  const OPEN_TOOLS = new Set([
    "spawn",
    "list_tasks",
    "list_help_wanted",
    "list_builders",
    "list_opportunities",
  ]);

  const mcp = async (tool: string, req: FastifyRequest, reply: FastifyReply) => {
    const id = agentIdFrom(req);
    try {
      if (!OPEN_TOOLS.has(tool) && !own(req, reply, id)) return;
      switch (tool) {
        case "spawn": {
          const body = spawnBodySchema.parse(req.body ?? {});
          if (body.id && !own(req, reply, body.id)) return;
          const agent = world.upsertAgent(body);
          const minted = owners.claim(agent.id);
          if (minted) reply.header(TOKEN_HEADER, minted);
          return agent;
        }
        case "heartbeat": {
          const body = heartbeatBodySchema.parse(req.body ?? {});
          return world.heartbeat(
            id,
            collaboration.agentHasActivePrivateMission(id)
              ? {
                  ...body,
                  bubble: body.bubble === undefined ? undefined : "Working privately",
                  currentTool: body.currentTool === undefined ? undefined : "private",
                }
              : body,
          );
        }
        case "look_around": {
          const a = world.require(id);
          const r = Number((req.body as { radius?: number })?.radius ?? 6);
          return world.look(a.tile.x, a.tile.y, r);
        }
        case "go_to": {
          const body = goToBodySchema.parse(req.body ?? {});
          const dest = world.resolveTarget(body);
          if (!dest) return reply.code(400).send({ error: "could not resolve destination" });
          return world.goTo(id, dest);
        }
        case "work_on": {
          const body = workOnBodySchema.parse(req.body ?? {});
          const activity = agentActivity(reply, id, body.missionId);
          if (!activity) return;
          return world.workOn(id, { ...body, missionId: activity.missionId });
        }
        case "tool_event": {
          const body = toolEventBodySchema.parse(req.body ?? {});
          const activity = agentActivity(reply, id, body.missionId);
          if (!activity) return;
          return world.toolEvent(id, { ...body, missionId: activity.missionId });
        }
        case "speak": {
          const body = speakBodySchema.parse(req.body ?? {});
          const activity = agentActivity(reply, id, body.missionId);
          if (!activity) return;
          return world.speak(id, body.text, body.toAgentName, activity.missionId);
        }
        case "handoff": {
          const body = handoffBodySchema.parse(req.body ?? {});
          const activity = agentActivity(reply, id, body.missionId);
          if (!activity) return;
          return world.handoff(id, body.toAgentName, body.note, activity.missionId);
        }
        case "blocked": {
          const body = blockedBodySchema.parse(req.body ?? {});
          const activity = agentActivity(reply, id, body.missionId);
          if (!activity) return;
          const result = world.blocked(id, body.reason, activity.missionId);
          collaboration.notifyBlocked(id, body.reason, activity.missionId);
          return result;
        }
        case "report_error": {
          const body = errorBodySchema.parse(req.body ?? {});
          const activity = agentActivity(reply, id, body.missionId);
          if (!activity) return;
          return world.reportError(id, body.message, activity.missionId);
        }
        case "drop_artifact": {
          const body = artifactBodySchema.parse(req.body ?? {});
          const activity = agentActivity(reply, id, body.missionId);
          if (!activity) return;
          return world.dropArtifact(id, body.title, body.body, activity.missionId);
        }
        case "drop_postcard":
          return world.dropPostcard(id);
        case "list_tasks":
          return world.listTasks();
        case "list_help_wanted":
          return world.helpWantedBoard();
        case "list_builders":
          return collaboration.publicBuilders();
        case "list_opportunities":
          return collaboration.opportunities();
        case "join_builder_fleet": {
          const body = fleetEnrollmentAcceptBodySchema.parse(req.body ?? {});
          const { visitorId: _visitorId, ...builder } = collaboration.enrollAgent(id, body.token);
          return builder;
        }
        case "get_workspace":
          return collaboration.agentWorkspace(id);
        case "list_capabilities":
          return collaboration.activeGrantsForAgent(id);
        case "claim_agreement": {
          const agreementId = (req.body as { agreementId?: unknown })?.agreementId;
          if (typeof agreementId !== "string" || !agreementId) {
            return reply.code(400).send({ error: "agreementId is required" });
          }
          return collaboration.claimAgreementAsAgent(id, agreementId);
        }
        case "github_action": {
          const body = githubActionBodySchema.parse(req.body ?? {});
          return collaboration.executeGitHub(id, body.resourceId, body.action, body.input);
        }
        case "deliver_agreement": {
          const body = req.body as { agreementId?: unknown; deliveryNote?: unknown };
          if (
            typeof body?.agreementId !== "string" ||
            !body.agreementId ||
            typeof body.deliveryNote !== "string" ||
            !body.deliveryNote
          ) {
            return reply.code(400).send({ error: "agreementId and deliveryNote are required" });
          }
          return collaboration.deliverAsAgent(id, body.agreementId, body.deliveryNote);
        }
        case "claim_task": {
          const taskId = claimTaskBodySchema.parse(req.body ?? {}).taskId;
          const task = world.tasks.find((item) => item.id === taskId);
          if (task?.agreementId) collaboration.requireAgreementAgent(id, task.agreementId);
          const mission = task?.missionId
            ? world.missions.find((item) => item.id === task.missionId)
            : undefined;
          if (mission?.visibility === "private") {
            collaboration.requireAgentMissionAccess(id, mission.id);
          }
          return world.claimTask(id, taskId);
        }
        case "finish_task": {
          const body = finishTaskBodySchema.parse(req.body ?? {});
          const task = world.tasks.find((item) => item.id === body.taskId);
          if (task?.agreementId) {
            return reply.code(409).send({ error: "linked agreement tasks must use deliver_agreement" });
          }
          const mission = task?.missionId
            ? world.missions.find((item) => item.id === task.missionId)
            : undefined;
          if (mission?.visibility === "private") {
            collaboration.requireAgentMissionAccess(id, mission.id);
          }
          return world.finishTask(id, body.taskId, body.result);
        }
        case "despawn": {
          world.despawn(id);
          if (!collaboration.builderForAgent(id)) owners.release(id);
          return { ok: true };
        }
        default:
          return reply.code(404).send({ error: `unknown tool ${tool}` });
      }
    } catch (e) {
      if (e instanceof ZodError) return reply.code(400).send(issues(e));
      const err = e as Error & { statusCode?: number };
      return reply.code(err.statusCode ?? 500).send({ error: err.message });
    }
  };

  app.post("/api/mcp/:tool", async (req, reply) => {
    const { tool } = req.params as { tool: string };
    return mcp(tool, req, reply);
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    reply.code(status).send({ error: e.message ?? "error" });
  });
}
