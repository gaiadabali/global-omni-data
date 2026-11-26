import type { Metadata } from "next";
import Link from "next/link";
import { BarChart, LineChart, StackedBar } from "@/components/charts";
import { Badge, Card, PageHeader, Segmented, StatGrid, StatTile } from "@/components/ui";
import { deltaText, fmtPct } from "@/lib/format";
import { PAGES, isPageId } from "@/lib/pages";
import { parsePeriod, periodNoun, periodOptions } from "@/lib/period";
import { canAccessPage, requirePage } from "@/server/access";
import { getDashboardData } from "@/server/data";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.home.title };

const last12 = (a: number[]) => a.slice(-12);

/** "+4.2% vs last month", coloured by direction. */
function deltaNote(d: { text: string; up: boolean } | null, suffix: string) {
  return d ? (
    <>
      <span className={d.up ? "d-up" : "d-dn"}>{d.text}</span> <span>{suffix}</span>
    </>
  ) : null;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const viewer = requirePage(await getViewer(), "home");
  const period = parsePeriod((await searchParams).period);
  const o = await getDashboardData(viewer).overview({ period });
  const noun = periodNoun(period);

  const vsMonth = deltaText(o.people.value, o.peoplePrevMonth.value);
  const bizVsMonth = deltaText(o.businesses.value, o.businessesPrevMonth.value);
  const newDelta = deltaText(o.newInPeriod.value, o.newInPrevPeriod.value);
  const mix = o.profileMix;
  const mixTotal = mix.one.value + mix.two.value + mix.three.value || 1;

  return (
    <div className="page-body">
      <PageHeader
        title={PAGES.home.title}
        sub={PAGES.home.sub}
        actions={<Segmented label="Period" value={period} options={periodOptions("/")} />}
      />

      <StatGrid>
        <StatTile
          className="b-god"
          label="People across GOD"
          value={o.people}
          note={deltaNote(vsMonth, "vs last month")}
          spark={last12(o.peopleSeries)}
          sparkColor="var(--god)"
        />
        <StatTile
          className="b-god"
          label="Businesses"
          value={o.businesses}
          note={deltaNote(bizVsMonth, "vs last month")}
          spark={last12(o.businessesSeries)}
          sparkColor="var(--god)"
        />
        <StatTile
          label="Complete profiles"
          value={o.completeProfiles}
          note={`${fmtPct(o.completeShare, 1)} finished in 2 or 3 apps`}
        />
        <StatTile
          label={`New this ${noun}`}
          value={o.newInPeriod}
          note={
            period === "ytd" ? (
              "since 1 Jan"
            ) : (
              deltaNote(newDelta, `on the ${noun} before`)
            )
          }
          spark={o.newByMonth.slice(-12)}
          sparkColor="var(--god)"
        />
        <StatTile
          label={`Active this ${noun}`}
          value={o.activeInPeriod}
          note={`${fmtPct(o.activeShare)} of people opened an app`}
        />
        <StatTile
          label="Data freshness"
          value={o.freshness.syncedAgo}
          note={
            <Badge tone="ok">All {o.freshness.sources.length} sources</Badge>
          }
        />
      </StatGrid>

      <div className="cols basis-520">
        <Card title="Growth by brand">
          <p className="small muted">
            People and businesses registered, running total.
            {period === "week" ? " Weekly points are interpolated from monthly counts." : ""}
          </p>
          <LineChart
            title="Growth by brand and total"
            description="People and businesses registered, running total, for GOD as a whole and for each brand."
            labels={o.growth.labels}
            fullLabels={o.growth.full}
            height={270}
            series={o.growth.series.map((s) => ({
              id: s.id,
              name: s.name,
              values: s.values,
              color: s.id === "god" ? "var(--god)" : `var(--${s.id === "yourtal" ? "yt" : s.id === "snapapp" ? "sa" : "ftr"})`,
              width: s.id === "god" ? 3 : 2,
            }))}
          />
        </Card>

        <div className="stack basis-340">
          <Card title="Profile completeness">
            <p className="small muted">
              How many of the three apps each person has finished a profile in. This counts completed profiles, not
              shared audiences.
            </p>
            <div className="row">
              {[
                ["1 app", mix.one.value],
                ["2 apps", mix.two.value],
                ["all 3 apps", mix.three.value],
              ].map(([label, v]) => (
                <div key={label as string} className="pr-4">
                  <div className="big">{fmtPct((v as number) / mixTotal, 1)}</div>
                  <div className="xs muted">{label}</div>
                </div>
              ))}
            </div>
            <StackedBar
              title="Profile completeness"
              description="Share of people with a finished profile in 1, 2 or 3 apps."
              segments={[
                { label: "1 app", value: mix.one.value, color: "var(--line)", display: mix.one.display },
                { label: "2 apps", value: mix.two.value, color: "var(--acc)", display: mix.two.display },
                { label: "All 3 apps", value: mix.three.value, color: "var(--god)", display: mix.three.display },
              ]}
            />
            <div className="xs muted pt-1">Profiles completed in each pair</div>
            <BarChart
              title="Profiles completed in each pair of apps"
              orientation="horizontal"
              labels={mix.pairs.map((p) => p.label)}
              series={[{ id: "pairs", name: "Profiles", color: "var(--acc)", values: mix.pairs.map((p) => p.value.value) }]}
              valueLabels={mix.pairs.map((p) => p.value.display)}
            />
          </Card>

          <Card title="What changed">
            <div className="list">
              {o.changes.map((c) => {
                const target = isPageId(c.pageId) ? PAGES[c.pageId] : null;
                const allowed = target ? canAccessPage(viewer, target.id) : false;
                return (
                  <div className="li" key={c.title}>
                    <span className={`sev ${c.severity}`} aria-hidden="true" />
                    <div className="grow">
                      <div>{c.title}</div>
                      <div className="small muted">{c.detail}</div>
                    </div>
                    {target && allowed ? (
                      <Link className="btn sm" href={target.path}>
                        Open
                      </Link>
                    ) : (
                      <span className="btn sm" aria-disabled="true" title="Your role cannot open this page">
                        Open
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
