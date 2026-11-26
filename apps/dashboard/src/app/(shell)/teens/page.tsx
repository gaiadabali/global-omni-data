import type { Metadata } from "next";
import { StubPage } from "@/components/StubPage";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.teens.title };

export default async function TeensPage() {
  requirePage(await getViewer(), "teens");
  return <StubPage pageId="teens" />;
}
