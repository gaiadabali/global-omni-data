import type { ReactNode } from "react";

/** The prototype's dot field: 35 dots with a fixed, repeating spread of opacities. No randomness, so no hydration drift. */
const OPACITY_CLASSES = ["o1", "o3", "o5", "o2", "o4", "o6", "o2", "o5", "o1", "o4", "o3"] as const;
const DOTS = Array.from({ length: 35 }, (_, i) => OPACITY_CLASSES[(i * 37) % OPACITY_CLASSES.length]);

export function DotField() {
  return (
    <div className="dotfield" aria-hidden="true">
      {DOTS.map((c, i) => (
        <i key={i} className={c} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <DotField />
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/** The loading hint: nine dots that breathe. */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="empty" role="status">
      <span className="dots" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <p>{children}</p>
    </div>
  );
}
