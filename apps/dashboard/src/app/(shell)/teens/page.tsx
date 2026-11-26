import type { Metadata } from "next";
import "@/components/pages/pages.css";
import { BarChart, StackedBar } from "@/components/charts";
import { AudienceReport } from "@/components/insight/AudienceReport";
import { EntityPicker } from "@/components/insight/EntityPicker";
import { ExportButton } from "@/components/insight/ExportButton";
import { ReportSheet } from "@/components/insight/ReportSheet";
import { ShareBars } from "@/components/insight/ShareBars";
import { TeenRules } from "@/components/insight/TeenRules";
import { Card, PageHeader, StatGrid, StatTile } from "@/components/ui";
import { fmtPct } from "@/lib/format";
import { first } from "@/lib/params";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getDashboardData } from "@/server/data";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.teens.title };

const DEFAULT_ENTITY = "kidzone";

type Props = { searchParams: Promise<{ entity?: string | string[]; print?: string | string[]; auto?: string | string[] }> };

/** Teen market: aged 13 to 17, in groups of 20 or more only. Owner, Executive and Data team. */
export default async function TeensPage({ searchParams }: Props) {
  const viewer = requirePage(await getViewer(), "teens");
  const sp = await searchParams;
  const print = first(sp.print) === "1";
  const data = getDashboardData(viewer);

  const load = (entity: string) => data.teens({ entity, forExport: print });
  let t: Awaited<ReturnType<typeof load>>;
  try {
    t = await load(first(sp.entity) ?? DEFAULT_ENTITY);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    t = await load(DEFAULT_ENTITY);
  }
  const report = t.report;
  const entity = report.entity;

  if (print) {
    return (
      <ReportSheet
        title="Teen market report"
        name={entity.name}
        kind={`${entity.kind}. Teens aged 13 to 17, groups of 20 or more`}
        asOf={report.asOf}
        exportedBy={viewer.displayName}
        backHref={`/teens?entity=${encodeURIComponent(entity.id)}`}
        auto={first(sp.auto) === "1"}
      >
        <TeenRules />
        <AudienceReport r={report} print />
      </ReportSheet>
    );
  }

  const whole = t.teensInGod;
  const spend = t.spendPerActiveTeen;
  const brandTotal = t.brandMix.reduce((a, r) => a + r.value.value, 0);

  return (
    <div className="page-body">
      <PageHeader
        title={PAGES.teens.title}
        sub={PAGES.teens.sub}
        actions={<ExportButton kind="teens" entity={entity.id} reportName={`Teen market report: ${entity.name}`} />}
      />

      <TeenRules />

      <StatGrid>
        <StatTile label="Guardian notice" value={fmtPct(t.guardianNoticeShare)} note="of teen accounts accepted the GOD notice" />
        <StatTile label="Group size" value="20+" note="shown only in groups of 20 or more" />
        <StatTile label="Profiles" value="0" note="no teen profile is openable" />
        <StatTile
          className="b-yt"
          label="Teens in GOD"
          value={t.teensInGod}
          note="groups of 20 or more only"
          spark={t.teensSeries.slice(-12)}
          sparkColor="var(--yt)"
        />
        <StatTile
          label="Use YourTal"
          value={fmtPct(t.usesYourTalShare)}
          note={`also SnapApp: ${fmtPct(t.alsoSnapAppShare)}`}
        />
        <StatTile label="Repeat visit rate" value={fmtPct(t.repeatRate)} note="visited the same venue twice in 30 days" />
        <StatTile label="Visit frequency" value={`${t.visitsPerActiveTeen.toFixed(1)} a month`} note="average per active teen" />
      </StatGrid>

      <div className="cols">
        <Card title="Interests, declared">
          <p className="small muted">What teens pick in their YourTal profile. Share of teens.</p>
          <ShareBars
            title="Declared interests"
            description="Share of teens who picked each interest in their YourTal profile."
            rows={t.interestsDeclared}
            whole={whole}
            color="var(--yt)"
          />
        </Card>
        <Card title="Interests, learned">
          <p className="small muted">Worked out from what they watch and where they spend. Share of teens.</p>
          <ShareBars
            title="Learned interests"
            description="Share of teens with each interest worked out from what they watch and where they spend."
            rows={t.interestsLearned}
            whole={whole}
          />
        </Card>
        <Card title="Spend by category">
          <p className="small muted">Average A$ a month per active teen.</p>
          <BarChart
            title="Spend by category"
            description="Average spend a month per active teen, by category. Sensitive categories are not reported for teens."
            orientation="horizontal"
            labels={spend.map((s) => s.label)}
            series={[{ id: "spend", name: "A$ a month", color: "var(--sa)", values: spend.map((s) => s.amount) }]}
            valueLabels={spend.map((s) => `A$${s.amount.toFixed(2)}`)}
          />
          <p className="xs muted">Sensitive categories are never reported for teens.</p>
        </Card>
      </div>

      <div className="cols">
        <Card title="Loyalty and frequency">
          <ShareBars
            title="Visit frequency"
            description="Share of teens by how often they visit."
            rows={t.loyalty}
            whole={whole}
          />
          <p className="xs muted">
            Teens who came back within 30 days: {fmtPct(t.cameBackWithin30Days)}. Teens who also visited a competing
            venue: {fmtPct(t.alsoVisitedCompetitor)}.
          </p>
        </Card>
        <Card title="GOD brands they use">
          <StackedBar
            title="GOD brands teens use"
            description="Share of teens who use YourTal only, YourTal and SnapApp, or SnapApp only."
            segments={t.brandMix.map((r, i) => ({
              label: r.label,
              value: r.value.value,
              display: r.value.display,
              color: ["var(--yt)", "var(--sa)", "var(--acc)"][i] ?? "var(--acc)",
            }))}
          />
          {brandTotal === 0 ? <p className="xs muted">Every group is under 20.</p> : null}
          <p className="xs muted">Free Tax Returns is for adults and has no teen accounts.</p>
        </Card>
      </div>

      <Card title={`Example report: ${entity.name}`}>
        <div className="row picker-row">
          <EntityPicker entities={t.entities} value={entity.id} />
          <div className="small muted grow-note">{entity.kind}. All figures are groups of 20 or more.</div>
        </div>
        <AudienceReport r={report} />
      </Card>
    </div>
  );
}
