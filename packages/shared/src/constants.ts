export const TILE_SIZE = 16;
export const MAP_W = 80;
export const MAP_H = 56;
export const RENDER_ZOOM = 3;
export const TICK_HZ = 10;
export const MAX_AGENTS = 40;
export const MAX_EVENTS = 500;
export const MOVE_TILES_PER_SEC = 4;
export const HEARTBEAT_TIMEOUT_MS = 45_000;
export const BUBBLE_MS = 8_000;
export const SNAPSHOT_EVERY_MS = 5_000;
export const PERSIST_EVERY_MS = 5_000;
export const SIM_TICK_MS = 1_000;
export const ASTAR_MAX_NODES = 4_000;
export const ORG_ACME_ID = "org_acme";
export const VISITOR_ID = "visitor_local";
export const FOUNTAIN = { x: 39, y: 25 } as const;
export const AVENUE_KM0 = { x: 39, y: 26 } as const;
export const BITGRID_URL = "https://bitgrid.base44.app";
export const BITHERD_URL = "https://bitherd-market-live.base44.app";
export const LABOR_DISCLAIMER =
  "Reputation is accepted contributions, not money. Ranking is not endorsement. Being connected does not exempt you from campus rules.";
export const HELP_WANTED_DISCLAIMER =
  "Help-wanted tasks are public-safe volunteer work. Bring your own model (subscription or local). No credentials, private source, patient data, or client secrets. A human must accept the artifact before it counts as reputation. No credits, wallets, or payouts.";
export const CAMPUS_RULES = [
  "Agent motion must map to real heartbeats and tool events.",
  "No fake work.",
  "Org plots are membership, not for sale. HQ cannot be bought.",
  "Paid pixels belong on BitGrid, never as rent on this campus.",
  "No selling leaderboard placement.",
  "Help-wanted work is public-safe only. No secrets, private source, or confidential data.",
  "Reputation is accepted artifacts, not time on campus or unfinished dumps.",
  "Being connected does not exempt you from campus rules.",
].join("\n");

export const PALETTE = {
  grass: "#3E8948",
  grassDark: "#2F6B38",
  path: "#C7A36A",
  pathDark: "#A7844E",
  wall: "#4A3B32",
  wallHighlight: "#6B5346",
  floorHq: "#D7C4A3",
  floorLibrary: "#C9B48A",
  floorTerminal: "#2B2F3A",
  floorLab: "#D5E0D6",
  floorCafe: "#E8C9A8",
  floorBoard: "#E6DCC8",
  floorServers: "#1F242C",
  floorMail: "#D2C2A6",
  roofHq: "#7A3E2E",
  roofLibrary: "#3E5A7A",
  roofTerminal: "#3A3F55",
  roofLab: "#4F7A5A",
  roofCafe: "#B85C38",
  roofBoard: "#6B4E9E",
  roofServers: "#2A2E38",
  roofMail: "#8A6A32",
  water: "#3D7EA6",
  shadow: "#00000055",
} as const;

export const FLOOR_BY_KIND: Record<string, string> = {
  plaza: PALETTE.path,
  hq: PALETTE.floorHq,
  library: PALETTE.floorLibrary,
  lab: PALETTE.floorLab,
  terminal: PALETTE.floorTerminal,
  servers: PALETTE.floorServers,
  cafe: PALETTE.floorCafe,
  board: PALETTE.floorBoard,
  mail: PALETTE.floorMail,
  house: PALETTE.floorHq,
};

export const ROOF_BY_KIND: Record<string, string> = {
  plaza: PALETTE.path,
  hq: PALETTE.roofHq,
  library: PALETTE.roofLibrary,
  lab: PALETTE.roofLab,
  terminal: PALETTE.roofTerminal,
  servers: PALETTE.roofServers,
  cafe: PALETTE.roofCafe,
  board: PALETTE.roofBoard,
  mail: PALETTE.roofMail,
  house: PALETTE.roofHq,
};

export const NORTH_DOOR_KINDS = new Set(["cafe", "board", "servers", "mail"]);

export const SPRITE_IDS = [
  "kael",
  "yuki",
  "nora",
  "rex",
  "iris",
  "cobb",
  "lark",
  "moss",
] as const;

export const SPRITE_COLORS: Record<string, string> = {
  kael: "#C45C26",
  yuki: "#5B8DEF",
  nora: "#D4A017",
  rex: "#7A3E9E",
  iris: "#2F9E6A",
  cobb: "#C43C3C",
  lark: "#3AA6A6",
  moss: "#6B8F3A",
  visitor: "#3D6EA8",
};
