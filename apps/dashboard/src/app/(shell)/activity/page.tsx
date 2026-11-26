import type { Metadata } from "next";
import { StubPage } from "@/components/StubPage";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.activity.title };

export default async function ActivityPage() {
  requirePage(await getViewer(), "activity");
  return <StubPage pageId="activity" />;
}
