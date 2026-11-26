"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PasskeyModal } from "@/components/pages/PasskeyModal";
import { useToast } from "@/components/ui/Toast";
import { inviteAction } from "@/server/audit/actions";
import { BRAND_IDS, BRAND_LABELS, ROLES, ROLE_LABELS } from "@/server/types";

/**
 * Invite someone to the allow-list. The Invite button stays disabled until the date the paper agreement was
 * signed is entered: the signed original must be filed first. Pressing it asks for the passkey step, and the
 * server records the invitation in the audit log.
 */
export function InviteForm({ holders, today }: { holders: readonly string[]; today: string }) {
  const uid = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("executive");
  const [brand, setBrand] = useState<string>("yourtal");
  const [date, setDate] = useState("");
  const [heldBy, setHeldBy] = useState<string>(holders[0] ?? "");
  const [hint, setHint] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const idOf = (f: string) => `${uid}-${f}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!date) return;
    if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setHint("Add a name and the email address of their YourTal account.");
      return;
    }
    setHint(null);
    setAsking(true);
  }

  return (
    <>
      <form className="grid invite-grid" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={idOf("name")}>Full name</label>
          <input
            id={idOf("name")}
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={idOf("email")}>Email of their YourTal account</label>
          <input
            id={idOf("email")}
            type="email"
            placeholder="name@example.com"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={idOf("role")}>Role</label>
          <select id={idOf("role")} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        {role === "brand_lead" ? (
          <div className="field">
            <label htmlFor={idOf("brand")}>Brand</label>
            <select id={idOf("brand")} value={brand} onChange={(e) => setBrand(e.target.value)}>
              {BRAND_IDS.map((b) => (
                <option key={b} value={b}>
                  {BRAND_LABELS[b]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={idOf("date")}>Paper agreement signed on</label>
          <input
            id={idOf("date")}
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={idOf("held")}>Paper original held by</label>
          <select id={idOf("held")} value={heldBy} onChange={(e) => setHeldBy(e.target.value)}>
            {holders.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div className="field end">
          <button type="submit" className="btn primary" disabled={!date}>
            Invite
          </button>
        </div>
      </form>
      <p className="small muted" aria-live="polite">
        {hint ??
          (date
            ? "Agreement date recorded. You can invite."
            : "Invite stays disabled until the date the paper agreement was signed is entered. The signed original must be filed first.")}
      </p>
      <PasskeyModal
        open={asking}
        title="Invite this person?"
        confirmLabel="Check my passkey and invite"
        intro={
          <p>
            {name.trim() || "This person"} ({email.trim().toLowerCase() || "no email yet"}) will be
            added to the allow-list as{" "}
            {
              ROLE_LABELS[
                (ROLES as readonly string[]).includes(role)
                  ? (role as (typeof ROLES)[number])
                  : "executive"
              ]
            }
            . They sign in with YourTal using a passkey, and their account is matched to this email
            once, at their first sign-in.
          </p>
        }
        onClose={() => setAsking(false)}
        onConfirm={async () => {
          const res = await inviteAction({
            name,
            email,
            role,
            ...(role === "brand_lead" ? { brand } : {}),
            agreementSigned: date,
            originalHeldBy: heldBy,
          });
          if (!res.ok)
            return {
              ok: false,
              error: res.error,
              ...(res.freshUrl ? { freshUrl: res.freshUrl } : {}),
            };
          toast(`Invited ${res.name}. They sign in with YourTal and a passkey.`);
          setName("");
          setEmail("");
          setDate("");
          router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
