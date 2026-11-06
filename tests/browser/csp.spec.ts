import { expect, test } from "@playwright/test";
import { mockServices } from "./fixtures";

for (const path of ["/", "/index.html", "/callback.html?code=csp-test"]) {
  test(`${path} returns fresh CSP nonces for conditional HTML requests`, async ({
    request,
  }) => {
    const first = await request.get(path);
    const second = await request.get(path, {
      headers: {
        "If-None-Match": '"previous-document"',
        "If-Modified-Since": "Mon, 21 Sep 2026 12:00:00 GMT",
      },
    });
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    const firstPolicy = first.headers()["content-security-policy"];
    const secondPolicy = second.headers()["content-security-policy"];
    expect(firstPolicy).toMatch(/script-src 'self' 'nonce-[\w-]+'/);
    expect(secondPolicy).not.toBe(firstPolicy);
    expect(second.headers()["cache-control"]).toBe("private, no-store");
    expect(second.headers()["etag"]).toBeUndefined();
    expect(second.headers()["last-modified"]).toBeUndefined();
    expect(await second.text()).toContain("<!doctype html>");
  });
}

for (const path of ["/", "/callback.html?code=csp-test"]) {
  test(`${path} permits the response nonce and blocks other inline scripts`, async ({
    page,
  }) => {
    await mockServices(page);
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        document.documentElement.dataset.cspViolation = event.violatedDirective;
      });
    });
    await page.route(
      (url) => url.pathname === path.split("?")[0],
      async (route) => {
        const response = await route.fetch();
        const nonce = response
          .headers()
          ["content-security-policy"].match(/'nonce-([\w-]+)'/)?.[1];
        expect(nonce).toBeTruthy();
        const html = await response.text();
        await route.fulfill({
          response,
          body: html.replace(
            "</head>",
            `<script nonce="${nonce}">document.documentElement.dataset.cspAuthorized = "yes";</script>
             <script>document.documentElement.dataset.cspBlocked = "yes";</script></head>`,
          ),
        });
      },
    );
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute(
      "data-csp-authorized",
      "yes",
    );
    await expect(page.locator("html")).not.toHaveAttribute("data-csp-blocked");
    await expect(page.locator("html")).toHaveAttribute(
      "data-csp-violation",
      /^script-src/,
    );
    if (path.startsWith("/callback.html")) {
      await expect(page.locator("#code")).toHaveText("csp-test");
      await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
        "content",
        "no-referrer",
      );
    } else {
      await expect(
        page.getByRole("heading", { name: "Caleb Kan" }),
      ).toBeVisible();
    }
  });
}
