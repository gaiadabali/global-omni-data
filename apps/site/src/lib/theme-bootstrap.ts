/**
 * The one inline script on every page. It runs in <head> before first paint, so a saved theme never
 * flashes the wrong colours, and it marks the page as script-enabled so the menu and theme button show.
 * Its sha256 is listed in SECURITY-HEADERS.md, and a test keeps the two in step.
 */
export const themeBootstrap =
  "(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('god-theme');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);}catch(e){}})();";
