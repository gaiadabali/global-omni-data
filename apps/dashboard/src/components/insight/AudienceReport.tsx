import { LineChart } from "@/components/charts";
import { Callout, Card, StatGrid, StatTile, Tabs } from "@/components/ui";
import { fmtInt, fmtPct, monthLabels } from "@/lib/format";
import { isHidden, shareText } from "@/lib/pnum";
import type { AudienceReportRaw, Present } from "@/server/data";
import type { PNum } from "@/server/privacy";
import { IndexBar } from "./IndexBar";
import { ShareBars as Bars } from "./ShareBars";

type Report = Present<AudienceReportRaw>;

function AreaList({
  areas,
  whole,
  note,
  title,
  color,
}: {
  areas: Report["homeAreas"];
  whole: PNum;
  note: string;
  title: string;
  color: string;
}) {
  return (
    <>
      <p className="small muted">{note}</p>
      <Bars
        title={title}
        description={`${title}: the share of the audience in each of the top areas. An area with a small group shows the threshold text instead of a number.`}
        rows={areas.map((a) => ({ label: `${a.name} ${a.postcode}`, value: a.people }))}
        whole={whole}
        color={color}
        digits={1}
      />
    </>
  );
}

/**
 * One audience report: size and growth, catchments, who they are, segments with an affinity index, how often and
 * how much they spend, who else they shop at, and which GOD brands they use. Used by Brand insight (adults) and
 * the Teen market page (13 to 17, groups of 20 or more). Every count arrives thresholded for the viewer.
 * `print` lays the catchments out one under the other, since a printed page cannot switch tabs.
 */
export function AudienceReport({ r, print = false }: { r: Report; print?: boolean }) {
  const labels = monthLabels(r.months);
  const growth = r.growth90;
  const whole = r.audience;
  const home = (
    <AreaList
      areas={r.homeAreas}
      whole={whole}
      title="Home catchment"
      note="Where the audience lives. Share of the audience by suburb."
      color="var(--acc)"
    />
  );
  const activity = (
    <AreaList
      areas={r.activityAreas}
      whole={whole}
      title="Activity catchment"
      note="Where the audience spends. Share of receipts by suburb."
      color="var(--heat)"
    />
  );

  return (
    <div className="stack">
      <StatGrid>
        <StatTile
          className="b-god"
          label="Audience"
          value={r.audience}
          note={r.teen ? "teens, groups of 20 or more" : "registered people who shopped here"}
          spark={r.audienceSeries}
          sparkColor="var(--acc)"
        />
        <StatTile
          label="Growth, last 90 days"
          value={<span className={growth >= 0 ? "d-up" : "d-dn"}>{`${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`}</span>}
          note="audience size"
        />
        <StatTile label="Visits per month" value={r.visitsPerMonth.toFixed(1)} note="average, active shoppers" />
        <StatTile label="Share of GOD people" value={fmtPct(r.shareOfGod, 1)} note="of everyone registered" />
      </StatGrid>

      <div className="cols">
        <Card title="Audience growth">
          <LineChart
            title="Audience over 12 months"
            description={`Registered people ${r.teen ? "aged 13 to 17 " : ""}who shopped at ${r.entity.name}, by month, for the last 12 months.`}
            labels={labels.short}
            fullLabels={labels.full}
            height={230}
            series={[{ id: "audience", name: "Audience", color: "var(--acc)", values: r.audienceSeries, width: 2.6 }]}
          />
        </Card>
        {print ? (
          <div className="stack">
            <Card title="Home catchment">{home}</Card>
            <Card title="Activity catchment">{activity}</Card>
          </div>
        ) : (
          <Card title="Catchments">
            <Tabs
              tabs={[
                { id: "home", label: "Home catchment", panel: home },
                { id: "activity", label: "Activity catchment", panel: activity },
              ]}
            />
          </Card>
        )}
      </div>

      <div className="cols">
        <Card title="Age">
          <Bars title="Age" description="Share of the audience in each age band." rows={r.age} whole={whole} />
        </Card>
        {r.occupation.length ? (
          <Card title="Occupation">
            <Bars title="Occupation" description="Share of the audience in each occupation group." rows={r.occupation} whole={whole} />
          </Card>
        ) : null}
        {r.income.length ? (
          <Card title="Income">
            <Bars title="Income" description="Share of the audience in each income band." rows={r.income} whole={whole} />
          </Card>
        ) : null}
      </div>

      <Card title="Segments and affinity" flush>
        <p className="small muted pad">
          The affinity index compares each segment&apos;s share of this audience with its share of the people living
          in the same areas. 100 is average for the area; the black mark on each bar is 100.
        </p>
        <div className="tablewrap">
          <table>
            <caption className="sr-only">Segments, audience share, area share and affinity index</caption>
            <thead>
              <tr>
                <th scope="col">Segment</th>
                <th scope="col" className="num">
                  Audience
                </th>
                <th scope="col" className="num">
                  Area
                </th>
                <th scope="col">Index</th>
                <th scope="col" className="num">
                  <span className="sr-only">Index value</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.segments.map((s) => {
                const hidden = isHidden(s.audience);
                return (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td className="num">{hidden ? s.audience.display : shareText(s.audience, whole)}</td>
                    <td className="num">{hidden ? "–" : fmtPct(s.areaShare, 0)}</td>
                    <td className="ixcell">{hidden ? <span className="muted small">Hidden: group too small</span> : <IndexBar index={s.index} />}</td>
                    <td className="num">{hidden ? "–" : <b>{s.index}</b>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="cols">
        <Card title="Visit frequency">
          <Bars title="Visit frequency" description="Share of the audience by how often they visit." rows={r.frequency} whole={whole} />
        </Card>
        <Card title="Spend per visit">
          <Bars title="Spend per visit" description="Share of the audience by spend per visit." rows={r.spend} whole={whole} />
        </Card>
        <Card title="Also shops at">
          <Bars
            title="Also shops at"
            description="Share of the audience who also scanned a receipt at each other merchant in the last 90 days."
            rows={r.alsoShopsAt}
            whole={whole}
          />
          <p className="xs muted">Share of this audience who also scanned a receipt there in the last 90 days.</p>
        </Card>
        <Card title="GOD brands they use">
          <Bars
            title="GOD brands they use"
            description="Share of the audience who use each GOD brand."
            rows={r.godBrands}
            whole={whole}
            color={r.teen ? "var(--yt)" : "var(--acc)"}
          />
          <p className="xs muted">
            {r.teen ? "Free Tax Returns is for adults and has no teen accounts." : "A person can use more than one."}
          </p>
        </Card>
      </div>

      <Callout>
        <b>ABS Census 2021 context.</b> Across the main catchments, median weekly household income is about A$
        {fmtInt(r.census.medianWeeklyHouseholdIncome)} against A$1,746 nationally, {r.census.householdsWithChildrenPct}% of
        households have children under 15, and {r.census.bornOverseasPct}% of residents were born overseas. Home
        catchment leads: {r.homeAreas[0]?.name ?? "none"}; activity catchment leads: {r.activityAreas[0]?.name ?? "none"}.
      </Callout>
    </div>
  );
}
