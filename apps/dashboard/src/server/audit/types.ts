/**
 * THE AUDIT SEAM, contract side. An AuditLog is append-only: the only way to add an event is `append`, and there
 * is no update, delete or clear. Real storage (an append-only table, then an off-box archive) replaces the
 * in-memory implementation later, and nothing else changes.
 */
export const AUDIT_ACTIONS = [
  "person.open",
  "export.pdf",
  "allowlist.invite",
  "allowlist.change",
  "session.revoke",
  "signin.refused",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "person.open": "Person 360 open",
  "export.pdf": "Export",
  "allowlist.invite": "Invite",
  "allowlist.change": "Allow-list change",
  "session.revoke": "Session revoked",
  "signin.refused": "Sign-in refused",
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
