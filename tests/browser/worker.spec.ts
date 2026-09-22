import { expect, test } from "@playwright/test";

test("production asset boundary rejects source, credentials, and unknown paths", async ({
  request,
}) => {
  for (const path of [
    "/.dev.vars",
    "/.env",
    "/src/app.tsx",
    "/worker/index.ts",
    "/api/types.ts",
    "/package.json",
    "/wrangler.jsonc",
    "/unknown-page",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
  }
  for (const path of [
    "/",
    "/index.html",
    "/callback.html",
    "/favicon/favicon.png",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-security-policy"], path).toBe(
      "frame-ancestors 'none'",
    );
    expect(response.headers()["x-frame-options"], path).toBe("DENY");
  }
});

test("production API routes retain method restrictions and CORS", async ({
  request,
}) => {
  for (const path of ["/api/github-contributions", "/api/now-playing"]) {
    const response = await request.post(path);
    expect(response.status()).toBe(405);
    expect(response.headers()["allow"]).toBe("GET");
    expect(response.headers()["access-control-allow-origin"]).toBe(
      "https://www.calebkan.com",
    );
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  }
});
