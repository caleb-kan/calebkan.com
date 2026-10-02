import { useLayoutEffect, useState } from "react";
import { applyTheme, STORAGE_KEY } from "../lib/theme";
import { Icon } from "./icon";

export function ThemeToggle() {
  // Match prerendered HTML on the first render, then adopt the boot decision
  // before paint. Reading localStorage again could change that decision.
  const [isDark, setIsDark] = useState(true);
  useLayoutEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    applyTheme(next);
    setIsDark(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch (error) {
      console.warn("theme-toggle: could not save preference:", error);
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label="Dark mode"
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
    >
      <Icon icon={faSun} className="icon sun" />
      <Icon icon={faMoon} className="icon moon" />
      <span className="thumb" aria-hidden="true" />
    </button>
  );
}
import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
