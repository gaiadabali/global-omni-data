// Theme toggle, mobile menu, scroll reveals and the one-time count-up. Loaded on every page as an external
// module. Everything here is an enhancement: without it the page is complete and still.
import { THEME_KEY } from "../lib/site";

const root = document.documentElement;
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

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
const menuLabel = document.getElementById("menulabel");
function setMenu(open: boolean): void {
  if (!nav || !menuBtn) return;
  nav.classList.toggle("open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  if (menuLabel) menuLabel.textContent = open ? "Close" : "Menu";
}
menuBtn?.addEventListener("click", () => setMenu(!nav?.classList.contains("open")));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && nav?.classList.contains("open")) {
    setMenu(false);
    menuBtn?.focus();
  }
});

// Count-up: a figure with data-count rises from 0 to its value once, over about a second.
function countUp(el: HTMLElement): void {
  const end = Number(el.dataset.count);
  const pre = el.dataset.pre ?? "";
  if (!Number.isFinite(end) || calm.matches) return;
  const start = performance.now();
  const ms = 900;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${pre}${Math.round(end * eased)}`;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Reveals: [data-reveal] elements get .in once, when a little of them is on screen. CSS does the motion and
// only when the visitor allows it (global.css). Without IntersectionObserver everything shows at once.
const targets = document.querySelectorAll<HTMLElement>("[data-reveal], [data-count]");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.classList.add("in");
        if (el.dataset.count) countUp(el);
        io.unobserve(el);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  targets.forEach((el) => io.observe(el));
} else {
  targets.forEach((el) => el.classList.add("in"));
}
