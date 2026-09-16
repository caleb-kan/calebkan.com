(function () {
  "use strict";

  const toggle = document.querySelector(".theme-toggle");
  if (!toggle) {
    console.warn("theme-toggle: .theme-toggle element not found");
    return;
  }
  const root = document.documentElement;

  // Must match corresponding values in theme-boot.js
  const STORAGE_KEY = "card-theme";
  const DARK_COLOR = "#0b0b0b";
  const LIGHT_COLOR = "#ffffff";

  const csMeta = document.querySelector('meta[name="color-scheme"]');
  const tcMeta = document.querySelector('meta[name="theme-color"]');

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("theme-toggle: could not save preference:", e);
    }
  }

  function applyTheme(isDark) {
    root.classList.toggle("dark", isDark);
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";

    if (csMeta) csMeta.setAttribute("content", isDark ? "dark" : "light");
    if (tcMeta)
      tcMeta.setAttribute("content", isDark ? DARK_COLOR : LIGHT_COLOR);
  }

  // theme-boot.js already resolved storage before first paint. Keep that decision
  // so a stale or invalid preference cannot switch themes during initialization.
  applyTheme(root.classList.contains("dark"));

  // Toggle on click and persist.
  toggle.addEventListener("click", function () {
    const next = !root.classList.contains("dark");
    applyTheme(next);
    safeSet(STORAGE_KEY, next ? "dark" : "light");
  });
})();
