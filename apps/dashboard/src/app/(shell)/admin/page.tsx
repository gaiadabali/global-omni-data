import type { Metadata } from "next";
import { StubPage } from "@/components/StubPage";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.admin.title };

export default async function AdminPage() {
  requirePage(await getViewer(), "admin");
  return <StubPage pageId="admin" />;
}
