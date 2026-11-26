import { BarChart, LineChart, StackedBar } from "@/components/charts";
import { Card, Num, StatGrid, StatTile, Table } from "@/components/ui";
import { deltaText, fmtAud, fmtPct, monthLabels } from "@/lib/format";
import type { Present, SnapAppRaw } from "@/server/data";

const last12 = (a: number[]) => a.slice(-12);

/** SnapApp: receipt capture for people and small businesses. */
export function SnapAppView({ d }: { d: Present<SnapAppRaw> }) {
  const labels = monthLabels(d.months);
  const ws = deltaText(d.workspaces.value, d.workspacesPrevMonth.value);
  const businessShare = d.workspaces.value ? d.businessWorkspaces.value / d.workspaces.value : 0;
  return (
    <div className="page-body b-sa">
      <StatGrid>
        <StatTile
          label="Workspaces"
          value={d.workspaces}
          note={
            ws ? (
              <>
                <span className={ws.up ? "d-up" : "d-dn"}>{ws.text}</span> <span>vs last month</span>
              </>
            ) : null
          }
          spark={last12(d.workspacesSeries)}
          sparkColor="var(--sa)"
        />
        <StatTile
          label="Personal / business"
          value={
            <>
              <Num n={d.personalWorkspaces} /> / <Num n={d.businessWorkspaces} />
            </>
          }
          note={`${fmtPct(businessShare, 1)} are business workspaces`}
        />
        <StatTile
          label="Receipts scanned"
          value={d.receiptsInPeriod}
          note={<span className="muted">average {fmtAud(d.averageReceipt)} a receipt</span>}
          spark={last12(d.receiptsSeries)}
          sparkColor="var(--sa)"
        />
        <StatTile label="Spend captured" value={fmtAud(d.spendCaptured)} note="AUD, all categories" />
        <StatTile
          label="Sends to Free Tax Returns"
          value={d.sendsToFtrInPeriod}
          note={`${fmtPct(d.sendShare, 1)} of scanners`}
          spark={last12(d.sendsSeries)}
          sparkColor="var(--sa)"
        />
        <StatTile
          label="Credit purchases"
          value={d.creditPurchasesInPeriod}
          note={`${fmtAud(d.creditValue)} sold`}
          spark={last12(d.creditPurchasesSeries)}
          sparkColor="var(--sa)"
        />
      </StatGrid>

      <div className="cols">
        <Card title="Receipts scanned per month">
          <BarChart
            title="Receipts scanned per month"
            description="Receipts scanned in SnapApp, by month, for the last 24 months."
            labels={labels.short}
            height={230}
            series={[{ id: "receipts", name: "Receipts scanned", color: "var(--sa)", values: d.receiptsSeries }]}
          />
        </Card>
        <Card title="Sends to Free Tax Returns">
          <p className="small muted">
            Receipts a person chose to send for deductions. Seasonal rise from July.
          </p>
          <LineChart
            title="Sends to Free Tax Returns"
            description="Receipts sent to Free Tax Returns, by month. It rises from July each year."
            labels={labels.short}
            fullLabels={labels.full}
            height={230}
            series={[
              { id: "sends", name: "Sends to Free Tax Returns", color: "var(--sa)", values: d.sendsSeries },
            ]}
          />
        </Card>
      </div>

      <div className="cols">
        <Card title="Spend captured by category">
          <p className="small muted">Per month, A$ millions, from scanned receipts.</p>
          <BarChart
            title="Spend captured by category"
            orientation="horizontal"
            labels={d.spendByCategory.map((s) => s.label)}
            series={[
              {
                id: "spend",
                name: "A$ millions",
                color: "var(--sa)",
                values: d.spendByCategory.map((s) => s.amountM),
              },
            ]}
            valueLabels={d.spendByCategory.map((s) => `A$${s.amountM.toFixed(2)}m`)}
          />
        </Card>
        <Card title="Workspaces">
          <StackedBar
            title="Personal and business workspaces"
            description="Share of SnapApp workspaces that are personal and business."
            segments={[
              {
                label: "Personal",
                value: d.personalWorkspaces.value,
                color: "var(--sa)",
                display: d.personalWorkspaces.display,
              },
              {
                label: "Business",
                value: d.businessWorkspaces.value,
                color: "var(--acc)",
                display: d.businessWorkspaces.display,
              },
            ]}
          />
          <div className="xs muted pt-1">Credit packs sold, last 30 days</div>
          <Table
            caption="Credit packs sold, last 30 days"
            columns={[
              { key: "pack", header: "Pack" },
              { key: "sold", header: "Sold", align: "right", render: (r) => <Num n={r.sold} /> },
              { key: "value", header: "Value", align: "right", render: (r) => fmtAud(r.value) },
            ]}
            rows={d.packs}
          />
        </Card>
      </div>
    </div>
  );
}
