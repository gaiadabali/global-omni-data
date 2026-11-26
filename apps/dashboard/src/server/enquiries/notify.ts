import { createTransport } from "nodemailer";
import { fmtDateTime } from "@/lib/dates";
import type { Enquiry } from "../store/types";
import { cleanLine } from "./validate";

/**
 * THE EMAIL NOTIFICATION for a new enquiry. Best effort, and always after the enquiry is stored: the stored row is the
 * record, the email only tells someone to go and look. Nothing here may throw into the request that caused it.
 *
 * It goes through the SMTP server named by GOD_SMTP_URL (Helios's own postfix on 127.0.0.1:25, which signs with DKIM),
 * from GOD_ENQUIRY_FROM to GOD_ENQUIRY_TO. If any of the three is unset, no mail is sent and that is logged once.
 * Plain text. Reply-To is the enquirer's address, so replying answers them.
 *
 * Header safety: every value that reaches a header (subject, from, to, reply-to) has CR, LF and every other control
 * character removed here, whatever validation did before, and the enquirer's address must still look like one.
 */

export interface MailConfig {
  smtpUrl: string;
  to: string;
  from: string;
}

export interface OutgoingMail {
  from: string;
  to: string;
  /** Absent when the enquirer's address did not pass the check one more time. */
  replyTo?: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** Where the notification goes, and who it is from (GOD_ENQUIRY_TO and GOD_ENQUIRY_FROM). */
  readonly to: string;
  readonly from: string;
  send(mail: OutgoingMail): Promise<void>;
}

/** One JSON line to stderr (`docker logs god-dashboard`). Never carries an enquiry's content. */
export type LogWriter = (event: string, detail?: Record<string, unknown>) => void;

export const stderrLog: LogWriter = (event, detail = {}) => {
  try {
    process.stderr.write(`${JSON.stringify({ level: "WARN", source: "god-dashboard", event, ...detail })}\n`);
  } catch {
    /* a log line must never throw */
  }
};

/** The three variables, or null when any is unset or empty. Header values lose any control character. */
export function readMailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const smtpUrl = (env.GOD_SMTP_URL ?? "").trim();
  const to = cleanLine(env.GOD_ENQUIRY_TO ?? "");
  const from = cleanLine(env.GOD_ENQUIRY_FROM ?? "");
  return smtpUrl && to && from ? { smtpUrl, to, from } : null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Options for nodemailer from the URL. No TLS to a loopback server (there is nothing to protect or verify on 127.0.0.1);
 *  anywhere else TLS is required and the certificate is checked. Short timeouts: a stuck server must not pile up work. */
export function smtpOptions(smtpUrl: string) {
  const u = new URL(smtpUrl);
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") throw new RangeError("GOD_SMTP_URL must be smtp:// or smtps://");
  const secure = u.protocol === "smtps:";
  const loopback = LOOPBACK.has(u.hostname);
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: u.port ? Number(u.port) : secure ? 465 : 25,
    secure,
    ...(loopback ? { ignoreTLS: true } : secure ? {} : { requireTLS: true }),
    ...(u.username ? { auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } } : {}),
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 15_000,
    // We attach nothing, and nothing a visitor sends may make the mailer read a file or fetch a URL.
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function createSmtpMailer(cfg: MailConfig): Mailer {
  const transport = createTransport(smtpOptions(cfg.smtpUrl));
  return {
    to: cfg.to,
    from: cfg.from,
    async send(mail) {
      await transport.sendMail({
        from: mail.from,
        to: mail.to,
        ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
      });
    },
  };
}

const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

/** The mail for one enquiry. Pure, so the header rules can be tested on hostile input without a mail server. */
export function buildEnquiryMail(
  cfg: Pick<MailConfig, "to" | "from">,
  e: Pick<Enquiry, "id" | "receivedAt" | "name" | "company" | "email" | "want" | "budget" | "ipPrefix">,
  opts: { dashboardUrl?: string } = {},
): OutgoingMail {
  // Every header value is one line: CR, LF and the rest of the controls are gone before anything is built.
  const company = cleanLine(e.company);
  const replyTo = cleanLine(e.email);
  const lines = [
    "A new enquiry came in through the contact form on god.gaiada.com.",
    "",
    `Name:     ${cleanLine(e.name)}`,
    `Company:  ${company}`,
    `Email:    ${replyTo}`,
    `Budget:   ${cleanLine(e.budget) || "Not given"}`,
    "",
    "Message:",
    e.want,
    "",
    "---",
    `Received ${fmtDateTime(e.receivedAt)} (Australian Eastern time). Enquiry ${e.id}.`,
    ...(opts.dashboardUrl ? [`Mark it read in the dashboard: ${cleanLine(opts.dashboardUrl)}`] : []),
    "Reply to this email to answer the sender.",
  ];
  return {
    from: cleanLine(cfg.from),
    to: cleanLine(cfg.to),
    ...(ADDRESS.test(replyTo) ? { replyTo } : {}),
    subject: `New enquiry from ${company}`.slice(0, 200),
    text: lines.join("\n"),
  };
}

type Holder = { __godMailer?: { mailer: Mailer | null } };

/**
 * The mailer for this process, or null when the three variables are not all set. It logs that ONCE, the first time an
 * enquiry arrives without them, not on every enquiry. Built once and kept on globalThis.
 */
export function getMailer(log: LogWriter = stderrLog): Mailer | null {
  const g = globalThis as Holder;
  if (!g.__godMailer) {
    const cfg = readMailConfig();
    let mailer: Mailer | null = null;
    if (!cfg) {
      log("enquiry.mail.disabled", {
        why: "GOD_SMTP_URL, GOD_ENQUIRY_TO and GOD_ENQUIRY_FROM are not all set: enquiries are stored, no email is sent",
      });
    } else {
      try {
        mailer = createSmtpMailer(cfg);
      } catch (e) {
        log("enquiry.mail.disabled", { why: `GOD_SMTP_URL is not usable: ${(e as Error).message}` });
      }
    }
    g.__godMailer = { mailer };
  }
  return g.__godMailer.mailer;
}

/** The address the notification reads "Mark it read" from. Unset: the line is left out. */
export function dashboardEnquiriesUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const base = (env.GOD_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+$/.test(base) ? `${base}/admin?tab=enquiries` : undefined;
}
