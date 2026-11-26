"use client";

import { Fragment, useEffect, useState } from "react";
import type { NavGroup, PhoneItem } from "@/server/access";
import type { DevRoleValue } from "@/server/dev-roles";
import type { Theme } from "@/lib/theme";
import { Icon } from "@/components/ui/Icon";
import { NavLink } from "./NavLink";
import { RoleSwitch } from "./RoleSwitch";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The phone bottom bar (up to 860 px wide): up to four pages and a "More" sheet with everything else, the dev
 * role switch (dev only), the theme, and Sign out (real sign-in only; dev signs out from the role switch). Hidden by
 * CSS above 860 px.
 */
export function PhoneBar({
  items,
  groups,
  devRole,
  theme,
}: {
  items: PhoneItem[];
  groups: NavGroup[];
  devRole: DevRoleValue | null;
  theme: Theme;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open ? (
        <div
          className="menu"
          aria-label="More"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {devRole ? <RoleSwitch value={devRole} /> : null}
          {groups.map((g) => (
            <Fragment key={g.title}>
              <div className="navgroup">{g.title}</div>
              {g.items.map((i) => (
                <NavLink key={i.id} href={i.href} label={i.label} icon={i.icon} />
              ))}
            </Fragment>
          ))}
          <div className="navgroup">Account</div>
          <ThemeToggle initial={theme} />
          {devRole ? null : (
            <form method="post" action="/auth/signout">
              <button type="submit" className="nav">
                <Icon name="key" />
                <span className="lbl">Sign out</span>
              </button>
            </form>
          )}
        </div>
      ) : null}
      <nav className="phonebar" aria-label="Main, phone">
        {items.map((i) => (
          <NavLink key={i.id} href={i.href} label={i.label} icon={i.icon} />
        ))}
        <button
          type="button"
          className="nav"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="more" />
          <span className="lbl">More</span>
        </button>
      </nav>
    </>
  );
}
