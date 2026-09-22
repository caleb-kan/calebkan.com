import { expect, test } from "@playwright/test";
import { mockServices } from "./fixtures";

const MINIMUM_TEXT_CONTRAST = 4.5;
const GRADIENT_SAMPLE_TIMES = [0, 5000, 10000, 15000];
const TEXT_TARGETS = [
  { name: "Email link", selector: 'a[href^="mailto:"]' },
  { name: "Spotify title", selector: "#spotify-title" },
  { name: "Spotify artist", selector: "#spotify-artist" },
  { name: "Spotify heading", selector: "#spotify-heading span" },
];

function luminance(color: readonly number[]): number {
  const linear = color.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

test("enlarged text reflows within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await mockServices(page, true);
  await page.goto("/");
  await expect(page.locator("#spotify-card")).toBeVisible();
  await page.evaluate(async () => {
    for (const element of document.querySelectorAll("*")) {
      if (element instanceof HTMLElement || element instanceof SVGElement) {
        element.style.transition = "none";
      }
    }
    document.documentElement.style.fontSize = "200%";
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(page.locator("body")).toHaveCSS("font-size", "32px");
  await expect(page.locator('a[href^="mailto:"]')).toHaveCSS(
    "font-size",
    "32px",
  );
  const geometry = await page.evaluate(() => {
    const card = document.querySelector(".card-main");
    const email = document.querySelector('a[href^="mailto:"]');
    if (!card || !email) throw new Error("The contact card must be present");
    const cardBounds = card.getBoundingClientRect();
    const emailBounds = email.getBoundingClientRect();
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      cardLeft: cardBounds.left,
      cardRight: cardBounds.right,
      emailLeft: emailBounds.left,
      emailRight: emailBounds.right,
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.emailLeft).toBeGreaterThanOrEqual(geometry.cardLeft);
  expect(geometry.emailRight).toBeLessThanOrEqual(geometry.cardRight);
});

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 375]) {
    test(`${theme} text has sufficient contrast over the glass gradient at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(
        (savedTheme) => localStorage.setItem("card-theme", savedTheme),
        theme,
      );
      await mockServices(page, true);
      await page.goto("/");
      await expect(page.locator("#spotify-card")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      for (const time of GRADIENT_SAMPLE_TIMES) {
        const samples = await page.evaluate(
          async ({ time, targets }) => {
            const gradient = document.body.getAnimations()[0];
            if (!gradient)
              throw new Error("The background gradient must animate");
            gradient.pause();
            gradient.currentTime = time;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );

            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d");
            if (!context)
              throw new Error("Canvas is required to resolve CSS colors");

            return targets.map(({ name, selector }) => {
              const element = document.querySelector<HTMLElement>(selector);
              if (!element) throw new Error(`Missing text target: ${name}`);
              // Preserve the text's box while removing its glyphs. Capturing the
              // real pixels includes the gradient, translucency, and backdrop blur.
              element.style.transition = "none";
              const color = getComputedStyle(element).color;
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              const rgba = Array.from(context.getImageData(0, 0, 1, 1).data);
              let opacity = rgba[3] / 255;
              for (
                let ancestor: HTMLElement | null = element;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                opacity *= Number(getComputedStyle(ancestor).opacity);
              }
              const rect = element.getBoundingClientRect();
              const previousColor = element.style.getPropertyValue("color");
              const previousPriority =
                element.style.getPropertyPriority("color");
              element.style.setProperty("color", "transparent", "important");
              return {
                name,
                selector,
                foreground: rgba.slice(0, 3),
                opacity,
                x: Math.floor(rect.x + rect.width / 2),
                y: Math.floor(rect.y + rect.height / 2),
                previousColor,
                previousPriority,
              };
            });
          },
          { time, targets: TEXT_TARGETS },
        );

        const screenshot = await page.screenshot({ scale: "css" });
        const colors = await page.evaluate(
          async ({ bytes, samples }) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: "image/png" }),
            );
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d");
            if (!context)
              throw new Error("Canvas is required to sample screenshots");
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            return samples.map((sample) => {
              if (
                sample.x < 0 ||
                sample.y < 0 ||
                sample.x >= canvas.width ||
                sample.y >= canvas.height
              ) {
                throw new Error(`${sample.name} must be inside the screenshot`);
              }
              const background = Array.from(
                context.getImageData(sample.x, sample.y, 1, 1).data,
              ).slice(0, 3);
              const element = document.querySelector<HTMLElement>(
                sample.selector,
              );
              element?.style.setProperty(
                "color",
                sample.previousColor,
                sample.previousPriority,
              );
              const foreground = sample.foreground.map(
                (channel, index) =>
                  channel * sample.opacity +
                  background[index] * (1 - sample.opacity),
              );
              return { name: sample.name, foreground, background };
            });
          },
          { bytes: Array.from(screenshot), samples },
        );

        for (const { name, foreground, background } of colors) {
          const foregroundLuminance = luminance(foreground);
          const backgroundLuminance = luminance(background);
          const ratio =
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
          expect
            .soft(
              ratio,
              `${name}: ${ratio.toFixed(2)}:1 at gradient time ${time / 1000}s`,
            )
            .toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
        }
      }
    });
  }
}
