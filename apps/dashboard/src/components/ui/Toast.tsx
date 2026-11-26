"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ToastApi {
  /** Shows one message for about four seconds. A new message replaces the old one. */
  toast: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** Mount once, near the root. Anything below can call useToast().toast("..."). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ id: number; message: string } | null>(null);

  const toast = useCallback((message: string) => {
    setCurrent({ id: Date.now() + Math.random(), message });
  }, []);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), 4200);
    return () => clearTimeout(t);
  }, [current]);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="true">
        {current ? (
          <div className="toast" role="status" key={current.id}>
            {current.message}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
