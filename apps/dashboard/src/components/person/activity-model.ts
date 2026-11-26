import type { PersonProfile } from "@/server/data";
import type { MapBoxRaw, PersonAreaKind } from "@/server/data";

/**
 * Person 360 activity map: the text and small decisions behind it. Pure, so they can be tested. Precision is
 * suburb level: nothing here knows a street, and a dot is a cell centre or a suburb point.
 */
export type PersonActivity = NonNullable<PersonProfile["activity"]>;
export type ActivityArea = PersonActivity["areas"][number];
export type ActivityOutlier = PersonActivity["outliers"][number];
export type ActivityView = "areas" | "all";

export const KIND_LABEL: Record<PersonAreaKind, string> = {
  home: "Home area",
  work: "Work area",
  weekend: "Weekend area",
};

export const areaKey = (kind: PersonAreaKind) => `area:${kind}`;
export const outlierKey = (id: string) => `out:${id}`;

/** "38%", or "<1%" for a share that rounds to nothing. */
export function pct(share: number): string {
  if (share > 0 && share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}

export const spanOf = (b: MapBoxRaw): number => Math.max(b.east - b.west, b.north - b.south);

/** True when the outliers stretch the map well beyond the areas, so a second view is worth offering. */
export function hasFarOutliers(a: PersonActivity): boolean {
  return a.outliers.length > 0 && spanOf(a.view.all) > Math.max(spanOf(a.view.areas), 0.05) * 1.6;
}

/**
 * The first view. The whole picture when the outliers are not far (the areas still fill most of the map), and the
 * areas alone when an outlier is a long way off: the outliers are then one click away ("All, with outliers").
 */
export function defaultView(a: PersonActivity): ActivityView {
  if (!a.outliers.length) return "areas";
  return spanOf(a.view.all) <= Math.max(spanOf(a.view.areas), 0.05) * 3.5 ? "all" : "areas";
}

/** What an area row says about its size: "42 receipts · 38% of the last 90 days". */
export function areaLine(a: ActivityArea): string {
  const n = a.receipts.display;
  const word = a.receipts.value === 1 ? "receipt" : "receipts";
  return `${n} ${word} · ${pct(a.share)} of the last 90 days`;
}

export function categoryLine(a: ActivityArea): string {
  return a.categories.map((c) => `${c.label} ${pct(c.share)}`).join(", ");
}

export function suburbsLine(a: ActivityArea): string {
  if (!a.suburbs.length) return a.label;
  const shown = a.suburbs.slice(0, 4).join(", ");
  return a.suburbs.length > 4 ? `${shown} and ${a.suburbs.length - 4} more` : shown;
}

export function outlierPlace(o: ActivityOutlier): string {
  return `${o.suburb}, ${o.state}`;
}

/** One label per suburb, so two outliers in the same town do not print the name twice. */
export function outlierLabels(a: PersonActivity): ActivityOutlier[] {
  const seen = new Set<string>();
  return a.outliers.filter((o) => {
    const k = `${o.suburb}|${o.state}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The words a screen reader gets for the map: the same facts as the two lists. */
export function mapAltText(a: PersonActivity): string {
  const areas = a.areas.length
    ? `${a.areas.length} activity ${a.areas.length === 1 ? "area" : "areas"}: ${a.areas.map((x) => `${KIND_LABEL[x.kind].toLowerCase()} around ${x.label}`).join("; ")}`
    : "no activity area";
  const out = a.outliers.length
    ? `${a.outliers.length} ${a.outliers.length === 1 ? "outlier" : "outliers"}: ${a.outliers.map((o) => `${outlierPlace(o)}, ${o.distanceText}`).join("; ")}`
    : "no outliers";
  return `Map at suburb level for the last ${a.days} days: ${areas}; ${out}. The lists beside the map give the same details.`;
}

export interface TipContent {
  title: string;
  rows: [label: string, value: string][];
}

export function tipForArea(a: ActivityArea): TipContent {
  return {
    title: `${KIND_LABEL[a.kind]}: ${a.label}`,
    rows: [
      ["Suburbs", suburbsLine(a)],
      ["Receipts", a.receipts.display],
      ["Share", pct(a.share)],
      ["Mostly", categoryLine(a)],
    ],
  };
}

export function tipForOutlier(o: ActivityOutlier, fmtDate: (iso: string) => string): TipContent {
  return {
    title: outlierPlace(o),
    rows: [
      ["Date", fmtDate(o.date)],
      ["Category", o.categoryName],
      ["Merchant", o.merchant],
      ["Distance", o.distanceText],
    ],
  };
}
