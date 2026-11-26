"use client";

import Link from "next/link";

export interface SegmentOption {
  value: string;
  label: string;
  /** When set the option is a link (state kept in the URL, works from a server page with no client code). */
  href?: string;
  disabled?: boolean;
}

/**
 * A segmented control. From a server page give every option an `href` (for example ?period=week): it is a plain
 * link, so the page re-renders on the server. From client code give `onChange` instead.
 */
export function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption[];
  value: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        if (o.href && !o.disabled) {
          return (
            <Link key={o.value} href={o.href} className={on ? "on" : undefined} aria-current={on ? "true" : undefined} scroll={false}>
              {o.label}
            </Link>
          );
        }
        return (
          <button
            key={o.value}
            type="button"
            className={on ? "on" : undefined}
            aria-pressed={on}
            disabled={o.disabled}
            onClick={() => onChange?.(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
