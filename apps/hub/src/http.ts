import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError, type ZodType } from "zod";
import {
  artifactBodySchema,
  blockedBodySchema,
  claimTaskBodySchema,
  errorBodySchema,
  finishTaskBodySchema,
  goToBodySchema,
  handoffBodySchema,
  heartbeatBodySchema,
  lookQuerySchema,
  speakBodySchema,
  spawnBodySchema,
  shardBodySchema,
  taskCreateBodySchema,
  toolEventBodySchema,
  visitorMoveBodySchema,
  visitorSayBodySchema,
  workOnBodySchema,
  reportBodySchema,
  VISITOR_ID,
} from "@district/shared";
import type { World } from "./world.js";
import { startSimulator, stopSimulator } from "./simulator.js";
import { TOKEN_HEADER, type OwnerStore } from "./tokens.js";
import { page, rulesPage } from "./publicPages.js";

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

export function registerHttp(app: FastifyInstance, world: World, owners: OwnerStore): void {
  const apiKey = process.env.API_KEY ?? "";
  const adminKey = process.env.DISTRICT_ADMIN_KEY ?? "";

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

  app.get("/health", async () => ({
    ok: true,
    agents: world.agents.size,
    t: Date.now(),
  }));

  app.get("/api/info", async () => ({
    root: process.cwd(),
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
    const occ = card.occupants.map((a) => a.name).join(", ") || "empty";
    const ev = card.events
      .slice(-8)
      .map((e) => `<li>${e.kind}: ${e.text}</li>`)
      .join("");
    reply.type("text/html").send(
      page(
        card.building.name,
        `<h1>${card.building.name}</h1>
         <p class="meta">#${card.building.kind} · /b/${card.building.kind} · visits ${card.stats?.visits ?? 0} · heat ${card.stats?.heat ?? 0}</p>
         <p>founded by ${card.stats?.foundedByName ?? "nobody yet"}</p>
         <p>inside: ${occ}</p>
         <ul>${ev}</ul>
         <p class="meta"><a href="http://127.0.0.1:5173/#${card.building.kind}">open on campus</a></p>`,
      ),
    );
  });
  app.get("/api/labor", async () => world.laborBoard());
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
    const limit = Math.min(Number(q.limit ?? 50), 500);
    return world.events.slice(-limit);
  });
  app.get("/api/tasks", async () => world.tasks);
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
    return world.createTask({ ...body, body: body.body ?? "" });
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
    return world.heartbeat(id, body);
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
    return world.workOn(id, body);
  });

  app.post("/api/agents/:id/speak", async (req, reply) => {
    const body = await parse(speakBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    return world.speak(id, body.text, body.toAgentName);
  });

  app.post("/api/agents/:id/handoff", async (req, reply) => {
    const body = await parse(handoffBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    return world.handoff(id, body.toAgentName, body.note);
  });

  app.post("/api/agents/:id/blocked", async (req, reply) => {
    const body = await parse(blockedBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    return world.blocked(id, body.reason);
  });

  app.post("/api/agents/:id/error", async (req, reply) => {
    const body = await parse(errorBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    return world.reportError(id, body.message);
  });

  app.post("/api/agents/:id/tool", async (req, reply) => {
    const body = await parse(toolEventBodySchema, req, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    return world.toolEvent(id, body);
  });

  app.post("/api/agents/:id/despawn", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!own(req, reply, id)) return;
    world.despawn(id);
    owners.release(id);
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
  const OPEN_TOOLS = new Set(["spawn", "list_tasks"]);

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
          return world.heartbeat(id, body);
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
          return world.workOn(id, workOnBodySchema.parse(req.body ?? {}));
        }
        case "tool_event": {
          return world.toolEvent(id, toolEventBodySchema.parse(req.body ?? {}));
        }
        case "speak": {
          const body = speakBodySchema.parse(req.body ?? {});
          return world.speak(id, body.text, body.toAgentName);
        }
        case "handoff": {
          const body = handoffBodySchema.parse(req.body ?? {});
          return world.handoff(id, body.toAgentName, body.note);
        }
        case "blocked": {
          return world.blocked(id, blockedBodySchema.parse(req.body ?? {}).reason);
        }
        case "report_error": {
          return world.reportError(id, errorBodySchema.parse(req.body ?? {}).message);
        }
        case "drop_artifact": {
          const body = artifactBodySchema.parse(req.body ?? {});
          return world.dropArtifact(id, body.title, body.body);
        }
        case "drop_postcard":
          return world.dropPostcard(id);
        case "list_tasks":
          return world.listTasks();
        case "claim_task": {
          return world.claimTask(id, claimTaskBodySchema.parse(req.body ?? {}).taskId);
        }
        case "finish_task": {
          const body = finishTaskBodySchema.parse(req.body ?? {});
          return world.finishTask(id, body.taskId, body.result);
        }
        case "despawn": {
          world.despawn(id);
          owners.release(id);
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
