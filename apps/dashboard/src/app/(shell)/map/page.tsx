import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { InfluenceMapLoader } from "@/components/maps/InfluenceMapLoader";
import { sanitizeBasemapUrl } from "@/components/maps/basemap";
import { parseInfluenceState } from "@/components/maps/url-state";
import "@/components/maps/maps.css";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { mapMeta } from "@/server/map-api";
import { seesExactSmallNumbers } from "@/server/privacy";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.map.title };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MapPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = requirePage(await getViewer(), "map");
  const meta = mapMeta();
  // A brand lead's brand is fixed here and refused by the API for anything else.
  const lockedBrand = viewer.role === "brand_lead" && viewer.brand ? viewer.brand : null;
  const initial = parseInfluenceState(await searchParams, meta, lockedBrand ?? undefined);
  return (
    <div className="page-body">
      <PageHeader title={PAGES.map.title} sub={PAGES.map.sub} />
      <InfluenceMapLoader
        initial={initial}
        meta={meta}
        // Read on the server and passed down, so no NEXT_PUBLIC_ variable is needed.
        basemapUrl={sanitizeBasemapUrl(process.env.GOD_BASEMAP_PMTILES)}
        lockedBrand={lockedBrand}
        seesExact={seesExactSmallNumbers(viewer)}
      />
    </div>
  );
}
