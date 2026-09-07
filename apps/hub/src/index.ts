import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import {
  PERSIST_EVERY_MS,
  SNAPSHOT_EVERY_MS,
  SIM_TICK_MS,
  TICK_HZ,
  type ServerMessage,
} from "@district/shared";
import { World } from "./world.js";
import { registerHttp } from "./http.js";
import { OwnerStore, TOKEN_HEADER } from "./tokens.js";
import { backupData, dataDir } from "./persist.js";
import { broadcast, registerWs } from "./ws.js";
import { simTick, startSimulator } from "./simulator.js";

const PORT = Number(process.env.PORT ?? 4242);
const HOST = process.env.HOST ?? "127.0.0.1";
const BASE_PATH = (process.env.BASE_PATH ?? "").replace(/\/$/, "");
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${PORT}`;
const SERVE_WEB = process.env.SERVE_WEB === "1" || process.env.SERVE_WEB === "true";
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const world = World.loadFromDisk();
  const persistAndBackup = () => {
    world.persist();
    try {
      const destination = backupData(dataDir());
      console.log(`[district backup] ${destination}`);
    } catch (error) {
      console.error("campus backup failed", error);
    }
  };
  if (process.env.DISTRICT_SIM === "1") {
    const hasSim = [...world.agents.values()].some((a) => a.simulated);
    if (!hasSim) startSimulator(world);
  }

  const app = Fastify({ logger: false });
  const origins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    PUBLIC_ORIGIN,
    "https://q-ai.tail735569.ts.net",
  ];
  await app.register(cors, {
    origin: origins,
    allowedHeaders: ["content-type", "x-api-key", "x-admin-key", TOKEN_HEADER],
    exposedHeaders: [TOKEN_HEADER],
  });
  await app.register(websocket);

  const clients = new Set<(msg: ServerMessage) => void>();
  // One store shared by both mounts below — two stores would mean two sets of owners.
  const owners = new OwnerStore(dataDir());
  registerHttp(app, world, owners);
  registerWs(app, world, clients);
  if (BASE_PATH) {
    await app.register(async (inst) => {
      registerHttp(inst, world, owners);
      registerWs(inst, world, clients);
    }, { prefix: BASE_PATH });
  }

  if (SERVE_WEB) {
    const dist = path.resolve(process.cwd(), "apps/web/dist");
    if (!fs.existsSync(path.join(dist, "index.html"))) {
      throw new Error(`SERVE_WEB=1 but missing ${dist}/index.html — run DISTRICT_BASE=${BASE_PATH || "/"} npm run build -w @district/web`);
    }
    const prefix = BASE_PATH ? `${BASE_PATH}/` : "/";
    await app.register(fastifyStatic, {
      root: dist,
      prefix,
      index: "index.html",
      wildcard: false,
    });
    if (BASE_PATH) {
      app.route({
        method: "GET",
        url: BASE_PATH,
        handler: async (_req, reply) => reply.redirect(`${BASE_PATH}/`),
      });
    }
  }

  const tickMs = 1000 / TICK_HZ;
  setInterval(() => {
    world.tick(tickMs / 1000);
    const delta = world.takeDelta();
    if (delta) broadcast(clients, { type: "delta", payload: delta });
  }, tickMs);

  setInterval(() => {
    world.sweepHeartbeats();
    simTick(world);
  }, SIM_TICK_MS);

  setInterval(() => {
    broadcast(clients, { type: "snapshot", payload: world.snapshot() });
  }, SNAPSHOT_EVERY_MS);

  setInterval(() => world.persist(), PERSIST_EVERY_MS);
  setInterval(persistAndBackup, BACKUP_EVERY_MS);

  const shutdown = () => {
    try {
      world.persist();
    } catch (e) {
      console.error("persist on shutdown failed", e);
    }
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: PORT, host: HOST });
  console.log(`[district hub] http://${HOST}:${PORT}${BASE_PATH || ""} origin=${PUBLIC_ORIGIN}`);
  persistAndBackup();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
