import type { ReactNode } from "react";
import type { IconName } from "@/lib/pages";

/** Line icons from the approved prototype. A brand swatch ("sw:yt") is a coloured dot, not a glyph. */
const GLYPHS: Record<Exclude<IconName, `sw:${string}`>, ReactNode> = {
  home: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h5v-6h4v6h5V10" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r=".8" />
    </>
  ),
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />,
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 18 4-6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  more: <path d="M4 7h16M4 12h16M4 17h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.6 3.4-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
};

const SWATCH_CLASS: Record<string, string> = { yt: "b-yt", sa: "b-sa", ftr: "b-ftr" };

export function Icon({ name }: { name: IconName }) {
  if (name.startsWith("sw:")) {
    return <span className={`sw ${SWATCH_CLASS[name.slice(3)] ?? ""}`} aria-hidden="true" />;
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {GLYPHS[name as Exclude<IconName, `sw:${string}`>]}
    </svg>
  );
}
