import type { Metadata } from "next";
import { StubPage } from "@/components/StubPage";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.person.title };

export default async function PersonPage() {
  requirePage(await getViewer(), "person");
  return <StubPage pageId="person" />;
}
