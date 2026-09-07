import { MAP_H, MAP_W, ORG_ACME_ID } from "./constants.js";
import type { Building, Org, Station } from "./types.js";

export function seedOrg(): Org {
  return {
    id: ORG_ACME_ID,
    name: "Acme",
    slug: "acme",
    color: "#3D6B4F",
    plot: { x: 2, y: 2, w: MAP_W - 4, h: MAP_H - 4 },
    public: true,
  };
}

export function seedBuildings(): Building[] {
  const orgId = ORG_ACME_ID;
  return [
    { id: "plaza_0001", orgId, name: "Plaza", kind: "plaza", rect: { x: 28, y: 20, w: 24, h: 12 }, door: { x: 39, y: 25 } },
    { id: "hq_acme001", orgId, name: "HQ", kind: "hq", rect: { x: 6, y: 6, w: 16, h: 12 }, door: { x: 13, y: 17 } },
    { id: "lib_acme01", orgId, name: "Library", kind: "library", rect: { x: 26, y: 6, w: 14, h: 12 }, door: { x: 32, y: 17 } },
    { id: "term_acme1", orgId, name: "Terminal Hall", kind: "terminal", rect: { x: 44, y: 6, w: 16, h: 12 }, door: { x: 51, y: 17 } },
    { id: "lab_acme001", orgId, name: "Lab", kind: "lab", rect: { x: 62, y: 6, w: 12, h: 12 }, door: { x: 67, y: 17 } },
    { id: "cafe_acme1", orgId, name: "Cafe", kind: "cafe", rect: { x: 6, y: 36, w: 16, h: 12 }, door: { x: 13, y: 36 } },
    { id: "board_acm1", orgId, name: "Board Room", kind: "board", rect: { x: 26, y: 36, w: 14, h: 12 }, door: { x: 32, y: 36 } },
    { id: "serv_acme1", orgId, name: "Server Room", kind: "servers", rect: { x: 44, y: 36, w: 16, h: 12 }, door: { x: 51, y: 36 } },
    { id: "mail_acme1", orgId, name: "Mail Room", kind: "mail", rect: { x: 62, y: 36, w: 12, h: 12 }, door: { x: 67, y: 36 } },
  ];
}

export function seedStations(): Station[] {
  return [
    { id: "st_frontdk", buildingId: "hq_acme001", name: "Front Desk", kind: "front_desk", tile: { x: 13, y: 16 } },
    { id: "st_hqdesk1", buildingId: "hq_acme001", name: "HQ Desk", kind: "desk", tile: { x: 10, y: 12 }, toolHint: "default" },
    { id: "st_library", buildingId: "lib_acme01", name: "Stacks", kind: "library", tile: { x: 32, y: 12 }, mcpServerName: "docs", toolHint: "search" },
    { id: "st_term_01", buildingId: "term_acme1", name: "Terminal A", kind: "terminal", tile: { x: 47, y: 12 }, mcpServerName: "bash" },
    { id: "st_term_02", buildingId: "term_acme1", name: "Terminal B", kind: "terminal", tile: { x: 51, y: 12 } },
    { id: "st_term_03", buildingId: "term_acme1", name: "Terminal C", kind: "terminal", tile: { x: 55, y: 12 } },
    { id: "st_labmain", buildingId: "lab_acme001", name: "Lab Bench", kind: "lab", tile: { x: 67, y: 12 }, mcpServerName: "pytest" },
    { id: "st_cafe_01", buildingId: "cafe_acme1", name: "Espresso", kind: "cafe", tile: { x: 10, y: 42 } },
    { id: "st_cafe_02", buildingId: "cafe_acme1", name: "Window Seat", kind: "cafe", tile: { x: 16, y: 42 } },
    { id: "st_board01", buildingId: "board_acm1", name: "Whiteboard", kind: "board", tile: { x: 32, y: 42 }, toolHint: "plan" },
    { id: "st_github_", buildingId: "serv_acme1", name: "github", kind: "server_rack", tile: { x: 47, y: 42 }, mcpServerName: "github", toolHint: "repos/search" },
    { id: "st_browser", buildingId: "serv_acme1", name: "browser", kind: "server_rack", tile: { x: 50, y: 42 }, mcpServerName: "browser" },
    { id: "st_docs___", buildingId: "serv_acme1", name: "docs", kind: "server_rack", tile: { x: 53, y: 42 }, mcpServerName: "docs" },
    { id: "st_slack__", buildingId: "serv_acme1", name: "slack", kind: "server_rack", tile: { x: 56, y: 42 }, mcpServerName: "slack" },
    { id: "st_mailbox", buildingId: "mail_acme1", name: "Mailbox", kind: "mailbox", tile: { x: 67, y: 42 }, mcpServerName: "mail" },
  ];
}
