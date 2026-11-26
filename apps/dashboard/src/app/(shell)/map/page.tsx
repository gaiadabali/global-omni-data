import type { Metadata } from "next";
import { StubPage } from "@/components/StubPage";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.map.title };

export default async function MapPage() {
  requirePage(await getViewer(), "map");
  return <StubPage pageId="map" />;
}
