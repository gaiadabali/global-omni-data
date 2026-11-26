import type { Metadata } from "next";
import Link from "next/link";
import "@/components/pages/pages.css";
import { OpenProfileButton } from "@/components/person/OpenProfileButton";
import { ProfileView } from "@/components/person/ProfileView";
import { Badge, Callout, Card, EmptyState, PageHeader } from "@/components/ui";
import { classifyPersonQuery } from "@/lib/person-query";
import { first } from "@/lib/params";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getDashboardData } from "@/server/data";
import { BRAND_LABELS } from "@/server/types";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.person.title };

const PAGE_SIZE = 20;

type Props = { searchParams: Promise<{ q?: string | string[]; id?: string | string[]; all?: string | string[] }> };

/** Person 360: Owner and Data team only. Search by GOD id, open an adult profile after giving a reason. */
export default async function PersonPage({ searchParams }: Props) {
  const viewer = requirePage(await getViewer(), "person");
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").slice(0, 40);
  const id = (first(sp.id) ?? "").trim().toUpperCase().slice(0, 20);
  const showAll = first(sp.all) === "1";
  const kind = classifyPersonQuery(q);
  const data = getDashboardData(viewer);

  const hits = kind === "not-an-id" || id ? [] : await data.personSearch(q);
  const shown = showAll ? hits : hits.slice(0, PAGE_SIZE);
  const outcome = id ? await data.personGet(id) : null;
  const accessedBy = outcome?.kind === "profile" ? await data.personAccessedBy(outcome.profile.id) : [];

  return (
    <div className="page-body">
      <PageHeader
        title={PAGES.person.title}
        sub={PAGES.person.sub}
        actions={
          <Badge tone="acc" plain>
            Every open is logged
          </Badge>
        }
      />

      <Card title="Find a profile">
        <form method="get" action="/person" className="row search-row">
          <div className="field grow-field">
            <label htmlFor="pSearch">GOD id</label>
            <input
              id="pSearch"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="G-7F3K-29QD"
              autoComplete="off"
              spellCheck={false}
              className="mono"
            />
          </div>
          <button type="submit" className="btn primary">
            Search
          </button>
        </form>

        {viewer.breakGlass ? (
          <Callout tone="warn">
            Emergency access: profiles can&apos;t be opened. The list shows ids only.
          </Callout>
        ) : null}
        {outcome ? (
          <p className="small">
            <Link href={q ? `/person?q=${encodeURIComponent(q)}` : "/person"}>Back to the list of profiles</Link>
          </p>
        ) : kind === "not-an-id" ? (
          <Callout tone="warn" role="alert">
            Search by GOD id only. Names, emails and phone numbers are not stored or searchable here.
          </Callout>
        ) : shown.length === 0 ? (
          <EmptyState title="No profile with that id">Check the id and try again.</EmptyState>
        ) : (
          <>
            <p className="small muted">
              {kind === "empty"
                ? `${hits.length} synthetic profiles. Pick one, or type a GOD id like G-7F3K to narrow the list.`
                : `${hits.length} ${hits.length === 1 ? "profile matches" : "profiles match"}.`}
            </p>
            <div className="list">
              {shown.map((p) => (
                <div className="li person-li" key={p.id}>
                  <div className="grow">
                    <span className="mono">{p.id}</span>
                    <div className="small muted">
                      {p.teen ? "13–17" : p.ageBand}
                      {" · "}
                      {p.teen ? (
                        <Badge tone="warn" plain>
                          Teen account
                        </Badge>
                      ) : (
                        p.brands.map((b) => BRAND_LABELS[b]).join(", ")
                      )}
                    </div>
                  </div>
                  {viewer.breakGlass ? null : p.teen ? (
                    <Link className="btn sm" href={`/person?id=${p.id}`} prefetch={false}>
                      Open
                    </Link>
                  ) : (
                    <OpenProfileButton id={p.id} />
                  )}
                </div>
              ))}
            </div>
            {!showAll && hits.length > shown.length ? (
              <p className="small">
                Showing {shown.length} of {hits.length}.{" "}
                <Link href={`/person?${q ? `q=${encodeURIComponent(q)}&` : ""}all=1`}>Show all {hits.length}</Link>
              </p>
            ) : null}
          </>
        )}
      </Card>

      {outcome?.kind === "profile" ? <ProfileView p={outcome.profile} accessedBy={accessedBy} /> : null}

      {outcome?.kind === "needs-reason" ? (
        <Card title="Reason needed">
          <EmptyState
            title="Opening a profile needs a recorded reason"
            action={<OpenProfileButton id={outcome.id} label="Give a reason" autoOpen primary />}
          >
            The reason, your name and the time go into the audit log before the profile opens.
          </EmptyState>
        </Card>
      ) : null}

      {outcome?.kind === "teen-refused" ? (
        <Card>
          <EmptyState
            title="Teen profiles can't be opened"
            action={
              <Link className="btn primary" href="/quality">
                Open Data quality
              </Link>
            }
          >
            Teen data is checked through the verification runs on the Data quality page. This attempt has been logged.
          </EmptyState>
        </Card>
      ) : null}

      {outcome?.kind === "emergency-refused" ? (
        <Card title="Not available in emergency access">
          <EmptyState title="Profiles can't be opened in an emergency session">
            Person 360 needs a normal sign-in with YourTal. This attempt has been logged.
          </EmptyState>
        </Card>
      ) : null}

      {outcome?.kind === "not-found" ? (
        <Card title="Profile not found">
          <EmptyState title="No profile with that id">Check the id and try again.</EmptyState>
        </Card>
      ) : null}
    </div>
  );
}
