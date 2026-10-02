import { expect, test } from "@playwright/test";
import { FIXED_TIME, contributions, mockServices } from "./fixtures";

test("calendar timeout replaces loading text and recovers without shifting the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await mockServices(page);
  // This test needs Date to advance with timers so request-time compensation
  // reaches the next poll exactly sixty seconds after the initial request.
  await page.clock.setSystemTime(FIXED_TIME);
  await page.route("**/api/github-contributions", () => {});
  await page.goto("/");
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await expect(page.locator("#github-calendar")).toHaveText(
    "Loading contributions...",
  );
  await page.clock.runFor(5000);
  await expect(page.locator("#github-calendar")).toHaveText(
    "Unable to display contributions",
  );
  const failedGeometry = await page.locator(".card-main").boundingBox();
  await page.route("**/api/github-contributions", (route) =>
    route.fulfill({ json: contributions }),
  );
  await page.clock.runFor(55_000);
  await expect(page.locator("#github-calendar svg")).toBeVisible();
  expect(await page.locator(".card-main").boundingBox()).toEqual(
    failedGeometry,
  );
});

test("calendar exposes a contribution summary from the displayed data", async ({
  page,
}) => {
  await mockServices(page);
  await page.route("**/api/github-contributions", (route) =>
    route.fulfill({
      json: {
        contributions: [
          { date: "2026-09-21", count: 1 },
          { date: "2026-09-22", count: 3 },
        ],
      },
    }),
  );
  await page.goto("/");
  const calendar = page.getByRole("img", {
    name: "GitHub contribution calendar",
  });
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAccessibleDescription(
    /^4 contributions across 2 active days, from .* to 2026-09-22\.$/,
  );
});
