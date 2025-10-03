(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;
    var root = document.documentElement;

    var STORAGE_KEY = 'card-theme';

    function safeGet(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, value) {
      try { localStorage.setItem(key, value); } catch (e) {}
    }

    function applyTheme(isDark) {
      if (isDark) root.classList.add('dark');
      else root.classList.remove('dark');
      toggle.setAttribute('aria-pressed', String(isDark));
      var label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      toggle.setAttribute('aria-label', label);
      toggle.title = label;

      // Keep browser chrome consistent with the chosen theme
      var cs = document.querySelector('meta[name="color-scheme"]');
      if (cs) cs.setAttribute('content', isDark ? 'dark' : 'light');
      var tc = document.querySelector('meta[name="theme-color"]');
      if (!tc) { tc = document.createElement('meta'); tc.setAttribute('name', 'theme-color'); document.head.appendChild(tc); }
      tc.setAttribute('content', isDark ? '#0b0b0b' : '#ffffff');
    }

    // Use saved preference if present; otherwise keep whatever the HTML set pre-paint.
    var stored = safeGet(STORAGE_KEY);
    var initialDark = stored ? stored === 'dark' : root.classList.contains('dark');
    applyTheme(initialDark);

    // Toggle on click and persist.
    toggle.addEventListener('click', function () {
      var next = !root.classList.contains('dark');
      applyTheme(next);
      safeSet(STORAGE_KEY, next ? 'dark' : 'light');
    });
  });
})();
