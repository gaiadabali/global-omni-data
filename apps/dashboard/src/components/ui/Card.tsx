import type { ReactNode } from "react";

/** A titled panel. `flush` removes the body padding (for tables that run edge to edge). */
export function Card({
  title,
  tools,
  flush = false,
  className = "",
  children,
}: {
  title?: ReactNode;
  tools?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {title || tools ? (
        <div className="ch">
          {title ? <h2>{title}</h2> : <span />}
          {tools}
        </div>
      ) : null}
      <div className={`cb${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}
