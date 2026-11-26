/**
 * THE AUDIT SEAM, contract side. An AuditLog is append-only: the only way to add an event is `append`, and there
 * is no update, delete or clear. The Postgres audit_log holds the same list of actions as a CHECK
 * (packages/db/migrations, latest in 0004); actions-check.test.ts keeps the two equal, so a new action needs a new
 * migration first.
 */
export const AUDIT_ACTIONS = [
  "person.open",
  "export.pdf",
  "allowlist.invite",
  "allowlist.change",
  "session.revoke",
  "signin.refused",
  "signin.ok",
  "signin.fresh",
  "signout",
  "breakglass.code",
  "breakglass.enrol",
  "breakglass.revoke",
  "breakglass.signin",
  "breakglass.refused",
  "enquiry.update",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "person.open": "Person 360 open",
  "export.pdf": "Export",
  "allowlist.invite": "Invite",
  "allowlist.change": "Allow-list change",
  "session.revoke": "Session revoked",
  "signin.refused": "Sign-in refused",
  "signin.ok": "Signed in",
  "signin.fresh": "Passkey checked",
  signout: "Signed out",
  "breakglass.code": "Emergency key code made",
  "breakglass.enrol": "Emergency key added",
  "breakglass.revoke": "Emergency key revoked",
  "breakglass.signin": "Emergency sign-in",
  "breakglass.refused": "Emergency access refused",
  "enquiry.update": "Enquiry updated",
};

export function isAuditAction(v: string): v is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(v);
}

/** What a caller gives `append`. The log adds the id, the sequence number and the time. */
export interface AuditInput {
  /** The viewer id of the person who did it (or the handle of someone who was refused at sign-in). */
  who: string;
  action: AuditAction;
  /** What it was done to: a GOD id, a report, a handle, a session. */
  target: string;
  /** Why, in the person's own words where there is one. */
  reason?: string;
  /** "refused" for an attempt the system turned down (for example a teen profile). Default "done". */
  outcome?: "done" | "refused";
}

export interface AuditEvent {
  readonly id: string;
  /** 1, 2, 3 ... in the order events were added. */
  readonly seq: number;
  /** ISO instant, set by the log. */
  readonly when: string;
  readonly who: string;
  readonly action: AuditAction;
  readonly target: string;
  readonly reason: string;
  readonly outcome: "done" | "refused";
}

export interface AuditFilter {
  who?: string;
  action?: AuditAction;
  target?: string;
  outcome?: "done" | "refused";
  /** "YYYY-MM-DD", inclusive, Australian Eastern time. */
  from?: string;
  to?: string;
  /** At most this many, newest first. */
  limit?: number;
}

export interface AuditLog {
  append(input: AuditInput): Promise<AuditEvent>;
  /** Newest first. Returns copies: changing the result never changes the log. */
  list(filter?: AuditFilter): Promise<readonly AuditEvent[]>;
}
