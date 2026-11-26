"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The bar above a printable report (hidden when printing). `auto` opens the browser's print dialog once the
 * charts have drawn, which is where "Save as PDF" lives.
 */
export function PrintBar({ backHref, auto }: { backHref: string; auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 900);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="printbar row">
      <Link className="btn" href={backHref}>
        Back to the report
      </Link>
      <button type="button" className="btn primary" onClick={() => window.print()}>
        Print or save as PDF
      </button>
      <span className="small muted">Choose &quot;Save as PDF&quot; as the printer. Backgrounds and colours are kept.</span>
    </div>
  );
}
