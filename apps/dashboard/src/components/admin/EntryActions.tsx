"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PasskeyModal } from "@/components/pages/PasskeyModal";
import { useToast } from "@/components/ui/Toast";
import { allowListChangeAction } from "@/server/audit/actions";

type Change = "suspend" | "remove" | "reinstate";

const COPY: Record<
  Change,
  { button: string; title: string; confirm: string; text: (name: string) => string }
> = {
  suspend: {
    button: "Suspend",
    title: "Suspend this person?",
    confirm: "Check my passkey and suspend",
    text: (n) => `${n} is signed out everywhere and cannot sign in until reinstated.`,
  },
  remove: {
    button: "Remove",
    title: "Remove this person?",
    confirm: "Check my passkey and remove",
    text: (n) =>
      `${n} is signed out everywhere and taken off the allow-list. Inviting them again makes a new entry.`,
  },
  reinstate: {
    button: "Reinstate",
    title: "Reinstate this person?",
    confirm: "Check my passkey and reinstate",
    text: (n) => `${n} can sign in again with their passkey.`,
  },
};

/** Suspend, remove or reinstate an allow-list entry. An allow-list change, so it needs a fresh passkey check. */
export function EntryActions({ id, name, status }: { id: string; name: string; status: string }) {
  const [open, setOpen] = useState<Change | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const changes: Change[] =
    status === "suspended" ? ["reinstate", "remove"] : ["suspend", "remove"];
  const copy = open ? COPY[open] : null;
  return (
    <>
      <div className="row">
        {changes.map((c) => (
          <button
            key={c}
            type="button"
            className={`btn sm${c === "reinstate" ? "" : " danger"}`}
            aria-label={`${COPY[c].button} ${name}`}
            onClick={() => setOpen(c)}
          >
            {COPY[c].button}
          </button>
        ))}
      </div>
      <PasskeyModal
        open={open !== null}
        title={copy?.title ?? ""}
        confirmLabel={copy?.confirm ?? "Continue"}
        intro={<p>{copy?.text(name)}</p>}
        onClose={() => setOpen(null)}
        onConfirm={async () => {
          if (!open) return { ok: true };
          const res = await allowListChangeAction({ id, change: open });
          if (!res.ok)
            return {
              ok: false,
              error: res.error,
              ...(res.freshUrl ? { freshUrl: res.freshUrl } : {}),
            };
          toast(
            res.sessionsEnded
              ? `${res.name}: done. ${res.sessionsEnded} ${res.sessionsEnded === 1 ? "session" : "sessions"} ended.`
              : `${res.name}: done.`,
          );
          router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
