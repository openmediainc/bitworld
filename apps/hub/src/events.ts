import type { World } from "./world.js";

export function recentEvents(world: World, limit = 50) {
  return world.events.slice(-limit);
}
