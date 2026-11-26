import { ipPrefixOf } from "../auth/session";
import { getStores } from "../store";
import type { Enquiry, Stores } from "../store/types";
import {
  buildEnquiryMail,
  dashboardEnquiriesUrl,
  getMailer,
  stderrLog,
  type LogWriter,
  type Mailer,
} from "./notify";
import { getEnquiryLimiter, type EnquiryLimiter } from "./rate-limit";
import { validateEnquiry } from "./validate";

/**
 * POST /api/public/contact: the public site's contact form. The ONLY unauthenticated write the dashboard has, so every
 * refusal is decided here, in this order, before anything is stored:
 *
 *   403  the Origin header is not the public site (https://god.gaiada.com, or GOD_SITE_ORIGIN; localhost too in dev)
 *   429  too many from this network prefix, or too many in total (Retry-After says when)
 *   415  not application/json
 *   413  body over 8 KB (checked on Content-Length first, then on the bytes actually read)
 *   400  not JSON, or not a JSON object
 *   204  the honeypot `website` is filled: a bot. Nothing is stored. The bot is told it worked.
 *   422  a field fails validation (body: { ok: false, errors: { field: message } })
 *   201  stored (no body). The notification email is sent AFTER the row is stored, waited for briefly, and an email
 *        failure is only logged
 *   500  the store failed: nothing was kept, and the email is not sent
 *
 * The caller's address is X-Real-IP only (nginx sets it; a client-sent X-Forwarded-For is never trusted), and only a
 * coarse prefix of it is used or stored. No cookie is read or set, and nothing here depends on a session.
 */

export const MAX_BODY_BYTES = 8 * 1024;
/** How long the response waits for the email before answering anyway (the email carries on in the background). */
export const EMAIL_WAIT_MS = 2_000;
export const DEFAULT_SITE_ORIGIN = "https://god.gaiada.com";

export interface PublicContactDeps {
  stores?: Pick<Stores, "enquiries">;
  /** null: no email is configured. Default: from the environment (getMailer). */
  mailer?: Mailer | null;
  limiter?: EnquiryLimiter;
  now?: () => number;
  /** The only Origin accepted. Default: GOD_SITE_ORIGIN, else https://god.gaiada.com. */
  siteOrigin?: string;
  /** Also accept http://localhost and http://127.0.0.1 on any port (dev). Default: GOD_DEPLOYMENT is "dev". */
  allowLocalhost?: boolean;
  emailWaitMs?: number;
  log?: LogWriter;
}

/** The configured site origin as a bare origin ("https://god.gaiada.com"), or the default if it is not a URL. */
export function siteOriginFromEnv(env: Record<string, string | undefined> = process.env): string {
  try {
    const u = new URL((env.GOD_SITE_ORIGIN ?? "").trim() || DEFAULT_SITE_ORIGIN);
    return u.origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function originAllowed(origin: string | null, siteOrigin: string, allowLocalhost: boolean): boolean {
  if (origin === null) return false; // a browser sends Origin on a POST; no Origin is not the site
  if (origin === siteOrigin) return true;
  return allowLocalhost && LOCALHOST_ORIGIN.test(origin);
}

const HEADERS = { "Cache-Control": "no-store" } as const;

function reply(status: number, body?: unknown, extra: Record<string, string> = {}): Response {
  if (body === undefined) return new Response(null, { status, headers: { ...HEADERS, ...extra } });
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } });
}

/** Reads the request body as text, at most `max` bytes. Null when it is longer (the rest is not read). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  // Invalid UTF-8 is refused, not repaired.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function handlePublicContact(request: Request, deps: PublicContactDeps = {}): Promise<Response> {
  const log = deps.log ?? stderrLog;
  const now = deps.now ?? Date.now;

  // 1. Origin.
  const allowLocalhost = deps.allowLocalhost ?? process.env.GOD_DEPLOYMENT === "dev";
  if (!originAllowed(request.headers.get("origin"), deps.siteOrigin ?? siteOriginFromEnv(), allowLocalhost)) {
    return reply(403, { ok: false, error: "forbidden" });
  }

  // 2. Rate limits, per network prefix and in total. A request with no usable address shares one bucket.
  const prefix = ipPrefixOf(request.headers.get("x-real-ip"));
  const limited = (deps.limiter ?? getEnquiryLimiter()).take(prefix ?? "unknown", now());
  if (!limited.ok) {
    return reply(429, { ok: false, error: "rate_limited" }, { "Retry-After": String(limited.retryAfterSeconds) });
  }

  // 3. JSON only, 8 KB at most.
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return reply(415, { ok: false, error: "json_only" });
  let raw: string | null;
  try {
    raw = await readCapped(request, MAX_BODY_BYTES);
  } catch {
    return reply(400, { ok: false, error: "bad_request" });
  }
  if (raw === null) return reply(413, { ok: false, error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: "bad_request" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reply(400, { ok: false, error: "bad_request" });
  }
  const fields = body as Record<string, unknown>;

  // 4. Honeypot: people never see this field. Say it worked, store nothing, keep no content, count it in the log.
  const trap = fields.website;
  if (trap !== undefined && trap !== null && trap !== "") {
    log("enquiry.honeypot", { prefix });
    return reply(204);
  }

  // 5. Validation, authoritative.
  const checked = validateEnquiry(fields);
  if (!checked.ok) return reply(422, { ok: false, errors: checked.errors });

  // 6. Store FIRST.
  const stores = deps.stores ?? getStores();
  let saved: Enquiry;
  try {
    saved = await stores.enquiries.create({ ...checked.value, ipPrefix: prefix });
  } catch (e) {
    log("enquiry.store.failed", { error: (e as { code?: string }).code ?? (e as Error).name });
    return reply(500, { ok: false, error: "not_saved" });
  }

  // 7. Then tell someone, best effort. The response waits for the email only briefly.
  const mailer = deps.mailer === undefined ? getMailer(log) : deps.mailer;
  if (mailer) {
    const dashboardUrl = dashboardEnquiriesUrl();
    const mail = buildEnquiryMail(mailer, saved, dashboardUrl ? { dashboardUrl } : {});
    // Promise.resolve().then: a mailer that throws before it returns a promise is still only a logged failure.
    const id = saved.id;
    const sending = Promise.resolve()
      .then(() => mailer.send(mail))
      .then(
        () => undefined,
        (e: unknown) => {
          // The reason code only: an SMTP error text can quote an address.
          log("enquiry.mail.failed", { id, error: (e as { code?: string }).code ?? (e as Error).name });
        },
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deps.emailWaitMs ?? EMAIL_WAIT_MS);
    });
    await Promise.race([sending, patience]);
    clearTimeout(timer);
  }

  return reply(201);
}
