import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ActivityMapLoader } from "@/components/maps/ActivityMapLoader";
import { sanitizeBasemapUrl } from "@/components/maps/basemap";
import { parseActivityState } from "@/components/maps/url-state";
import "@/components/maps/maps.css";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { mapMeta } from "@/server/map-api";
import { seesExactSmallNumbers } from "@/server/privacy";
import { BRAND_LABELS } from "@/server/types";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.activity.title };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = requirePage(await getViewer(), "activity");
  const meta = mapMeta();
  const initial = parseActivityState(await searchParams, meta);
  return (
    <div className="page-body">
      <PageHeader title={PAGES.activity.title} sub={PAGES.activity.sub} />
      <ActivityMapLoader
        initial={initial}
        meta={meta}
        basemapUrl={sanitizeBasemapUrl(process.env.GOD_BASEMAP_PMTILES)}
        // A brand lead's map covers only people who also use their own brand (the API applies this).
        lockedBrandName={viewer.role === "brand_lead" && viewer.brand ? BRAND_LABELS[viewer.brand] : null}
        seesExact={seesExactSmallNumbers(viewer)}
      />
    </div>
  );
}
