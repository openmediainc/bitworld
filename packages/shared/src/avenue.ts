import { AVENUE_KM0, BITGRID_URL, BITHERD_URL, MAP_H, MAP_W, ORG_ACME_ID } from "./constants.js";
import type { AvenuePlot, Building, Rect, Station } from "./types.js";

export const AVENUE_REFUSE =
  "Org plots are membership, not for sale. HQ cannot be bought. Paid pixels live on BitGrid.";

export function seedAvenuePlots(): AvenuePlot[] {
  const northY = 10;
  const h = 10;
  const w = 8;
  const gap = 2;
  const startX = 4;
  const specs: Array<Omit<AvenuePlot, "rect" | "door" | "forSale">> = [
    {
      id: "plot_01",
      address: "Avenue, 1",
      orgId: ORG_ACME_ID,
      orgName: "Acme",
      slug: "acme",
      color: "#3D6B4F",
      kind: "org",
      campusKind: "plaza",
    },
    {
      id: "plot_02",
      address: "Avenue, 2",
      orgId: "org_openmedia",
      orgName: "Open Media",
      slug: "open-media",
      color: "#2A4A6A",
      kind: "org",
    },
    {
      id: "plot_03",
      address: "Avenue, 3",
      orgId: "org_bitherd",
      orgName: "BitHerd",
      slug: "bitherd",
      color: "#7DFFE0",
      kind: "org",
      href: BITHERD_URL,
    },
    {
      id: "plot_04",
      address: "Avenue, 4",
      orgId: "org_bitgrid",
      orgName: "BitGrid",
      slug: "bitgrid",
      color: "#F7931A",
      kind: "billboard",
      href: BITGRID_URL,
    },
    { id: "plot_05", address: "Avenue, 5", orgName: "Unassigned", slug: "plot-5", color: "#6B5346", kind: "empty" },
    { id: "plot_06", address: "Avenue, 6", orgName: "Unassigned", slug: "plot-6", color: "#6B5346", kind: "empty" },
    { id: "plot_07", address: "Avenue, 7", orgName: "Unassigned", slug: "plot-7", color: "#6B5346", kind: "empty" },
    { id: "plot_08", address: "Avenue, 8", orgName: "Unassigned", slug: "plot-8", color: "#6B5346", kind: "empty" },
  ];
  return specs.map((spec, i) => {
    const x = startX + i * (w + gap);
    const rect: Rect = { x, y: northY, w, h };
    return {
      ...spec,
      rect,
      door: { x: x + Math.floor(w / 2), y: northY + h },
      forSale: false,
    };
  });
}

export function avenueStreetBuilding(): Building {
  return {
    id: "b_avenue",
    orgId: "org_avenue",
    name: "Claimless Avenue",
    kind: "plaza",
    rect: { x: 2, y: 22, w: 76, h: 10 },
    door: { ...AVENUE_KM0 },
  };
}

export function avenueBuildings(plots = seedAvenuePlots()): Building[] {
  const houses: Building[] = plots.map((p) => ({
    id: p.id,
    orgId: p.orgId ?? "org_empty",
    name: p.orgName,
    kind: "house",
    rect: p.rect,
    door: p.door,
  }));
  return [avenueStreetBuilding(), ...houses];
}

export function avenueStations(plots = seedAvenuePlots()): Station[] {
  return plots.map((p) => ({
    id: `st_${p.id}`,
    buildingId: p.id,
    name: p.address,
    kind: "desk",
    tile: { x: p.door.x, y: p.door.y - 1 },
    mcpServerName: p.slug,
  }));
}

export function avenueInBounds(): boolean {
  return MAP_W === 80 && MAP_H === 56;
}
