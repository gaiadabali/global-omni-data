import { canAccessPage, canQueryBrand } from "../access";
import { AUDIT_ACTION_LABELS, getAuditLog, type AuditAction, type AuditFilter, type AuditLog } from "../audit";
import type { BrandId, Viewer } from "../types";
import { allowListStore } from "./allowlist";
import {
  presentActivity,
  presentActivityArea,
  presentArea,
  presentHotspots,
  presentInfluence,
  presentOverview,
  presentSummary,
  presentTree,
  type PresentedActivity,
  type PresentedActivityArea,
  type PresentedArea,
  type PresentedHotspots,
  type PresentedInfluence,
  type PresentedOverview,
  type PresentedSummary,
} from "./present";
import { syntheticData } from "./synthetic";
import type {
  ActivityAreaQuery,
  ActivityQuery,
  AllowListEntry,
  AreaQuery,
  AudienceQuery,
  HotspotQuery,
  SummaryQuery,
  BrandRawMap,
  DashboardData,
  InfluenceQuery,
  InsightRaw,
  Period,
  PersonProfileRaw,
  PersonSearchRow,
  Present,
  QualityRaw,
  SessionRow,
  TeensRaw,
} from "./types";

export * from "./types";
export type {
  InfluenceCell,
  ActivityMerchant,
  ActivityHeatCell,
  PresentedInfluence,
  PresentedActivity,
  PresentedOverview,
  PresentedSummary,
  PresentedArea,
  PresentedHotspots,
  PresentedActivityArea,
} from "./present";
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

/** How long an opened profile stays open for the person who gave a reason. */
export const PERSON_GRANT_MS = 30 * 60_000;

/** What a page gets for a Person 360 id. A teen is refused: there is no variant that carries a teen profile. */
export type PersonOutcome =
  | { kind: "profile"; profile: PersonProfileRaw }
  | { kind: "needs-reason"; id: string }
  | { kind: "teen-refused"; id: string }
  | { kind: "not-found" };

export type PersonOpenOutcome =
  | { kind: "opened"; id: string }
  | { kind: "teen-refused"; id: string }
  | { kind: "not-found" };

export interface AccessEntry {
  who: string;
  when: string;
  reason: string;
}

export interface AuditRow {
  id: string;
  seq: number;
  when: string;
  who: string;
  whoName: string;
  action: AuditAction;
  actionLabel: string;
  target: string;
  reason: string;
  outcome: "done" | "refused";
}

export interface AuditView {
  rows: AuditRow[];
  /** Everyone who appears in the log, for the "who" filter. */
  whoOptions: { id: string; name: string }[];
}

export interface ViewerData {
  overview(q: { period: Period }): Promise<PresentedOverview>;
  brand<B extends BrandId>(brand: B, q: { period: Period }): Promise<Present<BrandRawMap[B]>>;
  influenceMap(q: InfluenceQuery): Promise<PresentedInfluence>;
  mapSummary(q: SummaryQuery): Promise<PresentedSummary>;
  /** null when the area id is unknown. */
  mapArea(q: AreaQuery): Promise<PresentedArea | null>;
  activityMap(q: ActivityQuery): Promise<PresentedActivity>;
  activityHotspots(q: HotspotQuery): Promise<PresentedHotspots>;
  /** null when the area id is unknown. */
  activityArea(q: ActivityAreaQuery): Promise<PresentedActivityArea | null>;
  /** `forExport` presents every count as a brand would see it, for every role. */
  insight(q: AudienceQuery): Promise<Present<InsightRaw>>;
  teens(q: { entity?: string; forExport?: boolean }): Promise<Present<TeensRaw>>;
  personSearch(q: string, limit?: number): Promise<PersonSearchRow[]>;
  /** Writes an audit event. Gives a reason, opens an adult profile for 30 minutes; refuses (and logs) a teen. */
  personOpen(id: string, reason: string): Promise<PersonOpenOutcome>;
  personGet(id: string): Promise<PersonOutcome>;
  personAccessedBy(id: string): Promise<AccessEntry[]>;
  quality(): Promise<Present<QualityRaw>>;
  adminAllowList(): Promise<AllowListEntry[]>;
  adminSessions(): Promise<SessionRow[]>;
  adminAudit(filter?: AuditFilter): Promise<AuditView>;
}

/** What a brand would see: the executive-level threshold view, used for printed reports. */
const EXPORT_VIEW = { role: "executive" } as const;

function nameOf(who: string): string {
  return allowListStore.find(who)?.name ?? who;
}

/**
 * Data for one viewer. Defence in depth: besides the page and route checks, the data layer itself refuses a
 * query the viewer's role may not make (a brand lead asking for another brand, or for the whole group; any role
 * asking for a page that is not theirs).
 */
