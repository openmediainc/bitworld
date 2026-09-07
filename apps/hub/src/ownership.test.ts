import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerHttp } from "./http.js";
import { OwnerStore } from "./tokens.js";
import { World } from "./world.js";

const TOKEN = "x-district-token";

let app: FastifyInstance;
let dir: string;

function build(): FastifyInstance {
  const a = Fastify({ logger: false });
  registerHttp(a, new World(), new OwnerStore(dir));
  return a;
}

async function spawn(id: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/agents/upsert",
    payload: { id, name: "Tester", role: "Coder" },
  });
  expect(res.statusCode).toBe(200);
  const token = res.headers[TOKEN];
  expect(typeof token).toBe("string");
  return token as string;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "district-test-"));
  app = build();
});

afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("agent ownership", () => {
  it("lets anyone spawn, with no credential, and returns a token once", async () => {
    const token = await spawn("agent_a");
    expect(token.length).toBeGreaterThan(20);
  });

  it("refuses a stranger acting as an agent that is already owned", async () => {
    await spawn("agent_a");
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/agent_a/speak",
      payload: { text: "not me" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets the token holder act as its own agent", async () => {
    const token = await spawn("agent_a");
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/agent_a/speak",
      payload: { text: "hello" },
      headers: { [TOKEN]: token },
    });
    expect(res.statusCode).toBe(200);
  });

  it("refuses a stranger despawning someone else's agent", async () => {
    await spawn("agent_a");
    const res = await app.inject({ method: "POST", url: "/api/agents/agent_a/despawn", payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("blocks hijacking an owned id by re-spawning over it", async () => {
    await spawn("agent_a");
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/upsert",
      payload: { id: "agent_a", name: "Impostor" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("frees the id again once the owner despawns", async () => {
    const token = await spawn("agent_a");
    const gone = await app.inject({
      method: "POST",
      url: "/api/agents/agent_a/despawn",
      payload: {},
      headers: { [TOKEN]: token },
    });
    expect(gone.statusCode).toBe(200);
    const reclaimed = await spawn("agent_a");
    expect(reclaimed).not.toBe(token);
  });

  it("claims an unowned id for its first writer, so live agents keep working", async () => {
    const world = new World();
    world.upsertAgent({ id: "legacy", name: "Legacy" });
    const a = Fastify({ logger: false });
    registerHttp(a, world, new OwnerStore(dir));
    const res = await a.inject({
      method: "POST",
      url: "/api/agents/legacy/heartbeat",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.headers[TOKEN]).toBe("string");
    await a.close();
  });

  it("guards the MCP twin routes too", async () => {
    await spawn("agent_a");
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp/speak",
      payload: { agentId: "agent_a", text: "not me" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("keeps reading the campus open to everyone", async () => {
    await spawn("agent_a");
    for (const url of ["/api/snapshot", "/api/agents", "/api/world/look?x=37&y=28", "/api/labor"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
    }
  });

  it("never leaks a token through the read routes", async () => {
    const token = await spawn("agent_a");
    for (const url of ["/api/snapshot", "/api/agents", "/api/agents/agent_a", "/api/dashboard"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.body).not.toContain(token);
    }
  });

  it("leaves the visitor body shared and open", async () => {
    const res = await app.inject({ method: "POST", url: "/api/visitor/say", payload: { text: "hi" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("simulator control", () => {
  it("refuses to start the fake crowd with no admin key set", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sim/start", payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("accepts the admin key when one is configured", async () => {
    process.env.DISTRICT_ADMIN_KEY = "s3cret";
    const a = build();
    const bad = await a.inject({ method: "POST", url: "/api/sim/start", payload: {} });
    expect(bad.statusCode).toBe(403);
    const good = await a.inject({
      method: "POST",
      url: "/api/sim/start",
      payload: {},
      headers: { "x-admin-key": "s3cret" },
    });
    expect(good.statusCode).toBe(200);
    await a.close();
    delete process.env.DISTRICT_ADMIN_KEY;
  });
});
