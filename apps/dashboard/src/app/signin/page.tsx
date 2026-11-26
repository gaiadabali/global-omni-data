import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/ui";
import { homePathFor } from "@/server/access";
import { isRealSignInOn } from "@/server/auth/config";
import { getSessionState } from "@/server/auth/current";
import { BACKDROP_SIZE, backdropDots } from "@/server/data/backdrop";
import { isDevAuthEnabled } from "@/server/dev-auth";
import { getViewer } from "@/server/viewer";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The states Sign in with YourTal produces, shown with ?reason=... (src/server/auth/paths.ts). An action, where
 * there is one, starts a new sign-in. A browser whose session has ended sees "expired" even without a reason.
 */
const REASONS = {
  "not-listed": {
    title: "This account can't open the GOD dashboard",
    text: "Access is by invitation only. If you expected access, ask the person who invited you.",
    action: null,
  },
  password: {
    title: "Sign in again with your passkey",
    text: "This sign-in used a password. The dashboard needs a passkey.",
    action: "Sign in again with your passkey",
  },
  teen: {
    title: "This account can't be used here",
    text: "Sign in with a different account, or go back.",
    action: null,
  },
  expired: {
    title: "Your session has ended",
    text: "For your safety, sessions end after a while. Sign in again to carry on.",
    action: "Sign in again",
  },
  retry: {
    title: "That sign-in did not finish",
    text: "It may have taken too long, or started in another tab. Try again.",
    action: "Try again",
  },
  unavailable: {
    title: "Sign-in is not available right now",
    text: "YourTal could not be reached. Try again in a few minutes.",
    action: null,
  },
  "signed-out": {
    title: "You're signed out",
    text: "Close this tab if you are on a shared computer.",
    action: null,
  },
} as const;
type Reason = keyof typeof REASONS;

const DEMO: { reason: Reason; label: string }[] = [
  { reason: "not-listed", label: "Not on the allow-list" },
  { reason: "password", label: "Password, no passkey" },
  { reason: "teen", label: "Teen account" },
  { reason: "expired", label: "Session ended" },
  { reason: "retry", label: "Did not finish" },
  { reason: "unavailable", label: "YourTal down" },
  { reason: "signed-out", label: "Signed out" },
];

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const raw = (await searchParams).reason;
  const key = Array.isArray(raw) ? raw[0] : raw;
  const dev = isDevAuthEnabled();
  const real = isRealSignInOn();
  const session = dev ? null : await getSessionState();
  const reasonKey: Reason | null =
    key && key in REASONS ? (key as Reason) : session?.kind === "ended" ? "expired" : null;
  const reason = reasonKey ? REASONS[reasonKey] : null;
  const viewer = dev ? await getViewer() : session?.kind === "ok" ? session.viewer : null;
  const dots = backdropDots();

  return (
    <div className="signin">
      <div className="sidefield">
        <svg
          viewBox={`0 0 ${BACKDROP_SIZE.w} ${BACKDROP_SIZE.h}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fillOpacity={d.o} />
          ))}
        </svg>
        <div className="cap">A picture of where Australians live. No dot is a person.</div>
      </div>
      <main className="form">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static logo; see Shell */}
        <img
          className="logo"
          src="/god-logo.png"
          alt="GOD, Global Omni Data"
          width="142"
          height="56"
        />
        <div>
          <h1>Sign in</h1>
          <p className="muted mt-1.5">
            The private group intelligence dashboard of GOD. Open to invited people only.
          </p>
        </div>
        <div className="stack">
          {real ? (
            // A plain link, not a form: the redirect to YourTal is a navigation, so CSP form-action never applies.
            <a className="btn primary wide" href="/auth/start" aria-describedby="signin-note">
              Sign in with YourTal
            </a>
          ) : (
            <button
              type="button"
              className="btn primary wide"
              disabled
              aria-describedby="signin-note"
            >
              Sign in with YourTal
            </button>
          )}
          <p className="small muted" id="signin-note">
            {real
              ? "Sign in with YourTal, with a passkey. Access is by invitation only."
              : "Sign in with YourTal is off while dev sign-in is on. Use the role switch below."}
          </p>
          {viewer && !dev ? (
            <p className="small">
              <Link href={homePathFor(viewer)}>Back to the dashboard</Link>
            </p>
          ) : null}
        </div>
        {reason ? (
          <div aria-live="polite">
            <Callout
              tone={reasonKey === "signed-out" ? "default" : "crit"}
              role={reasonKey === "signed-out" ? "status" : "alert"}
            >
              <b>{reason.title}</b>
              <div className="small mt-1">{reason.text}</div>
              {reason.action ? (
                real ? (
                  <a className="btn primary sm mt-2.5" href="/auth/start">
                    {reason.action}
                  </a>
                ) : (
                  <button type="button" className="btn primary sm mt-2.5" disabled>
                    {reason.action}
                  </button>
                )
              ) : null}
            </Callout>
          </div>
        ) : null}
        {dev ? (
          <div className="demo">
            <div className="lab xs mono faint uppercase tracking-wider">
              Dev sign-in is on: what happens next
            </div>
            <div className="seg" role="group" aria-label="Refusal states">
              {DEMO.map((d) => (
                <Link
                  key={d.reason}
                  href={`/signin?reason=${d.reason}`}
                  className={key === d.reason ? "on" : undefined}
                >
                  {d.label}
                </Link>
              ))}
            </div>
            <p className="small">
              <Link href="/dev-role">Open the role switch</Link> to sign in as a role.
              {viewer ? (
                <>
                  {" "}
                  <Link href={homePathFor(viewer)}>Back to the dashboard</Link>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
