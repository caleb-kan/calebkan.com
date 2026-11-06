import { expect, test } from "@playwright/test";
import { mockServices } from "./fixtures";

test("callback permits same-origin detection and blocks foreign connections", async ({
  page,
}) => {
  let detectionRequested = false;
  let foreignRequested = false;
  await page.route("**/cdn-cgi/challenge-platform/test", async (route) => {
    detectionRequested = true;
    await route.fulfill({ body: "accepted" });
  });
  await page.route("https://untrusted.example/**", async (route) => {
    foreignRequested = true;
    await route.fulfill({
      body: "foreign",
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.blockedURI.startsWith("https://untrusted.example")) {
        document.documentElement.dataset.connectionViolation =
          event.violatedDirective;
      }
    });
  });
  await page.goto("/callback.html?code=csp-test");
  const connections = await page.evaluate(async () =>
    Promise.all(
      [
        "/cdn-cgi/challenge-platform/test",
        "https://untrusted.example/detection",
      ].map((url) =>
        fetch(url).then(
          (response) => response.text(),
          () => "blocked",
        ),
      ),
    ),
  );
  expect(connections).toEqual(["accepted", "blocked"]);
  expect(detectionRequested).toBe(true);
  expect(foreignRequested).toBe(false);
  await expect(page.locator("html")).toHaveAttribute(
    "data-connection-violation",
    "connect-src",
  );
  await expect(page.locator("#code")).toHaveText("csp-test");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );
});

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
