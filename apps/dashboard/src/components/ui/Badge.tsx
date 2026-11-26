import type { ReactNode } from "react";

export type BadgeTone = "default" | "ok" | "warn" | "crit" | "info" | "acc";

/** A small pill. `plain` drops the status dot. */
export function Badge({
  tone = "default",
  plain = false,
  title,
  children,
}: {
  tone?: BadgeTone;
  plain?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const cls = ["pill", tone === "default" ? "" : tone, plain ? "plain" : ""].filter(Boolean).join(" ");
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
