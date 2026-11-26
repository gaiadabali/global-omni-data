import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /** Numbers align right. */
  align?: "left" | "right";
  render?: (row: T) => ReactNode;
}

/** A plain table in a horizontally scrolling wrapper (no sideways scroll for the page at 390 px). */
export function Table<T extends object>({
  columns,
  rows,
  caption,
  empty = "Nothing to show yet.",
}: {
  columns: Column<T>[];
  rows: T[];
  caption?: string;
  empty?: string;
}) {
  return (
    <div className="tablewrap">
      <table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.align === "right" ? "num" : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                    {c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
