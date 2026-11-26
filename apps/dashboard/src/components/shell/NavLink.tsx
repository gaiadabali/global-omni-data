"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { IconName } from "@/lib/pages";
import { Icon } from "@/components/ui/Icon";

/** A nav link that marks itself current. Whether the link exists at all is decided on the server (navFor). */
export function NavLink({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  const pathname = usePathname();
  const on = pathname === href;
  return (
    <Link href={href} className={`nav${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
      <Icon name={icon} />
      <span className="lbl">{label}</span>
    </Link>
  );
}
