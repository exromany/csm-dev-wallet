// Apply the persisted theme to <html> before paint, avoiding a flash of the
// wrong theme on popup open. Imported as the first side-effect in main.tsx so
// it runs before style.css evaluates and before React mounts.
//
// Used to be an inline <script> in index.html, but MV3's default extension_pages
// CSP forbids inline scripts and no 'unsafe-inline' is allowed.

export const THEME_KEY = 'csm-wallet-theme';

try {
  const t = localStorage.getItem(THEME_KEY);
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
  }
} catch {
  // localStorage unavailable (private mode, blocked storage) — stay with the
  // default data-theme already set on the <html> element.
}
