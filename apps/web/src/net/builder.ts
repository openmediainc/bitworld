import type { BuilderProfile, CollaborationWorkspace } from "@district/shared";
import { hubHttp } from "./ws";

const ID_KEY = "district.builderId";
const TOKEN_KEY = "district.builderToken";
const REQUEST_TIMEOUT_MS = 15_000;

export function builderSession(): { id: string; token: string } | null {
  const id = localStorage.getItem(ID_KEY);
  const token = localStorage.getItem(TOKEN_KEY);
  return id && token ? { id, token } : null;
}

export function clearBuilderSession(): void {
  localStorage.removeItem(ID_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export async function restoreBuilder(id: string, token: string): Promise<CollaborationWorkspace> {
  const previous = builderSession();
  localStorage.setItem(ID_KEY, id);
  localStorage.setItem(TOKEN_KEY, token);
  try {
    return await loadWorkspace();
  } catch (error) {
    if (previous) {
      localStorage.setItem(ID_KEY, previous.id);
      localStorage.setItem(TOKEN_KEY, previous.token);
    } else {
      localStorage.removeItem(ID_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
    throw error;
  }
}

function headers(): Record<string, string> {
  const session = builderSession();
  return {
    "content-type": "application/json",
    ...(session
      ? { "x-builder-id": session.id, "x-builder-token": session.token }
      : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? response.statusText);
  return json;
}

export async function registerBuilder(input: {
  handle: string;
  displayName: string;
  bio?: string;
  skills: string[];
  availability?: "available" | "limited" | "unavailable";
  collaborationTerms?: string;
}): Promise<BuilderProfile> {
  const response = await fetch(`${hubHttp()}/api/builders/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const profile = await parse<BuilderProfile>(response);
  const token = response.headers.get("x-builder-token");
  if (!token) throw new Error("hub did not return a builder token");
  localStorage.setItem(ID_KEY, profile.id);
  localStorage.setItem(TOKEN_KEY, token);
  return profile;
}

export async function builderGet<T>(path: string): Promise<T> {
  return parse<T>(
    await fetch(`${hubHttp()}${path}`, {
      headers: headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
  );
}

export async function builderPost<T>(path: string, body: unknown = {}): Promise<T> {
  return parse<T>(
    await fetch(`${hubHttp()}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
  );
}

export async function rotateBuilderToken(): Promise<string> {
  const response = await fetch(`${hubHttp()}/api/builders/me/rotate-token`, {
    method: "POST",
    headers: headers(),
    body: "{}",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await parse<{ ok: boolean }>(response);
  const token = response.headers.get("x-builder-token");
  if (!token) throw new Error("hub did not return the rotated token");
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function loadWorkspace(): Promise<CollaborationWorkspace> {
  return builderGet("/api/workspace");
}
