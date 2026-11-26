"use client";

import { MixBars, type MixRow } from "@/components/charts/MixBars";
import { Num, SmallNumberMarker } from "@/components/ui";
import { monthLong } from "@/lib/format";
import type { PresentedActivityArea } from "@/server/data";
import { IconClose } from "./pd-ui";
import { shareText, type CountLike } from "./pd-lib";

function marker(n: CountLike) {
  return n.suppressed && !n.display.startsWith("<") ? <SmallNumberMarker /> : null;
}

/** The right panel of the activity map for one activity area, from /api/map/activity-area. */
export function ActivityDetail({
  body,
  loading,
  error,
  month,
  ageBand,
  teen,
  seesExact,
  categoryName,
  onClose,
  onMerchant,
}: {
  body: PresentedActivityArea | null;
  loading: boolean;
  error: string | null;
  month: string;
  /** The age band chosen, or "all". */
  ageBand: string;
  teen: boolean;
  seesExact: boolean;
  categoryName: ReadonlyMap<string, string>;
  onClose: () => void;
  /** Fly to a merchant and open it. */
  onMerchant: (m: { id: string; lon: number; lat: number }) => void;
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

  const catTop = Math.max(0, ...body.categoryMix.map((m) => m.share ?? 0));
  const catRows: MixRow[] = body.categoryMix.map((m) => ({
    key: m.category,
    label: m.name,
    note: m.sensitive ? "sensitive" : undefined,
    display: m.share !== null ? (shareText(m.share) ?? "") : m.people.display,
    frac: m.share !== null && catTop > 0 ? m.share / catTop : null,
    color: `var(--c-${m.category})`,
    marker: marker(m.people),
  }));
  const ageTop = Math.max(0, ...body.ageMix.map((m) => m.share ?? 0));
  const ageRows: MixRow[] = body.ageMix.map((m) => ({
    key: m.band,
    label: m.band,
    note: m.teen ? "teens" : undefined,
    display: m.share !== null ? (shareText(m.share) ?? "") : m.people.display,
    frac: m.share !== null && ageTop > 0 ? m.share / ageTop : null,
    marker: marker(m.people),
  }));
  const threshold = teen ? "20" : "10";

  return (
    <div className="pd-detail" aria-live="polite" aria-busy={loading}>
      <header className="pd-dhead">
        <div>
          <p className="pd-kicker">Activity area</p>
          <h2 className="pd-dname">{body.area.name}</h2>
          <p className="pd-crumbs">
            <span>{body.area.parent}</span>
          </p>
        </div>
        <button type="button" className="pd-x" aria-label="Close the detail" onClick={onClose}>
          <IconClose />
        </button>
      </header>

      <div className="pd-figure">
        <div className="pd-bignum">
          <Num n={body.total} />
        </div>
        <p className="pd-unit">
          people active here in {monthLong(month)}
          {ageBand !== "all" ? `, ages ${ageBand}` : ""}
        </p>
      </div>

      <section className="pd-sec" aria-labelledby="pd-a-cat">
        <h3 id="pd-a-cat">Where they spend</h3>
        {catRows.length ? (
          <MixBars rows={catRows} label="Share of people active, by category" />
        ) : (
          <p className="small muted">Every category here is under the reporting threshold.</p>
        )}
      </section>

      {ageRows.length ? (
        <section className="pd-sec" aria-labelledby="pd-a-age">
          <h3 id="pd-a-age">Who they are</h3>
          <MixBars rows={ageRows} label="Share of people active, by age band" />
        </section>
      ) : null}

      <section className="pd-sec" aria-labelledby="pd-a-top">
        <h3 id="pd-a-top">Top merchants</h3>
        {body.merchants.length ? (
          <ol className="pd-merch">
            {body.merchants.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => onMerchant(m)}>
                  <i className={`pd-dotc gm-cat-${m.category}`} aria-hidden="true" />
                  <span className="pd-merch-n">
                    <b>{m.name}</b>
                    <span>{categoryName.get(m.category) ?? m.category}</span>
                  </span>
                  <span className="pd-merch-v">{m.display}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">No merchant here has enough receipts to list.</p>
        )}
        <p className="xs muted">Receipts scanned in the month. A dot is a shop&apos;s address, never a person.</p>
      </section>

      <p className="note">
        {seesExact
          ? "Small groups are marked as small numbers. Your role sees them in full. Do not share or export them."
          : `Groups under ${threshold} show as "<${threshold}".`}
        {teen ? " Teen figures cover 20 or more teens. Sensitive categories are not offered for ages 13–17." : ""}{" "}
        An area counts people. It never shows where one person is.
      </p>
    </div>
  );
}
