"use client";

import { useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { Icon } from "@/components/ui/Icon";

const ORDER: Theme[] = ["system", "light", "dark"];

/**
 * Cycles light, dark and system. The choice is stored in the god_theme cookie, which the server reads to render
 * <html data-theme>, so the right theme paints first time with no flash. The attribute is also set here, so the
 * change shows at once without waiting for a round trip.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  const next = () => {
    const t = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? "system";
    document.documentElement.setAttribute("data-theme", t);
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
    setTheme(t);
  };

  return (
    <button type="button" className="nav" onClick={next} aria-label={`Theme: ${theme}. Change theme.`}>
      <Icon name="sun" />
      <span className="lbl">Theme: {theme}</span>
    </button>
  );
}
