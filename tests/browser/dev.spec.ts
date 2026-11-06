import { expect, test } from "@playwright/test";
import { mockServices } from "./fixtures";

test.use({
  baseURL: "http://127.0.0.1:8788",
  // WebKit screenshot preparation injects an inline style during teardown,
  // producing its own CSP violation. Retained traces still diagnose failures.
  screenshot: "off",
});

for (const path of ["/", "/callback.html?code=development-test-code"]) {
  test(`${path} development CSP permits the Vite HMR connection`, async ({
    page,
  }) => {
    const errors: string[] = [];
    await mockServices(page);
    let connected = false;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        const message: unknown = JSON.parse(payload.toString());
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "connected"
        ) {
          connected = true;
        }
      });
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        console.error(`CSP violation: ${event.violatedDirective}`);
      });
    });

    await page.goto(path);
    if (path.startsWith("/callback.html")) {
      await expect(page.locator("#code")).toHaveText("development-test-code");
    } else {
      await expect(
        page.getByRole("heading", { name: "Caleb Kan" }),
      ).toBeVisible();
    }
    await expect.poll(() => connected).toBe(true);
    expect(errors).toEqual([]);
  });
}
