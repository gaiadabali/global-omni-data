import type { Metadata } from "next";
import "@/components/pages/pages.css";
import { StackedBar } from "@/components/charts";
import { Sparkline } from "@/components/charts/Sparkline";
import { RunVerifyButton } from "@/components/quality/RunVerifyButton";
import { Badge, Card, Num, PageHeader, StatGrid, type BadgeTone } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { fmtInt, fmtPct } from "@/lib/format";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getDashboardData } from "@/server/data";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.quality.title };

function lagText(s: number): string {
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

const RESULT: Record<string, { tone: BadgeTone; text: string }> = {
  ok: { tone: "ok", text: "Passed" },
  warn: { tone: "warn", text: "Passed on rerun" },
  crit: { tone: "crit", text: "Failed" },
  pending: { tone: "info", text: "Scheduled" },
};
const JOB_RESULT: Record<string, { tone: BadgeTone; text: string }> = {
  ok: { tone: "ok", text: "Passed" },
  warn: { tone: "warn", text: "Slow" },
  crit: { tone: "crit", text: "Failed, retrying" },
};

/** Data quality: Owner and Data team. Whether GOD matches the apps, how fresh it is, and how teen data is checked. */
export default async function QualityPage() {
  const viewer = requirePage(await getViewer(), "quality");
  const q = await getDashboardData(viewer).quality();
  const totalMerges = q.merges.bySignIn.value + q.merges.byEmail.value;
  const geoTotal = q.geocoding.reduce((a, g) => a + g.value.value, 0) || 1;
  const runs = q.verification;
  const passed = runs.filter((v) => v.result === "ok").length;
  const rerun = runs.filter((v) => v.result === "warn").length;
  const failed = runs.filter((v) => v.result === "crit").length;

  return (
    <div className="page-body">
      <PageHeader title={PAGES.quality.title} sub={PAGES.quality.sub} actions={<RunVerifyButton />} />

      <StatGrid>
        {q.lag.map((l) => (
          <div className="card kpi" key={l.source}>
            <div className="l">Replication lag, {l.source}</div>
            <div className="v">{lagText(l.seconds)}</div>
            <div className="n">
              <Badge tone={l.status === "ok" ? "ok" : "warn"}>{l.status === "ok" ? "Within 2 min" : "Above 5 min"}</Badge>
            </div>
            <Sparkline values={l.series} color={l.status === "ok" ? "var(--ok)" : "var(--warn)"} />
          </div>
        ))}
        <div className="card kpi">
          <div className="l">Merges undone</div>
          <div className="v">
            <Num n={q.merges.undone} />
          </div>
          <div className="n">
            of {fmtInt(totalMerges)} merges, {fmtPct(q.merges.undone.value / (totalMerges || 1), 2)}
          </div>
        </div>
      </StatGrid>

      <div className="cols">
        <Card title="Rows in GOD against rows in the app" flush>
          <div className="tablewrap">
            <table>
              <caption className="sr-only">Rows in GOD and in each app, by table</caption>
              <thead>
                <tr>
                  <th scope="col">App</th>
                  <th scope="col">Table</th>
                  <th scope="col" className="num">
                    In GOD
                  </th>
                  <th scope="col" className="num">
                    In the app
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {q.rows.map((r) => {
                  const d = r.inGod.value - r.inApp.value;
                  return (
                    <tr key={`${r.app}-${r.table}`}>
                      <td>{r.app}</td>
                      <td>{r.table}</td>
                      <td className="num">
                        <Num n={r.inGod} />
                      </td>
                      <td className="num">
                        <Num n={r.inApp} />
                      </td>
                      <td>{d === 0 ? <Badge tone="ok">Match</Badge> : <Badge tone="warn">Mismatch {Math.abs(d)}</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="xs muted pad">Small gaps are rows still in flight. Gaps that stay open for 10 minutes raise an alert.</p>
        </Card>
        <div className="stack">
          <Card title="Geocoding precision">
            <p className="small muted">How exactly each home area was placed.</p>
            <StackedBar
              title="Geocoding precision"
              description="Share of home areas placed at address, suburb or postcode level."
              segments={q.geocoding.map((g, i) => ({
                label: g.label,
                value: g.value.value,
                display: g.value.display,
                color: ["var(--ok)", "var(--info)", "var(--warn)"][i] ?? "var(--acc)",
              }))}
            />
            <p className="xs muted">{fmtPct(q.geocoding[0] ? q.geocoding[0].value.value / geoTotal : 0)} are placed at address level.</p>
          </Card>
          <Card title="Identity merges">
            <p className="small muted">Accounts joined into one person, by how they were linked.</p>
            <StackedBar
              title="Identity merges"
              description="Merges by YourTal sign-in and by verified email."
              segments={[
                { label: "By YourTal sign-in", value: q.merges.bySignIn.value, display: q.merges.bySignIn.display, color: "var(--acc)" },
                { label: "By verified email", value: q.merges.byEmail.value, display: q.merges.byEmail.display, color: "var(--info)" },
              ]}
            />
            <div className="row small">
              <span className="pill plain">
                <Num n={q.merges.undone} /> undone
              </span>
              <span className="muted">An undo splits the person back into separate profiles.</span>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Job runs" flush>
        <div className="tablewrap">
          <table>
            <caption className="sr-only">Scheduled jobs and their last result</caption>
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Schedule</th>
                <th scope="col">Last run</th>
                <th scope="col" className="num">
                  Duration
                </th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {q.jobs.map((j) => (
                <tr key={j.name}>
                  <td className="mono">{j.name}</td>
                  <td>{j.schedule}</td>
                  <td>{fmtDateTime(j.lastRun)}</td>
                  <td className="num">{j.duration}</td>
                  <td>
                    <Badge tone={JOB_RESULT[j.result]?.tone ?? "default"}>{JOB_RESULT[j.result]?.text ?? j.result}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Verification runs: teen pipeline" flush>
        <p className="small muted pad">
          Teen profiles are never opened. Teen processing is checked two ways. Synthetic fixtures run every night. A
          monthly sampled run on 20 real teens needs the Owner and a second approver, and its output is destroyed 7
          days after it runs.
        </p>
        <div className="row small pad">
          <Badge tone="ok">{passed} passed</Badge>
          <Badge tone="warn">{rerun} passed on rerun</Badge>
          <Badge tone="crit" plain>
            {failed} failed
          </Badge>
        </div>
        <div className="tablewrap">
          <table>
            <caption className="sr-only">Teen verification runs, with approvers and destroy dates</caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Check</th>
                <th scope="col">Run</th>
                <th scope="col">Result</th>
                <th scope="col">Approved by</th>
                <th scope="col">Output destroyed</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((v) => (
                <tr key={v.id}>
                  <td>{v.kind === "synthetic" ? "Synthetic fixture" : "Sampled run"}</td>
                  <td>{v.check}</td>
                  <td>{fmtDateTime(v.ran)}</td>
                  <td>
                    <Badge tone={RESULT[v.result]?.tone ?? "default"}>{RESULT[v.result]?.text ?? v.result}</Badge>
                  </td>
                  <td>
                    {v.kind === "synthetic" ? (
                      <span className="muted">Automatic</span>
                    ) : v.approvers.length ? (
                      <ul className="plainlist">
                        {v.approvers.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">Waiting for two approvers</span>
                    )}
                  </td>
                  <td>
                    {v.destroyOn ? (
                      v.destroyed ? (
                        <Badge tone="ok" plain>
                          Destroyed {fmtDate(v.destroyOn)}
                        </Badge>
                      ) : (
                        <span>Due {fmtDate(v.destroyOn)}</span>
                      )
                    ) : (
                      <span className="muted">No real data</span>
                    )}
                  </td>
                  <td className="small muted">{v.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
