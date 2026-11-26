import type { Metadata } from "next";
import Link from "next/link";
import "@/components/pages/pages.css";
import { BreakGlassEnrol } from "@/components/admin/BreakGlassEnrol";
import { BreakGlassRevokeButton } from "@/components/admin/BreakGlassRevokeButton";
import { EntryActions } from "@/components/admin/EntryActions";
import { InviteForm } from "@/components/admin/InviteForm";
import { RevokeButton } from "@/components/admin/RevokeButton";
import { SignOutEverywhereButton } from "@/components/admin/SignOutEverywhereButton";
import { Badge, Callout, Card, PageHeader, Tabs, type BadgeTone } from "@/components/ui";
import { TODAY, fmtDate, fmtDateTime, isIsoDate } from "@/lib/dates";
import { first } from "@/lib/params";
import { PAGES } from "@/lib/pages";
import { requirePage } from "@/server/access";
import { getSessionState } from "@/server/auth/current";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  isAuditAction,
  type AuditAction,
} from "@/server/audit/types";
import { readBreakGlassConfig } from "@/server/breakglass/config";
import { getDashboardData } from "@/server/data";
import { ORIGINAL_HOLDERS } from "@/server/data/allowlist";
import { BRAND_LABELS, ROLE_LABELS } from "@/server/types";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: PAGES.admin.title };

