import { DARK_COLOR, LIGHT_COLOR, STORAGE_KEY } from "./lib/theme";

// Compiled separately as a synchronous classic script before any stylesheet.
// Never access the React root or toggle here: the body has not been parsed.
var root = document.documentElement;
var cs = document.querySelector('meta[name="color-scheme"]');
var tc = document.querySelector('meta[name="theme-color"]');
if (!tc) {
  tc = document.createElement("meta");
  tc.setAttribute("name", "theme-color");
  document.head.appendChild(tc);
}
var saved: string | null | undefined;
try {
  saved = localStorage.getItem(STORAGE_KEY);
} catch (error) {
  console.warn("theme-boot: localStorage unavailable:", error);
}
var isDark = saved !== "light";
root.classList.toggle("dark", isDark);
if (cs) cs.setAttribute("content", isDark ? "dark" : "light");
tc.setAttribute("content", isDark ? DARK_COLOR : LIGHT_COLOR);
