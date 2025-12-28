(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    const cursor = document.getElementById('custom-cursor');
    if (!cursor) return;

    // Only run on devices with fine pointer (desktop/laptop)
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let mouseX = 0;
    let mouseY = 0;
    let cursorX = 0;
    let cursorY = 0;
    let animationId = null;

    // Smooth cursor animation loop
    function updateCursor() {
      cursorX += (mouseX - cursorX) * 0.15;
      cursorY += (mouseY - cursorY) * 0.15;
      cursor.style.transform = 'translate(' + cursorX + 'px, ' + cursorY + 'px) translate(-50%, -50%)';
      animationId = requestAnimationFrame(updateCursor);
    }

    function startAnimation() {
      if (!animationId && document.visibilityState === 'visible') {
        animationId = requestAnimationFrame(updateCursor);
      }
    }

    function stopAnimation() {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    }

    // Pause animation when tab is hidden to save CPU
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        startAnimation();
      } else {
        stopAnimation();
      }
    });

    // Track mouse position
    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    // Check if element or its ancestors are clickable
    function isClickable(el) {
      const selector = 'a,button,input,textarea,select,[role="button"],[onclick]';
      return el && typeof el.closest === 'function' ? Boolean(el.closest(selector)) : false;
    }

    // Handle hover states using event delegation
    document.body.addEventListener('mouseenter', function (e) {
      if (isClickable(e.target)) {
        document.body.classList.add('cursor-hover');
      }
    }, true);

    document.body.addEventListener('mouseleave', function (e) {
      if (isClickable(e.target)) {
        document.body.classList.remove('cursor-hover');
      }
    }, true);

    startAnimation();
  });
})();
