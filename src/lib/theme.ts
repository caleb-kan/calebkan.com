export const STORAGE_KEY = "card-theme";
export const DARK_COLOR = "#0b0b0b";
export const LIGHT_COLOR = "#ffffff";

export function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle("dark", isDark);
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", isDark ? "dark" : "light");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", isDark ? DARK_COLOR : LIGHT_COLOR);
}
