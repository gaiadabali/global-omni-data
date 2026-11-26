import { BarChart, LineChart } from "@/components/charts";
import { Badge, Card, Num, StatGrid, StatTile, Table } from "@/components/ui";
import { deltaText, fmtAud, fmtPct, monthLabels } from "@/lib/format";
import type { Present, YourTalRaw } from "@/server/data";

const last12 = (a: number[]) => a.slice(-12);

function delta(now: number, before: number, suffix: string) {
  const d = deltaText(now, before);
  return d ? (
    <>
      <span className={d.up ? "d-up" : "d-dn"}>{d.text}</span> <span>{suffix}</span>
    </>
  ) : null;
}

/** YourTal: viewers, campaigns, watches, points, vouchers. The numbers are simulated; no money moves. */
export function YourTalView({ d }: { d: Present<YourTalRaw> }) {
  const labels = monthLabels(d.months);
  const simulated = (
    <Badge tone="warn" plain title="No real money moves in this phase">
      Simulated
    </Badge>
  );
  return (
    <div className="page-body b-yt">
      <StatGrid>
        <StatTile
          label="Viewers"
          value={d.viewers}
          note={delta(d.viewers.value, d.viewersPrevMonth.value, "vs last month")}
          spark={last12(d.viewersSeries)}
          sparkColor="var(--yt)"
        />
        <StatTile
          label="Businesses"
          value={d.businesses}
          note={delta(d.businesses.value, d.businessesPrevMonth.value, "vs last month")}
          spark={last12(d.businessesSeries)}
          sparkColor="var(--yt)"
        />
        <StatTile
          label="Live campaigns"
          value={d.liveCampaigns}
          note={
            <>
              <Num n={d.campaignsStartedThisMonth} /> started this month
            </>
          }
        />
        <StatTile
          label="Watches completed"
          value={d.watchesInPeriod}
          note={<span className="muted">{fmtPct(d.completionRate)} watched to the end</span>}
          spark={last12(d.watchesSeries)}
          sparkColor="var(--yt)"
        />
        <StatTile
          label="Points issued"
          value={d.pointsInPeriod}
          note={<span className="muted">1 point = A$0.001 of voucher value</span>}
          spark={last12(d.pointsSeries)}
          sparkColor="var(--yt)"
        />
        <StatTile
          label="Vouchers redeemed"
          value={d.vouchersRedeemed}
          note={
            <>
              of <Num n={d.vouchersClaimed} /> claimed
            </>
          }
        />
        <StatTile label="Voucher value redeemed" value={fmtAud(d.voucherValueRedeemed)} note={simulated} />
      </StatGrid>

      <div className="cols">
        <Card title="Viewers over time">
          <LineChart
            title="Viewers over time"
            description="YourTal viewers registered, running total by month, for the last 24 months."
            labels={labels.short}
            fullLabels={labels.full}
            height={230}
            series={[{ id: "viewers", name: "Viewers", color: "var(--yt)", values: d.viewersSeries }]}
          />
        </Card>
        <Card title="Watches completed per month">
          <BarChart
            title="Watches completed per month"
            description="Campaign videos watched to the end, by month, for the last 24 months."
            labels={labels.short}
            height={230}
            series={[{ id: "watches", name: "Watches completed", color: "var(--yt)", values: d.watchesSeries }]}
          />
        </Card>
      </div>

      <div className="cols">
        <Card title="Live campaigns by category">
          <BarChart
            title="Live campaigns by category"
            orientation="horizontal"
            labels={d.campaignsByCategory.map((c) => c.label)}
            series={[
              {
                id: "campaigns",
                name: "Live campaigns",
                color: "var(--yt)",
                values: d.campaignsByCategory.map((c) => c.value.value),
              },
            ]}
            valueLabels={d.campaignsByCategory.map((c) => c.value.display)}
          />
        </Card>
        <Card title="Money">
          <div className="row">
            {simulated}
            <span className="small muted">Sample figures. No payment moves.</span>
          </div>
          <BarChart
            title="Campaign money"
            orientation="horizontal"
            labels={d.money.map((m) => m.label)}
            series={[{ id: "money", name: "A$", color: "var(--yt)", values: d.money.map((m) => m.amount) }]}
            valueLabels={d.money.map((m) => fmtAud(m.amount))}
          />
        </Card>
      </div>

      <Card title="Top campaigns, last 90 days" flush>
        <Table
          caption="Top campaigns, last 90 days"
          columns={[
            { key: "name", header: "Campaign" },
            { key: "watches", header: "Watches", align: "right", render: (r) => <Num n={r.watches} /> },
            { key: "completion", header: "Completion", align: "right", render: (r) => fmtPct(r.completion) },
            { key: "points", header: "Points issued", align: "right", render: (r) => <Num n={r.points} /> },
            { key: "redeemed", header: "Redeemed", align: "right", render: (r) => <Num n={r.redeemed} /> },
          ]}
          rows={d.topCampaigns}
        />
      </Card>
    </div>
  );
}
