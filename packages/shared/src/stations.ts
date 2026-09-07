import type { Building, BuildingKind, Station, StationKind, Tile } from "./types.js";

export type StationMapping = {
  stationKind: StationKind;
  buildingKind: BuildingKind;
};

const RULES: Array<{ needles: string[]; mapping: StationMapping }> = [
  { needles: ["github", "gitlab"], mapping: { stationKind: "server_rack", buildingKind: "servers" } },
  { needles: ["git"], mapping: { stationKind: "server_rack", buildingKind: "servers" } },
  { needles: ["slack", "discord", "mail", "email"], mapping: { stationKind: "mailbox", buildingKind: "mail" } },
  { needles: ["browser", "playwright", "fetch"], mapping: { stationKind: "server_rack", buildingKind: "servers" } },
  { needles: ["docs", "notion", "read", "grep", "search", "glob"], mapping: { stationKind: "library", buildingKind: "library" } },
  { needles: ["test", "jest", "vitest", "pytest", "ci"], mapping: { stationKind: "lab", buildingKind: "lab" } },
  { needles: ["bash", "shell", "terminal", "cmd"], mapping: { stationKind: "terminal", buildingKind: "terminal" } },
  { needles: ["plan", "spec", "design"], mapping: { stationKind: "board", buildingKind: "board" } },
  { needles: ["idle", "wait"], mapping: { stationKind: "cafe", buildingKind: "cafe" } },
  { needles: ["ask", "approve", "human", "permission"], mapping: { stationKind: "front_desk", buildingKind: "hq" } },
];

const DEFAULT_MAPPING: StationMapping = { stationKind: "desk", buildingKind: "hq" };

export function mapToolToStationKind(server: string, tool = ""): StationMapping {
  const hay = `${server} ${tool}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.needles.some((n) => hay.includes(n))) return rule.mapping;
  }
  return DEFAULT_MAPPING;
}

export function findMappedStation(
  server: string,
  tool: string,
  stations: Station[],
  buildings: Building[],
): Station | undefined {
  const mapping = mapToolToStationKind(server, tool);
  const hay = `${server} ${tool}`.toLowerCase();
  const named = stations.find((s) => s.mcpServerName && hay.includes(s.mcpServerName.toLowerCase()));
  if (named) return named;

  const buildingIds = new Set(
    buildings.filter((b) => b.kind === mapping.buildingKind).map((b) => b.id),
  );
  const inBuilding = stations.filter((s) => buildingIds.has(s.buildingId));
  const byKind = inBuilding.find((s) => s.kind === mapping.stationKind);
  if (byKind) return byKind;
  return (
    stations.find((s) => s.kind === mapping.stationKind) ??
    inBuilding[0] ??
    stations.find((s) => s.kind === "desk")
  );
}

export function stationByKind(stations: Station[], kind: StationKind): Station | undefined {
  return stations.find((s) => s.kind === kind);
}

export function dist(a: Tile, b: Tile): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
