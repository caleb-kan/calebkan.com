(function() {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function() {
    const container = document.getElementById('particles-js');
    if (!container) return;

    if (typeof particlesJS === 'function') {
      particlesJS.load('particles-js', 'particles.json', function() {
        // Particles loaded successfully
      });
    } else {
      console.warn('particles.js library not loaded');
    }
  });
})();
