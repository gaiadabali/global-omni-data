import type { ReactNode } from "react";

export function Callout({
  tone = "default",
  role,
  children,
}: {
  tone?: "default" | "warn" | "crit";
  role?: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <div className={`callout${tone === "default" ? "" : ` ${tone}`}`} role={role}>
      <div>{children}</div>
    </div>
  );
}
