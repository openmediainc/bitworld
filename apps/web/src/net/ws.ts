import { agentIdOf, rememberToken, TOKEN_HEADER, tokenFor } from "./token";
import type { Agent, Mission, ServerMessage, Snapshot, Task, WorldEvent } from "@district/shared";

export type ConnState = "green" | "yellow" | "red";

const BACKOFF = [500, 1000, 2000, 5000];

function stripSlash(s: string): string {
  return s.replace(/\/$/, "");
}

/** Dev talks to the hub directly. Production uses same-origin + Vite base (e.g. /district). */
export function hubHttp(): string {
  if (import.meta.env.DEV) return "http://127.0.0.1:4242";
  return `${window.location.origin}${stripSlash(import.meta.env.BASE_URL)}`;
}

export function hubWs(): string {
  if (import.meta.env.DEV) return "ws://127.0.0.1:4242/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${stripSlash(import.meta.env.BASE_URL)}/ws`;
}

export type WsApi = {
  send: (msg: object) => void;
  close: () => void;
};

export function connectWs(handlers: {
  onSnapshot: (s: Snapshot) => void;
  onDelta: (d: { agents?: Agent[]; events?: WorldEvent[]; tasks?: Task[]; missions?: Mission[] }) => void;
  onSession?: (visitorId?: string) => void;
  onStatus: (s: ConnState) => void;
  name?: string;
  visitorId?: string;
}): WsApi {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let timer: number | undefined;

  const open = () => {
    if (closed) return;
    handlers.onStatus("yellow");
    ws = new WebSocket(hubWs());
    ws.onopen = () => {
      attempt = 0;
      handlers.onStatus("green");
      ws?.send(
        JSON.stringify({
          type: "hello",
          role: "visitor",
          name: handlers.name ?? "Visitor",
          visitorId: handlers.visitorId,
        }),
      );
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      if (msg.type === "session") handlers.onSession?.(msg.payload.visitorId);
      if (msg.type === "snapshot") handlers.onSnapshot(msg.payload);
      if (msg.type === "delta") handlers.onDelta(msg.payload);
    };
    ws.onclose = () => {
      handlers.onStatus("red");
      if (closed) return;
      const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      attempt++;
      timer = window.setTimeout(open, wait);
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return {
    send: (msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    },
  };
}

export const HUB = hubHttp;

export async function postJson(path: string, body: unknown): Promise<unknown> {
  const actingAs = agentIdOf(path, body);
  const token = tokenFor(actingAs);
  const res = await fetch(`${hubHttp()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { [TOKEN_HEADER]: token } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // A spawn hands back the secret for the agent it just created, once.
  const issued = res.headers.get(TOKEN_HEADER);
  if (issued) {
    const id = actingAs ?? (json as { id?: string }).id;
    if (id) rememberToken(id, issued);
  }
  if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText);
  return json;
}
