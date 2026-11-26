import type { Metadata } from "next";
import Link from "next/link";
import "@/components/pages/pages.css";
import { EmergencySignIn } from "@/components/breakglass/EmergencySignIn";
import { readBreakGlassConfig } from "@/server/breakglass/config";
import { BACKDROP_SIZE, backdropDots } from "@/server/data/backdrop";
import { isDevAuthEnabled } from "@/server/dev-auth";

export const metadata: Metadata = { title: "Emergency sign-in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * /auth/emergency: the emergency Owner sign-in for when YourTal is down. Not in any nav and not linked from /signin.
 * One button, which runs a WebAuthn assertion against the emergency keys this dashboard holds (never YourTal's).
 * The server does every check (src/server/breakglass/signin.ts); this page only explains and starts it.
 */
export default function EmergencyPage() {
  const available = readBreakGlassConfig() !== null;
  const dev = isDevAuthEnabled();
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
        {/* eslint-disable-next-line @next/next/no-img-element -- a static logo; next/image would add an inline style */}
        <img className="logo" src="/god-logo.png" alt="GOD, Global Omni Data" width="142" height="56" />
        <div>
          <h1>Emergency sign-in</h1>
          <p className="muted mt-1.5">
            For when YourTal is down. Only for the Owner who holds the sealed emergency key.
          </p>
        </div>
        <EmergencySignIn available={available} />
        <div className="callout warn" role="note">
          <div>
            <b>Every action is recorded.</b> This sign-in raises an alert. The session ends after 1 hour. It can
            read the dashboard and end sessions, and nothing else: no exports, no profiles, no changes to who can
            sign in.
          </div>
        </div>
        <p className="small muted" id="emergency-note">
          {available
            ? "Use the key with its PIN, fingerprint or face. It works on this website only."
            : dev
              ? "Emergency sign-in is off while dev sign-in is on."
              : "Emergency sign-in is not available here."}
        </p>
        <p className="small">
          <Link href="/signin">Sign in with YourTal instead</Link>
        </p>
      </main>
    </div>
  );
}
