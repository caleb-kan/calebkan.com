(() => {
  // With `defer` on the script tag, DOM is ready here.
  const toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;
  const root = document.documentElement;

  const STORAGE_KEY = 'card-theme';

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function applyTheme(isDark) {
    root.classList.toggle('dark', isDark);
    toggle.setAttribute('aria-pressed', String(isDark));
    const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }

  // Use saved preference if present; otherwise keep whatever the HTML set pre-paint.
  const stored = safeGet(STORAGE_KEY);
  const initialDark = stored ? stored === 'dark' : root.classList.contains('dark');
  applyTheme(initialDark);

  // Toggle on click and persist.
  toggle.addEventListener('click', () => {
    const next = !root.classList.contains('dark');
    applyTheme(next);
    safeSet(STORAGE_KEY, next ? 'dark' : 'light');
  });
})();
