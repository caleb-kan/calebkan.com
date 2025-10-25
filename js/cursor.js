(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var cursor = document.getElementById('custom-cursor');
    if (!cursor) return;

    // Only run on devices with fine pointer (desktop/laptop)
    if (!window.matchMedia('(pointer: fine)').matches) return;

    var mouseX = 0;
    var mouseY = 0;
    var cursorX = 0;
    var cursorY = 0;

    // Smooth cursor animation loop
    function updateCursor() {
      cursorX += (mouseX - cursorX) * 0.15;
      cursorY += (mouseY - cursorY) * 0.15;
      cursor.style.transform = 'translate(' + cursorX + 'px, ' + cursorY + 'px) translate(-50%, -50%)';
      requestAnimationFrame(updateCursor);
    }

    // Track mouse position
    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    // Check if element is clickable
    function isClickable(el) {
      var tags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'];
      return tags.includes(el.tagName) ||
             el.getAttribute('role') === 'button' ||
             el.hasAttribute('onclick');
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

    updateCursor();
  });
})();
