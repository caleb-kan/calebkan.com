(function () {
  "use strict";

  // Synchronous FOUC-prevention script. Uses var for maximum compatibility.
  // STORAGE_KEY, DARK_COLOR, LIGHT_COLOR must match theme-toggle.js.
  var STORAGE_KEY = "card-theme";
  var DARK_COLOR = "#0b0b0b";
  var LIGHT_COLOR = "#ffffff";
  var root = document.documentElement;
  var cs = document.querySelector('meta[name="color-scheme"]');
  var tc = document.querySelector('meta[name="theme-color"]');
  if (!tc) {
    tc = document.createElement("meta");
    tc.setAttribute("name", "theme-color");
    document.head.appendChild(tc);
  }

  var saved;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn("theme-boot: localStorage unavailable:", e);
  }
  var isDark = saved !== "light";
  root.classList.toggle("dark", isDark);
  if (cs) cs.setAttribute("content", isDark ? "dark" : "light");
  tc.setAttribute("content", isDark ? DARK_COLOR : LIGHT_COLOR);
})();
