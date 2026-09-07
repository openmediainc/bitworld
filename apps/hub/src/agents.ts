import type { World } from "./world.js";
import type { Agent } from "@district/shared";

export function listAgents(world: World): Agent[] {
  return [...world.agents.values()];
}

export function getAgent(world: World, id: string): Agent | undefined {
  return world.agents.get(id);
}