export function getDashboardData(
  viewer: Viewer,
  source: DashboardData = provider(),
  audit: AuditLog = getAuditLog(),
): ViewerData {
  const need = (page: "insight" | "teens" | "person" | "quality" | "admin") => {
    if (!canAccessPage(viewer, page)) throw new DataAccessError(`This role cannot read ${page} data`);
  };

  return {
    async overview(q) {
      if (!canAccessPage(viewer, "home")) throw new DataAccessError("Group figures are not part of this role");
      return presentOverview(await source.overview(q), viewer);
    },
    async brand(brand, q) {
      if (!canQueryBrand(viewer, brand)) throw new DataAccessError(`This role cannot see ${brand}`);
      return presentTree(await source.brand(brand, q), viewer);
    },
    async influenceMap(q) {
      if (!canQueryBrand(viewer, q.brand)) throw new DataAccessError(`This role cannot see ${q.brand}`);
      return presentInfluence(await source.influenceMap(q), q, viewer);
    },
    async mapSummary(q) {
      if (!canQueryBrand(viewer, q.brand)) throw new DataAccessError(`This role cannot see ${q.brand}`);
      return presentSummary(await source.mapSummary(q), q, viewer);
    },
    async mapArea(q) {
      if (!canQueryBrand(viewer, q.brand)) throw new DataAccessError(`This role cannot see ${q.brand}`);
      // A brand lead sees their own brand's totals and never the all-of-GOD total, whatever the caller asked for.
      const scoped: AreaQuery =
        viewer.role === "brand_lead"
          ? { ...q, visibleBrands: q.visibleBrands.filter((b) => b === viewer.brand), showGod: false }
          : q;
      const raw = await source.mapArea(scoped);
      return raw ? presentArea(raw, scoped, viewer) : null;
    },
    async activityMap(q) {
      if (viewer.role === "brand_lead" && q.audienceBrand !== viewer.brand) {
        throw new DataAccessError("A brand lead's activity map is limited to their own brand");
      }
      return presentActivity(await source.activityMap(q), q, viewer);
    },
    async activityHotspots(q) {
      if (viewer.role === "brand_lead" && q.audienceBrand !== viewer.brand) {
        throw new DataAccessError("A brand lead's activity map is limited to their own brand");
      }
      return presentHotspots(await source.activityHotspots(q), q, viewer);
    },
    async activityArea(q) {
      if (viewer.role === "brand_lead" && q.audienceBrand !== viewer.brand) {
        throw new DataAccessError("A brand lead's activity map is limited to their own brand");
      }
      const raw = await source.activityArea(q);
      return raw ? presentActivityArea(raw, q, viewer) : null;
    },

    async insight(q) {
      need("insight");
      const raw = await source.insight(q);
      return presentTree(raw, q.forExport ? EXPORT_VIEW : viewer);
    },
    async teens(q) {
      need("teens");
      const raw = await source.teens({ ...(q.entity ? { entity: q.entity } : {}) });
      return presentTree(raw, q.forExport ? EXPORT_VIEW : viewer);
    },

    async personSearch(q, limit) {
      need("person");
      const rows = await source.personSearch(q);
      return limit ? rows.slice(0, limit) : rows;
    },
    async personOpen(id, reason) {
      need("person");
      if (reason.trim().length < 8) throw new DataAccessError("A reason is required to open a profile");
      const raw = await source.personGet(id);
      if (raw.kind === "not-found") return { kind: "not-found" };
      if (raw.kind === "teen") {
        await audit.append({
          who: viewer.id,
          action: "person.open",
          target: raw.id,
          reason: "Refused: teen profiles cannot be opened",
          outcome: "refused",
        });
        return { kind: "teen-refused", id: raw.id };
      }
      await audit.append({ who: viewer.id, action: "person.open", target: raw.profile.id, reason });
      return { kind: "opened", id: raw.profile.id };
    },
    async personGet(id) {
      need("person");
      const raw = await source.personGet(id);
      if (raw.kind === "not-found") return { kind: "not-found" };
      if (raw.kind === "teen") {
        await audit.append({
          who: viewer.id,
          action: "person.open",
          target: raw.id,
          reason: "Refused: teen profiles cannot be opened",
          outcome: "refused",
        });
        return { kind: "teen-refused", id: raw.id };
      }
      // An adult profile opens only for someone who gave a reason in the last 30 minutes.
      const [latest] = await audit.list({
        who: viewer.id,
        action: "person.open",
        target: raw.profile.id,
        outcome: "done",
        limit: 1,
      });
      if (!latest || Date.now() - Date.parse(latest.when) > PERSON_GRANT_MS) {
        return { kind: "needs-reason", id: raw.profile.id };
      }
      return { kind: "profile", profile: raw.profile };
    },
    async personAccessedBy(id) {
      need("person");
      const events = await audit.list({ action: "person.open", target: id, outcome: "done" });
      return events.map((e) => ({ who: nameOf(e.who), when: e.when, reason: e.reason }));
    },

    async quality() {
      need("quality");
      return presentTree(await source.quality(), viewer);
    },

    async adminAllowList() {
      need("admin");
      return source.adminAllowList();
    },
    async adminSessions() {
      need("admin");
      const rows = await source.adminSessions();
      return rows.map((s) => ({ ...s, current: s.personId === viewer.id }));
    },
    async adminAudit(filter = {}) {
      need("admin");
      const [events, everything] = await Promise.all([audit.list({ ...filter, limit: filter.limit ?? 200 }), audit.list()]);
      const ids = [...new Set(everything.map((e) => e.who))];
      return {
        rows: events.map((e) => ({
          id: e.id,
          seq: e.seq,
          when: e.when,
          who: e.who,
          whoName: nameOf(e.who),
          action: e.action,
          actionLabel: AUDIT_ACTION_LABELS[e.action],
          target: e.target,
          reason: e.reason,
          outcome: e.outcome,
        })),
        whoOptions: ids.map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
  };
}
