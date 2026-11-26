// Theme toggle and mobile menu. Loaded on every page as an external module.
import { THEME_KEY } from "../lib/site";

const root = document.documentElement;
const dark = window.matchMedia("(prefers-color-scheme: dark)");

function isDark(): boolean {
  const t = root.getAttribute("data-theme");
  return t ? t === "dark" : dark.matches;
}

// Theme. The head script has already applied any saved choice; this wires the button.
const themeBtn = document.getElementById("themebtn");
function labelTheme(): void {
  if (!themeBtn) return;
  themeBtn.dataset.mode = isDark() ? "dark" : "light";
  themeBtn.setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme");
}
themeBtn?.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage can be blocked. The choice still applies for this visit.
  }
  labelTheme();
});
dark.addEventListener("change", labelTheme);
labelTheme();

// Menu.
const nav = document.getElementById("nav");
const menuBtn = document.getElementById("menubtn");
function setMenu(open: boolean): void {
  if (!nav || !menuBtn) return;
  nav.classList.toggle("open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.textContent = open ? "Close" : "Menu";
}
menuBtn?.addEventListener("click", () => setMenu(!nav?.classList.contains("open")));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && nav?.classList.contains("open")) {
    setMenu(false);
    menuBtn?.focus();
  }
});
