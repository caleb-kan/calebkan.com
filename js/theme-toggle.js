(() => {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(() => {
    const card = document.getElementById('card');
    const toggle = document.querySelector('.theme-toggle');
    if (!card || !toggle) return;

    const STORAGE_KEY = 'card-theme';

    function updateToggleA11y(isDark) {
      const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
    }

    function setDarkMode(enabled) {
      card.classList.toggle('dark', enabled);
      toggle.setAttribute('aria-pressed', String(enabled));
      updateToggleA11y(enabled);
    }

    // Load saved preference or default to dark on first visit
    const saved = localStorage.getItem(STORAGE_KEY);
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    // Default to dark when no saved preference exists
    const initialDark = saved ? saved === 'dark' : true;
    setDarkMode(initialDark);

    // Toggle on click
    toggle.addEventListener('click', () => {
      const next = !card.classList.contains('dark');
      setDarkMode(next);
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      } catch (_) {
        // ignore storage errors (e.g., Safari private mode)
      }
    });

    // If user has not set a preference, follow system changes in real time
    function handleSystemChange(e) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return; // user preference takes precedence
      setDarkMode(e.matches);
    }
    if (media) {
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handleSystemChange);
      } else if (typeof media.addListener === 'function') {
        media.addListener(handleSystemChange);
      }
    }
  });
})();
