(function () {
  "use strict";

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
    saved = localStorage.getItem("card-theme");
  } catch (e) {
    console.warn("theme-boot: localStorage unavailable:", e);
  }
  var isDark = saved !== "light";
  root.classList.toggle("dark", isDark);
  if (cs) cs.setAttribute("content", isDark ? "dark" : "light");
  tc.setAttribute("content", isDark ? DARK_COLOR : LIGHT_COLOR);
})();
