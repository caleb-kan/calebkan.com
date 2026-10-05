import { expect, test } from "@playwright/test";
import { mockServices } from "./fixtures";

const LAYOUTS = [
  { width: 1440, textSize: "100%" },
  { width: 1100, textSize: "100%" },
  { width: 768, textSize: "100%" },
  { width: 600, textSize: "100%" },
  { width: 375, textSize: "100%" },
  { width: 320, textSize: "100%" },
  { width: 320, textSize: "200%" },
];

for (const theme of ["dark", "light"]) {
  for (const { width, textSize } of LAYOUTS) {
    test(`Spotify alignment and equal spacing at ${width}px with ${textSize} text in ${theme} mode`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({
        reducedMotion: textSize === "200%" ? "no-preference" : "reduce",
      });
      await page.addInitScript(
        (theme) => localStorage.setItem("card-theme", theme),
        theme,
      );
      await mockServices(page, true);
      await page.goto("/");
      await expect(page.locator("#spotify-card")).toBeVisible();
      await page.evaluate(async (size) => {
        document.documentElement.style.fontSize = size;
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, textSize);
      if (textSize === "200%") {
        await expect(
          page.getByRole("button", { name: "Pause text or resume text" }),
        ).toBeVisible();
      }

      const layout = await page.evaluate(() => {
        function bounds(selector: string) {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing player content: ${selector}`);
          return element.getBoundingClientRect();
        }
        const heading = bounds(".spotify-header");
        const logo = bounds(".spotify-icon path");
        const details = bounds(".spotify-info");
        const title = bounds("#spotify-title");
        const artist = bounds("#spotify-artist");
        const progress = bounds(".spotify-progress-container");
        return {
          // Measure the visible logo, not the SVG viewport's empty padding.
          leftEdges: [heading.left, logo.left, artist.left, progress.left],
          titleLeft: title.left,
          aboveDetails: details.top - heading.bottom,
          belowDetails: progress.top - details.bottom,
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

      for (const left of layout.leftEdges) {
        expect(Math.abs(left - layout.titleLeft)).toBeLessThanOrEqual(0.5);
      }
      expect(layout.aboveDetails).toBeGreaterThan(0);
      expect(
        Math.abs(layout.aboveDetails - layout.belowDetails),
      ).toBeLessThanOrEqual(0.5);
      expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
    });
  }
}
