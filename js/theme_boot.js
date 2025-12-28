(function() {
  'use strict';

  var root = document.documentElement;
  var cs = document.querySelector('meta[name="color-scheme"]');
  var tc = document.querySelector('meta[name="theme-color"]');
  if (!tc) {
    tc = document.createElement('meta');
    tc.setAttribute('name', 'theme-color');
    document.head.appendChild(tc);
  }

  try {
    var saved = localStorage.getItem('card-theme');
    var isDark = saved !== 'light';
    root.classList.toggle('dark', isDark);
    if (cs) cs.setAttribute('content', isDark ? 'dark' : 'light');
    tc.setAttribute('content', isDark ? '#0b0b0b' : '#ffffff');
  } catch (_) {
    root.classList.add('dark');
    if (cs) cs.setAttribute('content', 'dark');
    tc.setAttribute('content', '#0b0b0b');
  }
})();
