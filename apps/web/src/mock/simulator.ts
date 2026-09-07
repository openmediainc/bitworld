import { postJson } from "../net/ws";

export async function startSimulator(): Promise<void> {
  await postJson("/api/sim/start", {});
}

export async function stopSimulator(): Promise<void> {
  await postJson("/api/sim/stop", {});
}
