import fs from "node:fs";
import path from "node:path";

const HUB = process.env.HUB_URL ?? "http://127.0.0.1:4242";
const API_KEY = process.env.API_KEY ?? "";
const TOKEN_HEADER = "x-district-token";

/**
 * The hub hands out one secret per agent id the first time that id is claimed.
 * We keep it next to the agent id, keyed by hub, so pointing HUB_URL at a
 * different campus does not send the wrong campus's token.
 */
function sessionPath(): string {
  return path.resolve(process.cwd(), ".district-session.json");
}

function sessionKey(id: string): string {
  return `${HUB}|${id}`;
}

function readSessions(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function readToken(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (process.env.AGENT_TOKEN) return process.env.AGENT_TOKEN;
  return readSessions()[sessionKey(id)];
}

export function writeToken(id: string, token: string): void {
  try {
    const all = readSessions();
    all[sessionKey(id)] = token;
    fs.writeFileSync(sessionPath(), JSON.stringify(all, null, 2), { mode: 0o600 });
  } catch {
    /* a lost token just means the id has to be re-claimed after it despawns */
  }
}

let lastIssuedToken: string | undefined;

/** Token minted by the most recent request, for a spawn whose id the hub chose. */
export function takeIssuedToken(): string | undefined {
  const t = lastIssuedToken;
  lastIssuedToken = undefined;
  return t;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (API_KEY) h["x-api-key"] = API_KEY;
  const token = readToken(readAgentId());
  if (token) h[TOKEN_HEADER] = token;
  return h;
}

function captureToken(res: Response): void {
  const issued = res.headers.get(TOKEN_HEADER);
  if (!issued) return;
  lastIssuedToken = issued;
  const id = readAgentId();
  if (id) writeToken(id, issued);
}

export async function hubPost<T>(urlPath: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${HUB}${urlPath}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  captureToken(res);
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }
  if (!res.ok) {
    const err = json as { error?: string };
    throw new Error(err.error ?? `hub ${res.status}`);
  }
  return json as T;
}

export async function hubGet<T>(urlPath: string): Promise<T> {
  const res = await fetch(`${HUB}${urlPath}`, { headers: headers() });
  if (!res.ok) throw new Error(`hub ${res.status}`);
  return (await res.json()) as T;
}

export function agentIdPath(): string {
  return path.resolve(process.cwd(), ".district-agent-id");
}

export function readAgentId(): string | undefined {
  if (process.env.AGENT_ID) return process.env.AGENT_ID;
  try {
    const id = fs.readFileSync(agentIdPath(), "utf8").trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}

export function writeAgentId(id: string): void {
  try {
    fs.writeFileSync(agentIdPath(), id);
  } catch {
    /* ignore */
  }
}
