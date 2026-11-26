import type { ReactNode } from "react";

/**
 * The top of every page: the h1, one line of plain description, the "Sample data" tag (every figure in this
 * phase is synthetic) and any controls. `brand` puts the brand's colour dot before the title.
 */
export function PageHeader({
  title,
  sub,
  brand,
  actions,
  sample = true,
}: {
  title: ReactNode;
  sub?: ReactNode;
  brand?: "yt" | "sa" | "ftr";
  actions?: ReactNode;
  sample?: boolean;
}) {
  return (
    <div className="head">
      <div>
        <h1>
          {brand ? <span className={`brand-dot b-${brand}`} aria-hidden="true" /> : null}
          {title}
        </h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      <div className="row">
        {sample ? <span className="sample">Sample data</span> : null}
        {actions}
      </div>
    </div>
  );
}
