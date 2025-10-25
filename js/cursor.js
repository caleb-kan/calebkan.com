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

    var mouseX = 0;
    var mouseY = 0;
    var cursorX = 0;
    var cursorY = 0;

    // Smooth cursor follow effect using requestAnimationFrame
    function updateCursor() {
      // Easing for smooth trailing effect
      var ease = 0.15;
      cursorX += (mouseX - cursorX) * ease;
      cursorY += (mouseY - cursorY) * ease;

      cursor.style.transform = 'translate(' + cursorX + 'px, ' + cursorY + 'px) translate(-50%, -50%)';

      requestAnimationFrame(updateCursor);
    }

    // Track mouse position
    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    // Handle hover states for clickable elements
    var clickableSelectors = 'a, button, [role="button"], input, textarea, select, [onclick]';
    var clickableElements = document.querySelectorAll(clickableSelectors);

    clickableElements.forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        document.body.classList.add('cursor-hover');
      });

      el.addEventListener('mouseleave', function () {
        document.body.classList.remove('cursor-hover');
      });
    });

    // Hide cursor when mouse leaves the window
    document.addEventListener('mouseleave', function () {
      cursor.style.opacity = '0';
    });

    document.addEventListener('mouseenter', function () {
      cursor.style.opacity = '1';
    });

    // Start the animation loop
    updateCursor();
  });
})();
