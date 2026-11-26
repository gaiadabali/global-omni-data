import type { Metadata } from "next";
import { StubPage } from "@/components/StubPage";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.insight.title };

export default async function InsightPage() {
  requirePage(await getViewer(), "insight");
  return <StubPage pageId="insight" />;
}
