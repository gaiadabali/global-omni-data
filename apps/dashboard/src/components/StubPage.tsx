import { Card, PageHeader } from "@/components/ui";
import { PAGES, type PageId } from "@/lib/pages";

/**
 * A page that exists, is access-checked and has its place in the nav, but whose content is built in a later
 * step. The page file does the access check (requirePage) before it renders this.
 */
export function StubPage({ pageId }: { pageId: PageId }) {
  const page = PAGES[pageId];
  return (
    <div className="page-body">
      <PageHeader title={page.title} sub={page.sub} />
      <Card>
        <p>Built in the next step</p>
      </Card>
    </div>
  );
}
