import { seedBuildings, seedOrg, seedStations, type Building, type Org, type Station } from "@district/shared";

export function createSeedCampus(): { org: Org; buildings: Building[]; stations: Station[] } {
  return {
    org: seedOrg(),
    buildings: seedBuildings(),
    stations: seedStations(),
  };
}
