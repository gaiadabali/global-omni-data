"use client";

import { Fragment } from "react";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { MixBars, type MixRow } from "@/components/charts/MixBars";
import { Num, SmallNumberMarker } from "@/components/ui";
import { fmtInt, monthLong } from "@/lib/format";
import type { PresentedArea } from "@/server/data";
import { IconClose } from "./pd-ui";
import { ordinal, shareText, signedPct, versusText, visibleCount, type CountLike } from "./pd-lib";
import { HEX_WIDTH_KM, kmLabel } from "./zoom";

const LEVEL_KICKER: Record<string, string> = {
  state: "State or territory",
  sa4: "SA4 region",
  sa3: "SA3 area",
  sa2: "SA2 area",
};

const BRAND_COLOUR: Record<string, string> = {
  yourtal: "var(--yt)",
  snapapp: "var(--sa)",
  ftr: "var(--ftr)",
};

function marker(n: CountLike) {
  return n.suppressed && !n.display.startsWith("<") ? <SmallNumberMarker /> : null;
}

/** The right panel of the influence map: one area, from /api/map/area. */
export function InfluenceDetail({
  body,
  loading,
  error,
  month,
  seesExact,
  onClose,
  onZoom,
  onJump,
}: {
  /** The answer for the selected area and the month on screen, or null while it loads. */
  body: PresentedArea | null;
  loading: boolean;
  error: string | null;
  month: string;
  seesExact: boolean;
  onClose: () => void;
  onZoom: () => void;
  /** Open a parent area from the breadcrumb. */
  onJump: (id: string) => void;
}) {
  if (error) {
    return (
      <div className="pd-pad">
        <p className="small muted">{error}</p>
        <button type="button" className="pd-btn" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  if (!body) {
    return (
      <div className="pd-pad" aria-busy={loading}>
        <p className="small muted">Loading the area</p>
      </div>
    );
  }

  const a = body.area;
  const s = body.selection;
  const audience = body.query.audience;
  const unit = s.unit === "people and businesses" ? "people and businesses" : s.unit;
  const kicker =
    a.level === "h3"
      ? `Area about ${kmLabel(HEX_WIDTH_KM[a.res ?? 7] ?? 2.1)} across`
      : (LEVEL_KICKER[a.level] ?? "Area");
  const crumbs = [...a.parents].reverse();

  /* per 1,000 against the nation: two bars on one scale */
  const rateTop = s.per1000 === null ? 0 : Math.max(s.per1000, s.nationalPer1000);
  const rateRows: MixRow[] =
    s.per1000 === null
      ? []
      : [
          { key: "area", label: "This area", display: s.per1000.toFixed(1), frac: rateTop > 0 ? s.per1000 / rateTop : null },
          {
            key: "nation",
            label: "Australia",
            display: s.nationalPer1000.toFixed(1),
            frac: rateTop > 0 ? s.nationalPer1000 / rateTop : null,
            color: "var(--faint)",
          },
        ];

  /* by brand: bars by what the viewer may see, text by what the API printed */
  const brandKnown = body.brands.map((b) => {
    const p = audience === "businesses" ? 0 : (visibleCount(b.people) ?? 0);
    const q = audience === "people" ? 0 : (visibleCount(b.businesses) ?? 0);
    return p + q;
  });
  const brandTop = Math.max(0, ...brandKnown);
  const brandRows: MixRow[] = body.brands.map((b, i) => {
    const display =
      audience === "people" ? b.people.display : audience === "businesses" ? b.businesses.display : `${b.people.display} · ${b.businesses.display}`;
    return {
      key: b.brand,
      label: b.name,
      display,
      frac: brandTop > 0 && (brandKnown[i] ?? 0) > 0 ? (brandKnown[i] ?? 0) / brandTop : null,
      color: BRAND_COLOUR[b.brand],
      marker:
        (audience !== "businesses" && marker(b.people)) || (audience !== "people" && marker(b.businesses)) ? (
          <SmallNumberMarker />
        ) : null,
    };
  });

  /* by age: shares of what the viewer can see */
  const ageTop = Math.max(0, ...body.ageMix.map((m) => m.share ?? 0));
  const ageRows: MixRow[] = body.ageMix.map((m) => ({
    key: m.band,
    label: m.band,
    note: m.teen ? "teens" : undefined,
    display: m.share !== null ? (shareText(m.share) ?? "") : m.people.display,
    frac: m.share !== null && ageTop > 0 ? m.share / ageTop : null,
    marker: marker(m.people),
  }));

  const growth = signedPct(s.growthPct);

  return (
    <div className="pd-detail" aria-live="polite" aria-busy={loading}>
      <header className="pd-dhead">
        <div>
          <p className="pd-kicker">{kicker}</p>
          <h2 className="pd-dname">{a.name}</h2>
          <nav className="pd-crumbs" aria-label="Where this area sits">
            {crumbs.map((c, i) => (
              <Fragment key={c.id}>
                {i > 0 ? <span aria-hidden="true">{"›"}</span> : null}
                <button type="button" onClick={() => onJump(c.id)}>
                  {c.name}
                </button>
              </Fragment>
            ))}
            {crumbs.length === 0 ? <span>{a.parent}</span> : null}
          </nav>
        </div>
        <button type="button" className="pd-x" aria-label="Close the detail" onClick={onClose}>
          <IconClose />
        </button>
      </header>

      <div className="pd-figure">
        <div className="pd-bignum">
          <Num n={s.value} />
        </div>
        <p className="pd-unit">
          {unit} to {monthLong(month)}
        </p>
        <p className="pd-newline">
          New this month <b>{s.newThisMonth.display}</b>
          {marker(s.newThisMonth)}
          {growth ? <span className="pd-up"> {growth} on last month&apos;s total</span> : null}
        </p>
      </div>

      <section className="pd-sec" aria-labelledby="pd-s-trend">
        <h3 id="pd-s-trend">Trend, up to 24 months</h3>
        <AreaTrend
          title={`${a.name}: ${unit} each month`}
          seriesName={unit === "people and businesses" ? "People and businesses" : unit === "people" ? "People" : "Businesses"}
          months={body.series.months}
          values={body.series.values}
        />
      </section>

      <section className="pd-sec" aria-labelledby="pd-s-rate">
        <h3 id="pd-s-rate">Per 1,000 residents</h3>
        {rateRows.length ? (
          <>
            <MixBars rows={rateRows} label="This area against Australia, per 1,000 residents" />
            <p className="small muted">{versusText(s.per1000 ?? 0, s.nationalPer1000)}</p>
          </>
        ) : (
          <p className="small muted">Hidden while the count is under the reporting threshold.</p>
        )}
      </section>

      <dl className="pd-facts">
        <div>
          <dt>Rank in {s.rank.within}</dt>
          <dd>{s.rank.rank === null ? "Hidden" : `${ordinal(s.rank.rank)} of ${fmtInt(s.rank.of)}`}</dd>
        </div>
        <div>
          <dt>Residents</dt>
          <dd>{a.population > 0 ? fmtInt(a.population) : "None counted"}</dd>
        </div>
        {a.areaKm2 !== null ? (
          <div>
            <dt>Size</dt>
            <dd>{fmtInt(a.areaKm2)} km&sup2;</dd>
          </div>
        ) : null}
      </dl>

      <section className="pd-sec" aria-labelledby="pd-s-brand">
        <h3 id="pd-s-brand">By brand</h3>
        {audience === "both" ? <p className="xs muted">People {"·"} businesses</p> : null}
        <MixBars rows={brandRows} label="Registered by brand" />
        {body.god ? (
          <p className="small muted pd-god">
            All of GOD, each person counted once:{" "}
            <b>
              {audience === "businesses"
                ? `${body.god.businesses.display} businesses`
                : audience === "people"
                  ? `${body.god.people.display} people`
                  : `${body.god.people.display} people · ${body.god.businesses.display} businesses`}
            </b>
          </p>
        ) : null}
      </section>

      {ageRows.length ? (
        <section className="pd-sec" aria-labelledby="pd-s-age">
          <h3 id="pd-s-age">By age</h3>
          <MixBars rows={ageRows} label="Registered people by age band" />
        </section>
      ) : null}

      <p className="note">
        {seesExact
          ? "Groups under 10 are marked as small numbers. Your role sees them in full. Do not share or export them."
          : 'Groups under 10 show as "<10". Teen groups under 20 show as "<20".'}
      </p>
      <div className="pd-actions">
        <button type="button" className="pd-btn" onClick={onZoom}>
          Zoom to this area
        </button>
      </div>
    </div>
  );
}
