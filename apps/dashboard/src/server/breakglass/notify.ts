/**
 * THE BREAK-GLASS ALERT HOOK. Every successful emergency sign-in (and every key added or revoked) must be loud.
 * Today it writes ONE structured JSON line to stderr, which `docker logs god-dashboard` shows and the json-file log
 * driver keeps (infra/dashboard/compose.yaml). The audit event is written separately, before this is called.
 *
 * TODO(lead): wire a real channel. Company practice routes website alerts to the ERP only (kind=website, the
 * erp-only route; never a phone, never a per-site rule). Until then nobody is told in real time: someone must
 * watch the logs or the audit log. No third-party service is called from here.
 */
export interface BreakGlassAlert {
  event: "breakglass.signin" | "breakglass.enrol" | "breakglass.revoke";
  /** ISO time. */
  at: string;
  /** The Owner's allow-list entry id (never a name or an email). */
  ownerId: string;
  /** The key, shortened (keyLabel). */
  key: string;
  /** Who did it, for enrol and revoke (an allow-list entry id). */
  by?: string;
  sessionId?: string;
  ipPrefix?: string | null;
  device?: string;
}

export type AlertWriter = (line: string) => void;

const stderrWriter: AlertWriter = (line) => {
  process.stderr.write(`${line}\n`);
};

/** Never throws: an alert that cannot be written must not undo the sign-in it reports (the audit event holds). */
export function notifyBreakGlass(alert: BreakGlassAlert, write: AlertWriter = stderrWriter): void {
  try {
    write(
      JSON.stringify({ level: "ALERT", source: "god-dashboard", alert: "break-glass", ...alert }),
    );
  } catch {
    /* the audit log already has it */
  }
}

/** The short form of a credential id used in alerts, audit targets and Admin. Credential ids are not secret. */
export function keyLabel(credentialId: string): string {
  return `key:${credentialId.slice(0, 12)}`;
}
