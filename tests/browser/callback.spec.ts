import { expect, test, type Request } from "@playwright/test";

test("authorization credentials are not sent as resource referrers", async ({
  page,
}) => {
  const resources: Request[] = [];
  page.on("request", (request) => {
    if (request.resourceType() !== "document") {
      resources.push(request);
    }
  });
  await page.goto("/callback.html?code=example-code&state=example-state");
  await expect(page.locator("#code")).toHaveText("example-code");
  // Chromium's early request event can report an empty Referer even when it
  // is omitted on the wire. Await the complete transmitted headers instead.
  const resourceReferrers = await Promise.all(
    resources.map(async (request) => ({
      url: request.url(),
      referrer: (await request.allHeaders()).referer,
    })),
  );
  expect(resourceReferrers.length).toBeGreaterThan(0);
  for (const { url, referrer } of resourceReferrers) {
    expect(
      referrer,
      `Resource ${url} must omit its Referer header`,
    ).toBeUndefined();
  }
  expect(new URL(page.url()).pathname).toBe("/callback.html");
});

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
