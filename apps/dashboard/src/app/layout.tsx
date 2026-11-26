import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter";
import "@fontsource-variable/lexend";
import "./globals.css";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: { default: "GOD Dashboard", template: "%s · GOD Dashboard" },
  description: "The private group dashboard of GOD (Global Omni Data).",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The server renders <html data-theme> from the god_theme cookie, so the right theme paints first time with no
 * flash and no inline script. "system" follows prefers-color-scheme in CSS.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-AU" data-theme={theme} suppressHydrationWarning>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
