import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { getViewer } from "@/server/viewer";

/**
 * Every signed-in page lives under this layout. A layout does not re-run on client navigation, so this is NOT
 * the access check: each page and route handler still calls requirePage / requireApi itself.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <Shell viewer={viewer} theme={theme}>
      {children}
    </Shell>
  );
}
