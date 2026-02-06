(function () {
  "use strict";

  const cursor = document.getElementById("custom-cursor");
  if (!cursor) return;

  // Only run on devices with fine pointer (desktop/laptop)
  if (!window.matchMedia("(pointer: fine)").matches) return;

  let mouseX = 0;
  let mouseY = 0;
  let cursorX = 0;
  let cursorY = 0;
  let animationId = null;
  let hasMovedOnce = false;

  const EASING = 0.15;
  const SNAP_THRESHOLD = 0.5;

  // Smooth cursor animation loop
  function updateCursor() {
    const dx = mouseX - cursorX;
    const dy = mouseY - cursorY;

    if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
      cursorX = mouseX;
      cursorY = mouseY;
      cursor.style.transform =
        "translate(" + cursorX + "px, " + cursorY + "px) translate(-50%, -50%)";
      animationId = null;
      return;
    }

    cursorX += dx * EASING;
    cursorY += dy * EASING;
    cursor.style.transform =
      "translate(" + cursorX + "px, " + cursorY + "px) translate(-50%, -50%)";
    animationId = requestAnimationFrame(updateCursor);
  }

  function startAnimation() {
    if (!animationId && document.visibilityState === "visible") {
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
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      // Only restart if cursor was already active (user has moved mouse)
      if (hasMovedOnce) {
        startAnimation();
      }
    } else {
      stopAnimation();
    }
  });

  // Track mouse position
  document.addEventListener(
    "mousemove",
    function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;

      if (!hasMovedOnce) {
        hasMovedOnce = true;
        cursorX = mouseX;
        cursorY = mouseY;
        document.body.classList.add("cursor-active");
      }

      startAnimation();
    },
    { passive: true },
  );

  // Handle hover states using event delegation
  function getClickableAncestor(el) {
    if (!el || typeof el.closest !== "function") return null;
    return el.closest(
      'a,button,input,textarea,select,[role="button"],[onclick]',
    );
  }

  document.body.addEventListener(
    "pointerover",
    function (e) {
      const entering = getClickableAncestor(e.target);
      if (!entering) return;
      const from = getClickableAncestor(e.relatedTarget);
      if (entering !== from) {
        document.body.classList.add("cursor-hover");
      }
    },
    true,
  );

  document.body.addEventListener(
    "pointerout",
    function (e) {
      const leaving = getClickableAncestor(e.target);
      if (!leaving) return;
      const to = getClickableAncestor(e.relatedTarget);
      if (leaving !== to) {
        document.body.classList.remove("cursor-hover");
      }
    },
    true,
  );
})();
