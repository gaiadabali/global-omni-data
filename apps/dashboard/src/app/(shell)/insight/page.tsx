import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import "@/components/pages/pages.css";
import { AudienceReport } from "@/components/insight/AudienceReport";
import { EntityPicker } from "@/components/insight/EntityPicker";
import { ExportButton } from "@/components/insight/ExportButton";
import { ReportSheet } from "@/components/insight/ReportSheet";
import { Card, PageHeader } from "@/components/ui";
import { first } from "@/lib/params";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getDashboardData } from "@/server/data";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.insight.title };

const DEFAULT_ENTITY = "southern";

type Props = { searchParams: Promise<{ entity?: string | string[]; print?: string | string[]; auto?: string | string[] }> };

/** Brand insight: who shops at a chain, merchant or category. Owner, Executive and Data team. */
export default async function InsightPage({ searchParams }: Props) {
  const viewer = requirePage(await getViewer(), "insight");
  const sp = await searchParams;
  const print = first(sp.print) === "1";
  // An export view, even opened by its URL, is not for an emergency (break-glass) session. The data layer refuses too.
  if (print && viewer.breakGlass) forbidden();
  const data = getDashboardData(viewer);

  // An unknown ?entity= falls back to the first report instead of failing.
  const wanted = first(sp.entity) ?? DEFAULT_ENTITY;
  const load = (entity: string) => data.insight({ entity, forExport: print });
  let result: Awaited<ReturnType<typeof load>>;
  try {
    result = await load(wanted);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    result = await load(DEFAULT_ENTITY);
  }
  const { report, entities } = result;
  const entity = report.entity;

  if (print) {
    return (
      <ReportSheet
        title="Brand insight report"
        name={entity.name}
        kind={entity.kind}
        asOf={report.asOf}
        exportedBy={viewer.displayName}
        backHref={`/insight?entity=${encodeURIComponent(entity.id)}`}
        auto={first(sp.auto) === "1"}
      >
        <AudienceReport r={report} print />
      </ReportSheet>
    );
  }

  return (
    <div className="page-body">
      <PageHeader
        title={PAGES.insight.title}
        sub={PAGES.insight.sub}
        actions={viewer.breakGlass ? null : <ExportButton kind="insight" entity={entity.id} reportName={`Brand insight report: ${entity.name}`} />}
      />
      <Card>
        <div className="row picker-row">
          <EntityPicker entities={entities} value={entity.id} />
          <div className="small muted grow-note">{entity.kind}</div>
        </div>
      </Card>
      <AudienceReport r={report} />
    </div>
  );
}
