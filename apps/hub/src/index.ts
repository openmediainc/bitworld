import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  PERSIST_EVERY_MS,
  SNAPSHOT_EVERY_MS,
  SIM_TICK_MS,
  TICK_HZ,
  type ServerMessage,
} from "@district/shared";
import { World } from "./world.js";
import { registerHttp } from "./http.js";
import { broadcast, registerWs } from "./ws.js";
import { simTick, startSimulator } from "./simulator.js";

const PORT = Number(process.env.PORT ?? 4242);

async function main() {
  const world = World.loadFromDisk();
  if (process.env.DISTRICT_SIM !== "0") {
    const hasSim = [...world.agents.values()].some((a) => a.simulated);
    if (!hasSim) startSimulator(world);
  }

  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
  });
  await app.register(websocket);
  registerHttp(app, world);
  const clients = new Set<(msg: ServerMessage) => void>();
  registerWs(app, world, clients);

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

  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`[district hub] http://127.0.0.1:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
