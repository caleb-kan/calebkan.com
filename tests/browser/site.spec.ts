import { expect, test, type Page } from "@playwright/test";
import { mockServices, playing } from "./fixtures";

const WIDTHS = [1440, 1101, 1100, 769, 768, 601, 600, 375, 320];

async function spotifyGeometry(page: Page) {
  return page
    .locator("#spotify-card, #spotify-card *")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          element: element.id || element.className || element.tagName,
          box: element.getBoundingClientRect().toJSON(),
          font: style.font,
          lineHeight: style.lineHeight,
        };
      }),
    );
}

for (const theme of ["dark", "light"]) {
  for (const width of WIDTHS) {
    test(`${theme} layout at ${width}px`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(
        (theme) => localStorage.setItem("card-theme", theme),
        theme,
      );
      await mockServices(page, true);
      await page.goto("/");
      await expect(page.locator("#github-calendar svg")).toBeVisible();
      await expect(page.locator("#spotify-card")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Dark mode" }),
      ).toHaveAttribute("aria-pressed", String(theme === "dark"));
      await expect(page.locator("#github-calendar svg")).toHaveAttribute(
        "viewBox",
        "-2 -2 743 99",
      );
      await expect(page.locator("#spotify-album-art")).toHaveJSProperty(
        "naturalWidth",
        1,
      );
      // Isolate theme geometry from the separate network-loaded icon fonts.
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const main = document
          .querySelector(".card-main")!
          .getBoundingClientRect();
        const spotify = document
          .querySelector(".card-spotify")!
          .getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          stacked: spotify.top >= main.bottom,
          main: {
            x: main.x,
            y: main.y,
            width: main.width,
            height: main.height,
          },
          albumWidth: document
            .querySelector("#spotify-album-art")!
            .getBoundingClientRect().width,
          opacity: getComputedStyle(document.querySelector(".card-main")!)
            .opacity,
          backdrop: getComputedStyle(
            document.querySelector(".card-main")!,
            "::before",
          ).backdropFilter,
        };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.stacked).toBe(width <= 1100);
      expect(geometry.albumWidth).toBe(width <= 600 ? 120 : 160);
      expect(geometry.opacity).toBe("1");
      expect(geometry.backdrop).toContain("blur(16px)");
      const spotifyBefore = await spotifyGeometry(page);
      await page.getByRole("button", { name: "Dark mode" }).click();
      await expect(
        page.getByRole("button", { name: "Dark mode" }),
      ).toHaveAttribute("aria-pressed", String(theme !== "dark"));
      expect(
        await page.locator(".card-main").boundingBox(),
        JSON.stringify({
          spotifyBefore,
          spotifyAfter: await spotifyGeometry(page),
        }),
      ).toEqual(geometry.main);
      await page.getByRole("button", { name: "Dark mode" }).click();
      expect(await page.locator(".card-main").boundingBox()).toEqual(
        geometry.main,
      );
      expect(errors).toEqual([]);
    });
  }
}

test("theme survives reload and blocked storage does not break the toggle", async ({
  page,
}) => {
  await mockServices(page);
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Dark mode" });
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("prerendered portfolio remains available without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.getByRole("heading", { name: "Caleb Kan" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Email calebkan1106@gmail.com" }),
  ).toHaveAttribute("href", "mailto:calebkan1106@gmail.com");
  await expect(page.locator("#spotify-card")).toBeHidden();
  await context.close();
});

test("Spotify appears, updates progress, and rescues focus when playback stops", async ({
  page,
}) => {
  await mockServices(page, true);
  await page.goto("/");
  const title = page.locator("#spotify-title");
  await expect(title).toHaveText(playing.title);
  await expect(title).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "0:31 of 3:00",
  );
  await title.focus();
  await page.route("**/api/now-playing", (route) =>
    route.fulfill({ json: { isPlaying: false } }),
  );
  await expect(page.locator("#spotify-card")).toBeHidden();
  await expect(page.locator("#page-title")).toBeFocused();
});

test("unsafe playback URLs are inert and broken art falls back", async ({
  page,
}) => {
  await mockServices(page);
  await page.route("**/api/now-playing", (route) =>
    route.fulfill({
      json: {
        ...playing,
        songUrl: "javascript:alert(1)",
        albumArt: "https://untrusted.example/cover.png",
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator("#spotify-card")).toBeVisible();
  await expect(page.locator("#spotify-title")).not.toHaveAttribute("href");
  await expect(page.locator("#spotify-album-art")).toHaveAttribute(
    "src",
    /^data:image/,
  );
});

test("long tracks scroll together and reduced motion disables marquee", async ({
  page,
}) => {
  await mockServices(page);
  await page.route("**/api/now-playing", (route) =>
    route.fulfill({
      json: {
        ...playing,
        title:
          "A very long track title that overflows the Spotify card by a considerable amount",
        artist: "A very long artist name that also overflows the Spotify card",
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator("#spotify-title")).toHaveClass(/marquee/);
  const durations = await page
    .locator(".marquee-inner")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).animationDuration),
    );
  expect(durations).toHaveLength(2);
  expect(durations[0]).toBe(durations[1]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#spotify-title")).not.toHaveClass(/marquee/);
  await expect(page.locator("#spotify-title")).toHaveCSS(
    "text-overflow",
    "ellipsis",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("#spotify-title")).toHaveClass(/marquee/);
});

test("Spotify measures long titles when its stylesheet arrives after hydration", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockServices(page);
  await page.route("**/api/now-playing", (route) =>
    route.fulfill({
      json: {
        ...playing,
        // Wide enough to overflow the side card, short enough to fit the
        // stacked card with either macOS or Linux system-font metrics.
        title: "A long track title that overflows the narrow Spotify card",
        artist: "A very long artist name that also overflows the Spotify card",
      },
    }),
  );
  await page.route("**/assets/*.css", async (route) => {
    const stylesheet = await route.fetch();
    // WebKit can execute the preceding module before this render-blocking
    // stylesheet loads. Exercise that ordering without delaying the API.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ response: stylesheet });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
  await expect(page.locator("#spotify-title")).toHaveClass(/marquee/);
  await expect(page.locator("#spotify-artist")).toHaveClass(/marquee/);
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect(page.locator("#spotify-title")).not.toHaveClass(/marquee/);
  await page.setViewportSize({ width: 375, height: 1000 });
  await expect(page.locator("#spotify-title")).toHaveClass(/marquee/);
});

test("OAuth callback preserves exact URL and renders codes safely", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") violations.push(message.text());
  });
  const code = "a+b<img src=x onerror=alert(1)>";
  await page.goto(`/callback.html?code=${encodeURIComponent(code)}`);
  await expect(page.locator("#code")).toHaveText(code);
  await expect(page.locator("#code")).toHaveClass("success");
  expect(new URL(page.url()).pathname).toBe("/callback.html");
  expect(await page.locator("#code img").count()).toBe(0);
  await page.goto("/callback.html?error=access_denied");
  await expect(page.locator("#code")).toHaveText("access_denied");
  await expect(page.locator("#message")).toHaveText(
    "Authorization failed. Check your Spotify app settings and try again.",
  );
  await page.goto("/callback.html");
  await expect(page.locator("#code")).toHaveText("No code found");
  expect(violations).toEqual([]);
});
