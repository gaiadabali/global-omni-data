import type { Metadata } from "next";
import { StubPage } from "@/components/StubPage";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.quality.title };

export default async function QualityPage() {
  requirePage(await getViewer(), "quality");
  return <StubPage pageId="quality" />;
}
