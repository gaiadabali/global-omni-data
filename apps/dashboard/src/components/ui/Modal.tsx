"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A modal dialog on the native <dialog>: focus is trapped, Escape closes it, and focus returns to what opened it.
 * Controlled: the parent owns `open` and clears it in `onClose`.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  actions,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="mh">
        <h2 id={titleId}>{title}</h2>
      </div>
      <div className="mb">{children}</div>
      {actions ? <div className="mf">{actions}</div> : null}
    </dialog>
  );
}
