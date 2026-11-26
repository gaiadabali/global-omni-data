import { BarChart, LineChart } from "@/components/charts";
import { Card, StatGrid, StatTile } from "@/components/ui";
import { deltaText, fmtPct, monthLabels } from "@/lib/format";
import type { FtrRaw, Present } from "@/server/data";

const last12 = (a: number[]) => a.slice(-12);

function shares(rows: { label: string; percent: number }[]) {
  return {
    labels: rows.map((r) => r.label),
    values: rows.map((r) => r.percent),
    valueLabels: rows.map((r) => `${r.percent}%`),
  };
}

/** Free Tax Returns: leads, accounts, the lodgement funnel, and who the customers are. */
export function FtrView({ d }: { d: Present<FtrRaw> }) {
  const labels = monthLabels(d.months);
  const acc = deltaText(d.accounts.value, d.accountsPrevMonth.value);
  const started = d.returnsStarted.value;
  const src = shares(d.sources);
  const occ = shares(d.occupations);
  const inc = shares(d.incomeBands);
  return (
    <div className="page-body b-ftr">
      <StatGrid>
        <StatTile label="Leads" value={d.leads} note="visitors who left an email or started a form" />
        <StatTile
          label="Accounts"
          value={d.accounts}
          note={
            acc ? (
              <>
                <span className={acc.up ? "d-up" : "d-dn"}>{acc.text}</span> <span>vs last month</span>
              </>
            ) : null
          }
          spark={last12(d.accountsSeries)}
          sparkColor="var(--ftr)"
        />
        <StatTile
          label="Returns started"
          value={d.returnsStarted}
          note={`${fmtPct(d.accounts.value ? started / d.accounts.value : 0)} of accounts`}
        />
        <StatTile
          label="Returns lodged"
          value={d.returnsLodged}
          note={`${fmtPct(started ? d.returnsLodged.value / started : 0)} of those started`}
        />
        <StatTile
          label="Median time to lodge"
          value={`${d.medianMinutesToLodge} min`}
          note={<span className="muted">from first screen</span>}
        />
      </StatGrid>

      <div className="cols">
        <Card title="Accounts over time">
          <LineChart
            title="Free Tax Returns accounts over time"
            description="Free Tax Returns accounts, running total by month, for the last 24 months."
            labels={labels.short}
            fullLabels={labels.full}
            height={230}
            series={[{ id: "accounts", name: "Accounts", color: "var(--ftr)", values: d.accountsSeries }]}
          />
        </Card>
        <Card title="New accounts per month">
          <p className="small muted">The July to October rise is tax season.</p>
          <BarChart
            title="New accounts per month"
            description="New Free Tax Returns accounts by month. They rise from July to October each year."
            labels={labels.short}
            height={230}
            series={[{ id: "new", name: "New accounts", color: "var(--ftr)", values: d.newAccountsSeries }]}
          />
        </Card>
      </div>

      <div className="cols">
        <Card title="Funnel">
          <BarChart
            title="Lodgement funnel"
            orientation="horizontal"
            labels={d.funnel.map((f) => f.label)}
            series={[{ id: "funnel", name: "People", color: "var(--ftr)", values: d.funnel.map((f) => f.value.value) }]}
            valueLabels={d.funnel.map((f) => f.value.display)}
          />
        </Card>
        <Card title="Where people came from">
          <BarChart
            title="Where people came from"
            orientation="horizontal"
            labels={src.labels}
            series={[{ id: "src", name: "Share", color: "var(--ftr)", values: src.values }]}
            valueLabels={src.valueLabels}
          />
        </Card>
      </div>

      <div className="cols">
        <Card title="Occupation mix">
          <BarChart
            title="Occupation mix"
            orientation="horizontal"
            labels={occ.labels}
            series={[{ id: "occ", name: "Share", color: "var(--ftr)", values: occ.values }]}
            valueLabels={occ.valueLabels}
          />
        </Card>
        <Card title="Income bracket mix">
          <p className="small muted">Taxable income bands from lodged returns.</p>
          <BarChart
            title="Income bracket mix"
            orientation="horizontal"
            labels={inc.labels}
            series={[{ id: "inc", name: "Share", color: "var(--ftr)", values: inc.values }]}
            valueLabels={inc.valueLabels}
          />
        </Card>
      </div>
    </div>
  );
}
