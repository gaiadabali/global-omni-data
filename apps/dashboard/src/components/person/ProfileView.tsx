import { Badge, Card, Table } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { monthLong } from "@/lib/format";
import type { AccessEntry, PersonProfileRaw } from "@/server/data";
import { BRAND_LABELS } from "@/server/types";
import { AreaMap } from "./AreaMap";

const CATEGORY_NAME: Record<string, string> = {
  fuel: "Fuel",
  groc: "Groceries",
  cafe: "Cafés and takeaway",
  retail: "Retail",
  ent: "Entertainment",
};

/** Receipt places grouped by merchant, with the suburbs under each. */
function groupByMerchant(places: PersonProfileRaw["places"]) {
  const map = new Map<string, { category: string; total: number; rows: PersonProfileRaw["places"] }>();
  for (const p of places) {
    const g = map.get(p.merchant) ?? { category: p.category, total: 0, rows: [] };
    g.total += p.receipts;
    g.rows = [...g.rows, p];
    map.set(p.merchant, g);
  }
  return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
}

/**
 * An opened adult profile (Owner and Data team only, after a recorded reason). Pseudonymous: a GOD id and bands,
 * no name, email, phone or address. The receipt figures are this one person's own history, not aggregates.
 */
export function ProfileView({ p, accessedBy }: { p: PersonProfileRaw; accessedBy: AccessEntry[] }) {
  const groups = groupByMerchant(p.places);
  return (
    <div className="stack">
      <div className="row between">
        <div>
          <div className="eyebrow">Pseudonymous profile</div>
          <h2 className="mono id-title">{p.id}</h2>
        </div>
        <Badge tone="acc" plain>
          Opened with a recorded reason
        </Badge>
      </div>

      <div className="cols">
        <Card title="Linked accounts">
          <div className="list">
            {p.accounts.map((a) => (
              <div className="li" key={a.brand}>
                <div className="grow">
                  <b>{BRAND_LABELS[a.brand]}</b>
                  <div className="small muted">
                    since {monthLong(a.since)} · profile {a.complete ? "finished" : "not finished"}
                  </div>
                </div>
                {a.linkedBy ? (
                  <Badge tone={a.linkedBy === "YourTal sign-in" ? "acc" : "info"} plain>
                    Linked by {a.linkedBy === "YourTal sign-in" ? a.linkedBy : a.linkedBy.toLowerCase()}
                  </Badge>
                ) : (
                  <Badge plain>First account</Badge>
                )}
              </div>
            ))}
          </div>
          <p className="xs muted">
            Merge confidence: {p.mergeConfidence}. Last seen {monthLong(p.lastSeen)}.
          </p>
        </Card>
        <Card title="About">
          <dl className="dl">
            <dt>Age band</dt>
            <dd>{p.ageBand}</dd>
            <dt>Home area</dt>
            <dd>{p.homeArea}</dd>
            {p.occupation ? (
              <>
                <dt>Occupation</dt>
                <dd>
                  {p.occupation.title} <span className="muted small">({p.occupation.group}, from Free Tax Returns)</span>
                </dd>
                <dt>Income band</dt>
                <dd>
                  {p.occupation.incomeBand} <span className="muted small">(from Free Tax Returns)</span>
                </dd>
              </>
            ) : null}
          </dl>
          <p className="xs muted">No name, email or phone is held in GOD. Identity stays in each brand&apos;s own admin.</p>
        </Card>
      </div>

      <div className="cols">
        <Card title="Receipts and activity areas">
          {p.places.length ? (
            <AreaMap areas={p.areas} dots={p.dots} />
          ) : (
            <p className="small muted">No receipts: this person does not use SnapApp.</p>
          )}
          <p className="xs muted">
            Dots are shop locations. Circles are the 2 or 3 areas where this person&apos;s receipts cluster.
            Pharmacy, health and other sensitive categories are not shown at person level.
          </p>
        </Card>
        <Card title="Receipt locations">
          {groups.length ? (
            <div className="list">
              {groups.map(([merchant, g]) => (
                <div className="li" key={merchant}>
                  <div className="grow">
                    <b>{merchant}</b> <span className="muted small">{CATEGORY_NAME[g.category] ?? g.category}</span>
                    {g.rows.map((r) => (
                      <div className="small" key={`${r.merchant}-${r.suburb}`}>
                        {r.suburb}, {r.state}
                        <span className="muted">
                          {" "}
                          · {r.receipts} {r.receipts === 1 ? "receipt" : "receipts"} · last {fmtDate(r.lastVisit)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <span className="small muted">{g.total} in 90 days</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">Nothing to list.</p>
          )}
        </Card>
      </div>

      <div className="cols">
        <Card title="Timeline">
          {p.timeline.length ? (
            <div className="tl">
              {p.timeline.map((t, i) => (
                <div key={`${t.date}-${i}`}>
                  <div className="mono faint xs">{fmtDate(t.date)}</div>
                  <div>
                    <b>{t.title}</b>
                  </div>
                  <div className="small muted">{t.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">No recent activity.</p>
          )}
        </Card>
        <Card title="Accessed by">
          {accessedBy.length ? (
            <div className="list">
              {accessedBy.map((a, i) => (
                <div className="li" key={`${a.when}-${i}`}>
                  <div className="grow">
                    <b>{a.who}</b>
                    <div className="small muted">{a.reason}</div>
                  </div>
                  <span className="small muted">{fmtDateTime(a.when)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">No one has opened this profile.</p>
          )}
          <p className="xs muted">From the audit log. It cannot be edited.</p>
        </Card>
      </div>

      <Card title="Learned interests" flush>
        <Table
          caption="Interests, their source and confidence"
          rows={p.interests}
          empty="No interests yet."
          columns={[
            { key: "label", header: "Interest" },
            {
              key: "kind",
              header: "Kind",
              render: (i) => (
                <Badge tone={i.kind === "Declared" ? "acc" : "default"} plain>
                  {i.kind}
                </Badge>
              ),
            },
            { key: "source", header: "Source" },
            {
              key: "confidence",
              header: "Confidence",
              align: "right",
              render: (i) => (
                <span className={i.confidence >= 80 ? "d-up" : "muted"}>
                  <b>{i.confidence}%</b>
                </span>
              ),
            },
          ]}
        />
        <p className="xs muted pad">Inferred interests are made for adults only.</p>
      </Card>
    </div>
  );
}
