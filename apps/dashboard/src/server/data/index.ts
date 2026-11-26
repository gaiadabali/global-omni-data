import { canAccessPage, canQueryBrand } from "../access";
import type { BrandId, Viewer } from "../types";
import {
  presentActivity,
  presentInfluence,
  presentTree,
  type PresentedActivity,
  type PresentedInfluence,
} from "./present";
import { syntheticData } from "./synthetic";
import type {
  ActivityQuery,
  BrandRawMap,
  DashboardData,
  InfluenceQuery,
  OverviewRaw,
  Period,
  Present,
} from "./types";

export * from "./types";
export type { InfluenceCell, ActivityMerchant, ActivityHeatCell, PresentedInfluence, PresentedActivity } from "./present";
export type { LegendBreak } from "./legend";

/**
 * THE DATA SEAM, page side. Pages and route handlers call getDashboardData(viewer) from the server and nothing
 * else: the result is already thresholded for that viewer. Which provider answers is decided here, in one place.
 * The warehouse provider will implement DashboardData (./types.ts) and be selected below.
 */
function provider(): DashboardData {
  const name = process.env.GOD_DATA_PROVIDER ?? "synthetic";
  if (name === "synthetic") return syntheticData;
  throw new Error(`Unknown GOD_DATA_PROVIDER: ${name}`);
}

export class DataAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataAccessError";
  }
}

export interface ViewerData {
  overview(q: { period: Period }): Promise<Present<OverviewRaw>>;
  brand<B extends BrandId>(brand: B, q: { period: Period }): Promise<Present<BrandRawMap[B]>>;
  influenceMap(q: InfluenceQuery): Promise<PresentedInfluence>;
  activityMap(q: ActivityQuery): Promise<PresentedActivity>;
}

/**
 * Data for one viewer. Defence in depth: besides the page and route checks, the data layer itself refuses a
 * query the viewer's role may not make (a brand lead asking for another brand, or for the whole group).
 */
export function getDashboardData(viewer: Viewer, source: DashboardData = provider()): ViewerData {
  return {
    async overview(q) {
      if (!canAccessPage(viewer, "home")) throw new DataAccessError("Group figures are not part of this role");
      return presentTree(await source.overview(q), viewer);
    },
    async brand(brand, q) {
      if (!canQueryBrand(viewer, brand)) throw new DataAccessError(`This role cannot see ${brand}`);
      return presentTree(await source.brand(brand, q), viewer);
    },
    async influenceMap(q) {
      if (!canQueryBrand(viewer, q.brand)) throw new DataAccessError(`This role cannot see ${q.brand}`);
      return presentInfluence(await source.influenceMap(q), q, viewer);
    },
    async activityMap(q) {
      if (viewer.role === "brand_lead" && q.audienceBrand !== viewer.brand) {
        throw new DataAccessError("A brand lead's activity map is limited to their own brand");
      }
      return presentActivity(await source.activityMap(q), q, viewer);
    },
  };
}
