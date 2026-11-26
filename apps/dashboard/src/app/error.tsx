"use client";

import { useEffect } from "react";

/** The last-resort error screen. It shows no error text, because messages can carry data. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest links this screen to the server log. Nothing else is shown or sent.
    console.error("dashboard error", error.digest ?? "");
  }, [error]);
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1>Something went wrong</h1>
      <p className="muted mt-2">The page did not load. Try again. If it keeps happening, tell the data team.</p>
      <p className="mt-4">
        <button type="button" className="btn primary" onClick={reset}>
          Try again
        </button>
      </p>
    </main>
  );
}
