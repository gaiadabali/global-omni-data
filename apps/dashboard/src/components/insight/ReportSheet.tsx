import type { ReactNode } from "react";
import { fmtDate } from "@/lib/dates";
import { PrintBar } from "./PrintBar";

/** The exact watermark text, printed on every page of an exported report. */
export function watermarkText(name: string, isoDate: string): string {
  return `Prepared for ${name} · ${fmtDate(isoDate)} · GOD confidential · aggregates only`;
}

/**
 * The print view of a report: a letterhead, the watermark (a line at the top, a line at the foot of every printed
 * page, and a faint diagonal mark), and the report itself. The shell's side and phone bars are hidden for this
 * view (see pages.css). Printing it from the browser gives the branded PDF.
 */
export function ReportSheet({
  title,
  name,
  kind,
  asOf,
  exportedBy,
  backHref,
  auto,
  children,
}: {
  title: string;
  name: string;
  kind: string;
  asOf: string;
  exportedBy: string;
  backHref: string;
  auto: boolean;
  children: ReactNode;
}) {
  const mark = watermarkText(name, asOf);
  return (
    <div className="report-sheet" data-watermark={mark}>
      <PrintBar backHref={backHref} auto={auto} />
      <header className="report-head">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static logo; next/image would add an inline style, which the CSP blocks */}
        <img className="logo" src="/god-logo.png" alt="GOD, Global Omni Data" width="86" height="34" />
        <div className="report-title">
          <div className="eyebrow">GOD confidential · aggregates only</div>
          <h1>{title}</h1>
          <p className="muted">
            {name}. {kind}.
          </p>
          <p className="small report-mark">{mark}</p>
          <p className="xs muted">Exported by {exportedBy}. Every count is printed as a brand would see it.</p>
        </div>
      </header>
      {children}
      <footer className="report-foot">{mark}</footer>
    </div>
  );
}
