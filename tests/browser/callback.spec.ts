import { expect, test } from "@playwright/test";

for (const width of [320, 375]) {
  test(`authorization content reflows with enlarged text at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 450 });
    const exampleCode = `example-${"a".repeat(300)}`;
    await page.goto(`/callback.html?code=${encodeURIComponent(exampleCode)}`);
    await expect(page.locator("#code")).toHaveText(exampleCode);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect(page.locator("body")).toHaveCSS("font-size", "32px");

    const geometry = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      content: Array.from(
        document.querySelectorAll("main, h1, p, code"),
        (element) => {
          const { left, right } = element.getBoundingClientRect();
          return { left, right };
        },
      ),
    }));
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    for (const { left, right } of geometry.content) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(geometry.viewportWidth);
    }
  });
}
