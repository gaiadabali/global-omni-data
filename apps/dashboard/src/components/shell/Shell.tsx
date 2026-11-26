import { Fragment, type ReactNode } from "react";
import { navFor, phoneNavFor } from "@/server/access";
import { isDevAuthEnabled } from "@/server/dev-auth";
import { clearDevRole } from "@/server/dev-actions";
import { DEV_ROLE_LABELS } from "@/server/dev-roles";
import { devRoleValueOf } from "@/server/viewer";
import { ROLE_LABELS, BRAND_LABELS, type Viewer } from "@/server/types";
import type { Theme } from "@/lib/theme";
import { Icon } from "@/components/ui/Icon";
import { NavLink } from "./NavLink";
import { PhoneBar } from "./PhoneBar";
import { RoleSwitch } from "./RoleSwitch";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The signed-in shell: sidebar (full, rail or hidden by width), phone top bar and bottom bar, and the page area.
 * The nav is built by navFor(viewer) from the access table; hiding a link is cosmetic, each page still checks.
 */
export function Shell({
  viewer,
  theme,
  children,
}: {
  viewer: Viewer;
  theme: Theme;
  children: ReactNode;
}) {
  const groups = navFor(viewer);
  const phone = phoneNavFor(viewer);
  const dev = isDevAuthEnabled();
  const devRole = dev ? devRoleValueOf(viewer) : null;
  const roleLabel =
    viewer.role === "brand_lead" && viewer.brand
      ? `${ROLE_LABELS.brand_lead} (${BRAND_LABELS[viewer.brand]})`
      : ROLE_LABELS[viewer.role];

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app">
        <aside className="side" aria-label="Main">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static logo; next/image would add an inline style, which the CSP blocks */}
          <img className="logo" src="/god-logo.png" alt="GOD, Global Omni Data" width="86" height="34" />
          {devRole ? <RoleSwitch value={devRole} /> : null}
          {groups.map((g) => (
            <Fragment key={g.title}>
              <div className="navgroup">{g.title}</div>
              {g.items.map((i) => (
                <NavLink key={i.id} href={i.href} label={i.label} icon={i.icon} />
              ))}
            </Fragment>
          ))}
          <div className="foot">
            <ThemeToggle initial={theme} />
            <div className="acct">
              <Icon name="user" />
              <span className="lbl">
                {viewer.displayName}
                <span className="xs muted"> · {roleLabel}</span>
              </span>
            </div>
            {dev ? (
              <form action={clearDevRole}>
                <button type="submit" className="nav">
                  <Icon name="key" />
                  <span className="lbl">Sign out ({DEV_ROLE_LABELS[devRole ?? "owner"]})</span>
                </button>
              </form>
            ) : null}
          </div>
        </aside>
        <div className="shell">
          <div className="topbar">
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img className="logo" src="/god-logo.png" alt="GOD" width="71" height="28" />
            <span className="pill acc plain">{roleLabel}</span>
          </div>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <PhoneBar items={phone} groups={groups} devRole={devRole} theme={theme} />
    </>
  );
}
