import type { AuditEvent } from "../../audit/types";
import type { BrandId, Role } from "../../types";
import type { AllowEntry, AllowStatus, BreakGlassKey, Enquiry, EnquiryStatus, SessionRecord } from "../types";

/** Row mapping, pure so it can be unit tested without a database. Time values leave here as ISO strings. */

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const ALLOW_COLUMNS = `id, name, email, yourtal_sub, role, brand, to_char(agreement_signed, 'YYYY-MM-DD') AS agreement_signed,
  original_held_by, status, invited_by, invited_at, last_sign_in`;

export interface AllowRow {
  id: string;
  name: string;
  email: string;
  yourtal_sub: string | null;
  role: Role;
  brand: BrandId | null;
  agreement_signed: string;
  original_held_by: string;
  status: AllowStatus;
  invited_by: string;
  invited_at: Date;
  last_sign_in: Date | null;
}

export function toAllowEntry(r: AllowRow): AllowEntry {
  const e: AllowEntry = {
    id: r.id,
    name: r.name,
    email: r.email,
    yourtalSub: r.yourtal_sub,
    role: r.role,
    agreementSigned: r.agreement_signed,
    originalHeldBy: r.original_held_by,
    status: r.status,
    invitedBy: r.invited_by,
    invitedAt: iso(r.invited_at),
    lastSignIn: isoOrNull(r.last_sign_in),
  };
  if (r.brand) e.brand = r.brand;
  return e;
}

export const SESSION_COLUMNS = `id, user_id, created_at, last_seen_at, absolute_expires_at, auth_time, amr, user_agent, ip_prefix,
  revoked_at, revoked_by`;

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date;
  absolute_expires_at: Date;
  auth_time: Date;
  amr: string[];
  user_agent: string | null;
  ip_prefix: string | null;
  revoked_at: Date | null;
  revoked_by: string | null;
}

export function toSessionRecord(r: SessionRow): SessionRecord {
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: iso(r.created_at),
    lastSeenAt: iso(r.last_seen_at),
    absoluteExpiresAt: iso(r.absolute_expires_at),
    authTime: iso(r.auth_time),
    amr: Object.freeze([...r.amr]),
    userAgent: r.user_agent,
    ipPrefix: r.ip_prefix,
    revokedAt: isoOrNull(r.revoked_at),
    revokedBy: r.revoked_by,
  };
}

export const AUDIT_COLUMNS = "seq, occurred_at, who, action, target, reason, outcome";

export interface AuditRow {
  /** bigint arrives as a string. */
  seq: string | number;
  occurred_at: Date;
  who: string;
  action: AuditEvent["action"];
  target: string;
  reason: string;
  outcome: AuditEvent["outcome"];
}

export function toAuditEvent(r: AuditRow): AuditEvent {
  const seq = Number(r.seq);
  return Object.freeze({
    id: `ev-${seq}`,
    seq,
    when: iso(r.occurred_at),
    who: r.who,
    action: r.action,
    target: r.target,
    reason: r.reason,
    outcome: r.outcome,
  });
}

export const BREAK_GLASS_COLUMNS = "credential_id, public_key, sign_count, owner_id, created_at, last_used_at, revoked_at";

export interface BreakGlassRow {
  credential_id: string;
  public_key: Buffer;
  /** bigint arrives as a string. */
  sign_count: string | number;
  owner_id: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export function toBreakGlassKey(r: BreakGlassRow): BreakGlassKey {
  return {
    credentialId: r.credential_id,
    publicKey: new Uint8Array(r.public_key),
    signCount: Number(r.sign_count),
    ownerId: r.owner_id,
    createdAt: iso(r.created_at),
    lastUsedAt: isoOrNull(r.last_used_at),
    revokedAt: isoOrNull(r.revoked_at),
  };
}

/** Emails are stored lower case and trimmed (the table has a CHECK for it). */
export const normEmail = (email: string): string => email.trim().toLowerCase();

export const ENQUIRY_COLUMNS = `id, received_at, name, company, email, want, budget, ip_prefix, status, handled_by, handled_at`;

export interface EnquiryRow {
  id: string;
  received_at: Date;
  name: string;
  company: string;
  email: string;
  want: string;
  budget: string;
  ip_prefix: string | null;
  status: EnquiryStatus;
  handled_by: string | null;
  handled_at: Date | null;
}

export function toEnquiry(r: EnquiryRow): Enquiry {
  return {
    id: r.id,
    receivedAt: iso(r.received_at),
    name: r.name,
    company: r.company,
    email: r.email,
    want: r.want,
    budget: r.budget,
    ipPrefix: r.ip_prefix,
    status: r.status,
    handledBy: r.handled_by,
    handledAt: isoOrNull(r.handled_at),
  };
}
