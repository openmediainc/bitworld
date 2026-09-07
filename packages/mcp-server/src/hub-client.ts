import fs from "node:fs";
import path from "node:path";

const HUB = process.env.HUB_URL ?? "http://127.0.0.1:4242";
const API_KEY = process.env.API_KEY ?? "";

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

export async function hubPost<T>(urlPath: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${HUB}${urlPath}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
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
