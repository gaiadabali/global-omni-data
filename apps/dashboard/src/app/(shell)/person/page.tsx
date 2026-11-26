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

  const hits = kind === "not-an-id" ? [] : await data.personSearch(q);
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

        {kind === "not-an-id" ? (
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
            <div className="tablewrap">
              <table>
                <caption className="sr-only">Profiles</caption>
                <thead>
                  <tr>
                    <th scope="col">GOD id</th>
                    <th scope="col">Age band</th>
                    <th scope="col">Apps</th>
                    <th scope="col" className="num">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.id}</td>
                      <td>{p.teen ? "13–17" : p.ageBand}</td>
                      <td>
                        {p.teen ? (
                          <Badge tone="warn" plain>
                            Teen account
                          </Badge>
                        ) : (
                          p.brands.map((b) => BRAND_LABELS[b]).join(", ")
                        )}
                      </td>
                      <td className="num">
                        {p.teen ? (
                          <Link className="btn sm" href={`/person?id=${p.id}`} prefetch={false}>
                            Open
                          </Link>
                        ) : (
                          <OpenProfileButton id={p.id} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {outcome?.kind === "not-found" ? (
        <Card title="Profile not found">
          <EmptyState title="No profile with that id">Check the id and try again.</EmptyState>
        </Card>
      ) : null}
    </div>
  );
}