type Props = {
  searchParams: Promise<{
    tab?: string | string[];
    who?: string | string[];
    action?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
};

const STATUS: Record<string, { tone: BadgeTone; text: string }> = {
  active: { tone: "ok", text: "Active" },
  invited: { tone: "info", text: "Invited, not signed in yet" },
  suspended: { tone: "warn", text: "Suspended" },
  removed: { tone: "default", text: "Removed" },
};

const ACTION_TONE: Record<AuditAction, BadgeTone> = {
  "person.open": "warn",
  "export.pdf": "info",
  "allowlist.invite": "acc",
  "allowlist.change": "acc",
  "session.revoke": "default",
  "signin.refused": "crit",
  "signin.ok": "ok",
  "signin.fresh": "info",
  signout: "default",
  "breakglass.code": "acc",
  "breakglass.enrol": "acc",
  "breakglass.revoke": "acc",
  "breakglass.signin": "crit",
  "breakglass.refused": "crit",
};

const TABS = ["allow", "audit", "sessions", "emergency"];

/**
 * Admin: Owner only. The allow-list, the audit log, active sessions and emergency access. An emergency
 * (break-glass) session sees all of it, but the buttons it may not use are not shown, and their handlers refuse.
 */
export default async function AdminPage({ searchParams }: Props) {
  const viewer = requirePage(await getViewer(), "admin");
  const sp = await searchParams;
  const tab = TABS.includes(first(sp.tab) ?? "")
    ? (first(sp.tab) as string)
    : "allow";

  const who = (first(sp.who) ?? "").slice(0, 60);
  const actionText = first(sp.action) ?? "";
  const action: AuditAction | undefined = isAuditAction(actionText) ? actionText : undefined;
  const from = isIsoDate(first(sp.from) ?? "") ? first(sp.from) : undefined;
  const to = isIsoDate(first(sp.to) ?? "") ? first(sp.to) : undefined;

  const data = getDashboardData(viewer);
  const session = await getSessionState();
  const emergency = viewer.breakGlass === true;
  const [allow, sessions, audit, keys] = await Promise.all([
    data.adminAllowList(),
    data.adminSessions(session.kind === "ok" ? session.session.id : null),
    data.adminAudit({
      ...(who ? { who } : {}),
      ...(action ? { action } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    data.adminBreakGlass(),
  ]);
  const filtered = Boolean(who || action || from || to);

  const allowPanel = (
    <>
      <Card title="People who can sign in" flush>
        <div className="tablewrap">
          <table>
            <caption className="sr-only">The allow-list</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Brand</th>
                <th scope="col">Paper agreement signed</th>
                <th scope="col">Original held by</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {allow.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    <div className="mono faint xs">{p.email}</div>
                  </td>
                  <td>{ROLE_LABELS[p.role]}</td>
                  <td>{p.brand ? BRAND_LABELS[p.brand] : <span className="muted">None</span>}</td>
                  <td>{fmtDate(p.agreementSigned)}</td>
                  <td>{p.originalHeldBy}</td>
                  <td>
                    <Badge tone={STATUS[p.status]?.tone ?? "default"}>
                      {STATUS[p.status]?.text ?? p.status}
                    </Badge>
                  </td>
                  <td>
                    {p.lastSignIn ? (
                      fmtDateTime(p.lastSignIn)
                    ) : (
                      <span className="muted">Never</span>
                    )}
                  </td>
                  <td>
                    {emergency || p.id === viewer.id || p.status === "removed" ? null : (
                      <EntryActions id={p.id} name={p.name} status={p.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Invite someone">
        {emergency ? (
          <Callout tone="warn">
            Not available in emergency access. Invites and allow-list changes need a normal sign-in with YourTal.
          </Callout>
        ) : (
          <InviteForm holders={ORIGINAL_HOLDERS} today={TODAY} />
        )}
      </Card>
    </>
  );

  const auditPanel = (
    <Card title="Audit log">
      <form method="get" action="/admin" className="grid filter-grid">
        <input type="hidden" name="tab" value="audit" />
        <div className="field">
          <label htmlFor="af-who">Who</label>
          <select id="af-who" name="who" defaultValue={who}>
            <option value="">Everyone</option>
            {audit.whoOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="af-action">Action</label>
          <select id="af-action" name="action" defaultValue={action ?? ""}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="af-from">From</label>
          <input id="af-from" type="date" name="from" defaultValue={from ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="af-to">To</label>
          <input id="af-to" type="date" name="to" defaultValue={to ?? ""} />
        </div>
        <div className="field end">
          <div className="row">
            <button type="submit" className="btn primary">
              Filter
            </button>
            {filtered ? (
              <Link className="btn" href="/admin?tab=audit">
                Clear
              </Link>
            ) : null}
          </div>
        </div>
      </form>
      <p className="xs muted">
        Append-only, newest first. Nothing here can be edited or deleted. {audit.rows.length}{" "}
        {audit.rows.length === 1 ? "event" : "events"}
        {filtered ? " match the filter" : ""}.
      </p>
      <div className="tablewrap">
        <table>
          <caption className="sr-only">Audit log, newest first</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Event</th>
              <th scope="col">Who</th>
              <th scope="col">Target</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {audit.rows.length ? (
              audit.rows.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDateTime(e.when)}</td>
                  <td>
                    <Badge
                      tone={
                        e.outcome === "refused" && e.action !== "signin.refused"
                          ? "crit"
                          : ACTION_TONE[e.action]
                      }
                    >
                      {e.actionLabel}
                    </Badge>
                  </td>
                  <td>{e.whoName}</td>
                  <td className="mono small">{e.target}</td>
                  <td className="small">{e.reason || <span className="muted">None given</span>}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing logged for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const sessionsPanel = (
    <Card title="Active sessions" flush>
      <div className="tablewrap">
        <table>
          <caption className="sr-only">Active sessions</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Device</th>
              <th scope="col">Near</th>
              <th scope="col">Started</th>
              <th scope="col">Last active</th>
              <th scope="col">Passkey</th>
              <th scope="col" className="num">
                <span className="sr-only">Revoke</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <b>{s.person}</b>{" "}
                  {s.emergency ? (
                    <Badge tone="crit" plain>
                      Emergency
                    </Badge>
                  ) : null}{" "}
                  {s.current ? (
                    <Badge tone="acc" plain>
                      This session
                    </Badge>
                  ) : null}
                </td>
                <td>{s.device}</td>
                <td>{s.near}</td>
                <td>{fmtDateTime(s.started)}</td>
                <td>{fmtDateTime(s.lastActive)}</td>
                <td>{s.passkey ? <Badge tone="ok">Yes</Badge> : <Badge tone="warn">No</Badge>}</td>
                <td className="num">
                  {s.current ? null : (
                    <div className="row justify-end">
                      <RevokeButton sessionId={s.id} person={s.person} />
                      {s.personId === viewer.id ? null : (
                        <SignOutEverywhereButton personId={s.personId} person={s.person} />
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="xs muted pad">
        Sessions end after 30 minutes without activity, and after 8 hours in any case (an emergency
        session after 1 hour). Revoke ends
        one session at once; Sign out everywhere ends all of that person&apos;s sessions. Suspending
        or removing someone ends theirs too.
      </p>
    </Card>
  );

  const activeKeys = keys.filter((k) => k.revoked === null);
  const mine = activeKeys.find((k) => k.ownerId === viewer.id);
  const enrolOn = readBreakGlassConfig() !== null;
  const emergencyPanel = (
    <>
      <Card title="Emergency Owner key" flush>
        <p className="small pad">
          One sealed key that signs an Owner in when YourTal is down, at{" "}
          <span className="mono">/auth/emergency</span>. It is registered with this dashboard, not with YourTal. An
          emergency session lasts 1 hour. It can read every page and end sessions. It cannot export, open a profile,
          change who can sign in, or add or revoke emergency keys. Every emergency sign-in is recorded and raises an
          alert.
        </p>
        <div className="tablewrap">
          <table>
            <caption className="sr-only">Emergency keys</caption>
            <thead>
              <tr>
                <th scope="col">Owner</th>
                <th scope="col">Key</th>
                <th scope="col">Added</th>
                <th scope="col">Last used</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  <span className="sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.length ? (
                keys.map((k) => (
                  <tr key={k.credentialId}>
                    <td>
                      <b>{k.owner}</b>
                    </td>
                    <td className="mono small">{k.label}</td>
                    <td>{fmtDateTime(k.added)}</td>
                    <td>{k.lastUsed ? fmtDateTime(k.lastUsed) : <span className="muted">Never</span>}</td>
                    <td>
                      {k.revoked ? (
                        <Badge tone="default">Revoked {fmtDateTime(k.revoked)}</Badge>
                      ) : (
                        <Badge tone="ok">Active</Badge>
                      )}
                    </td>
                    <td className="num">
                      {k.revoked || emergency ? null : (
                        <BreakGlassRevokeButton credentialId={k.credentialId} label={k.label} owner={k.owner} />
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="muted">
                    No emergency key yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Add an emergency key">
        {emergency ? (
          <Callout tone="warn">
            Not available in emergency access. Emergency keys are added and revoked in a normal sign-in with YourTal.
          </Callout>
        ) : mine ? (
          <p className="small">You have an emergency key. To replace it, revoke it first, then ask for a new code.</p>
        ) : activeKeys.length >= 2 ? (
          <p className="small">Two emergency keys are active, the most there can be. Revoke one first.</p>
        ) : (
          <div className="stack">
            <ol className="small bg-steps">
              <li>Ask the lead for an enrolment code. They make it on the server. It works once, for 15 minutes.</li>
              <li>Plug in the hardware security key, or have the device that will hold the passkey ready.</li>
              <li>
                Enter the code and press Add emergency key. If you have not used your passkey in the last 5 minutes,
                YourTal asks for it first.
              </li>
              <li>Test it once at /auth/emergency, then seal it with the paper agreements in the company archive.</li>
            </ol>
            {enrolOn ? null : (
              <Callout>Emergency keys can only be added on the live dashboard. Dev sign-in is on here.</Callout>
            )}
            <BreakGlassEnrol disabled={!enrolOn} />
          </div>
        )}
      </Card>
    </>
  );

  return (
    <div className="page-body">
      <PageHeader
        title={PAGES.admin.title}
        sub={PAGES.admin.sub}
        actions={
          <Badge tone="crit" plain>
            Owner only
          </Badge>
        }
      />
      <Tabs
        initial={tab}
        tabs={[
          { id: "allow", label: "Allow-list", panel: allowPanel },
          { id: "audit", label: "Audit log", panel: auditPanel },
          { id: "sessions", label: "Sessions", panel: sessionsPanel },
          { id: "emergency", label: "Emergency access", panel: emergencyPanel },
        ]}
      />
    </div>
  );
}
