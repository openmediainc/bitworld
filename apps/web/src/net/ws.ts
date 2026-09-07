import type { Agent, ServerMessage, Snapshot, Task, WorldEvent } from "@district/shared";

export type ConnState = "green" | "yellow" | "red";

const BACKOFF = [500, 1000, 2000, 5000];

export type WsApi = {
  send: (msg: object) => void;
  close: () => void;
};

export function connectWs(handlers: {
  onSnapshot: (s: Snapshot) => void;
  onDelta: (d: { agents?: Agent[]; events?: WorldEvent[]; tasks?: Task[] }) => void;
  onStatus: (s: ConnState) => void;
  name?: string;
}): WsApi {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let timer: number | undefined;

  const open = () => {
    if (closed) return;
    handlers.onStatus(attempt === 0 ? "yellow" : "yellow");
    ws = new WebSocket("ws://127.0.0.1:4242/ws");
    ws.onopen = () => {
      attempt = 0;
      handlers.onStatus("green");
      ws?.send(JSON.stringify({ type: "hello", role: "visitor", name: handlers.name ?? "Visitor" }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
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

export const HUB = "http://127.0.0.1:4242";

export async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${HUB}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText);
  return json;
}
