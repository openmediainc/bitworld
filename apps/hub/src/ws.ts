import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { SPRITE_COLORS, type ClientMessage, type ServerMessage } from "@district/shared";
import type { World } from "./world.js";

type Socket = {
  send: (data: string) => void;
  readyState: number;
  on: (ev: string, cb: (raw: Buffer | string) => void) => void;
};

export function registerWs(app: FastifyInstance, world: World, clients: Set<(msg: ServerMessage) => void>): void {
  app.get("/ws", { websocket: true }, (socket: Socket, _req: unknown) => {
    let visitorId: string | null = null;
    let role: "viewer" | "visitor" = "viewer";

    const send = (msg: ServerMessage) => {
      try {
        if (socket.readyState === 1) socket.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    };
    clients.add(send);

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "ping") {
        send({ type: "pong" });
        return;
      }
      if (msg.type === "hello") {
        role = msg.role;
        if (role === "visitor") {
          visitorId = `visitor_${nanoid(6)}`;
          world.upsertAgent({
            id: visitorId,
            name: msg.name?.slice(0, 24) || "Visitor",
            role: "Human",
            sprite: "visitor",
            color: SPRITE_COLORS.visitor,
            tile: { x: 37, y: 28 },
          });
          world.bumpCampusVisit();
        }
        send({ type: "snapshot", payload: world.snapshot() });
        return;
      }
      if (msg.type === "move" && visitorId) {
        world.goTo(visitorId, { tile: { x: msg.x, y: msg.y } });
      }
    });

    socket.on("close", () => {
      clients.delete(send);
      if (visitorId) world.despawn(visitorId);
    });
  });
}

export function broadcast(clients: Set<(msg: ServerMessage) => void>, msg: ServerMessage): void {
  for (const send of clients) send(msg);
}
