import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAssets } from "../scripts/build-assets.mjs";
import worker from "../worker/index.js";

const ORIGIN = "https://www.calebkan.com";
const GITHUB_PATH = "/api/github-contributions";
const SPOTIFY_PATH = "/api/now-playing";
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-XSS-Protection": "0",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
};
const SECRETS = {
  GITHUB_TOKEN: "test-github-token",
  SPOTIFY_CLIENT_ID: "test-client",
  SPOTIFY_CLIENT_SECRET: "test-secret",
  SPOTIFY_REFRESH_TOKEN: "test-refresh",
};

function githubData(count = 3) {
  return Response.json({
    data: {
      user: {
        contributionsCollection: {
          contributionCalendar: {
            weeks: [
              {
                contributionDays: [
                  { date: "2026-09-21", contributionCount: count },
                ],
              },
            ],
          },
        },
      },
    },
  });
}

function assertHeaders(response, isApi = false) {
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), expected, name);
  }
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    isApi ? ORIGIN : null,
  );
  if (isApi) assert.equal(response.headers.get("Vary"), "Origin");
}

// A two-hour step expires both APIs' warm-instance state between tests while
// keeping requests within a test on the same real Worker module instance.
let testTime = Date.UTC(2026, 8, 21);
function setup(t, fetcher = async () => githubData()) {
  testTime += 2 * 60 * 60 * 1000;
  t.mock.timers.enable({ apis: ["Date"], now: testTime });
  t.mock.method(globalThis, "fetch", fetcher);
  t.mock.method(console, "error", () => {});
  const entries = new Map();
  const reads = [];
  const writes = [];
  const cache = {
    async match(key) {
      reads.push(key.url);
      const entry = entries.get(key.url);
      return entry && entry.expiresAt > Date.now()
        ? entry.response.clone()
        : undefined;
    },
    async put(key, response) {
      writes.push(key.url);
      const seconds = Number(
        response.headers.get("Cache-Control").match(/s-maxage=(\d+)/)?.[1],
      );
      entries.set(key.url, {
        response: response.clone(),
        expiresAt: Date.now() + seconds * 1000,
      });
    },
  };
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: cache },
  });
  t.after(() => {
    if (originalCaches) {
      Object.defineProperty(globalThis, "caches", originalCaches);
    } else {
      delete globalThis.caches;
    }
  });
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const env = {
    ...SECRETS,
    ASSETS: {
      async fetch() {
        throw new Error("Unexpected static asset request");
      },
    },
  };
  return {
    env,
    cache,
    entries,
    reads,
    writes,
    fetch: (path, options) =>
      worker.fetch(new Request(new URL(path, ORIGIN), options), env, ctx),
    flush: () => Promise.all(pending),
  };
}

test("static assets retain their bodies and headers with every security header", async (t) => {
  const app = setup(t);
  app.env.ASSETS.fetch = async (request) => {
    assert.equal(request.url, `${ORIGIN}/jemdoc.css?v=1`);
    return new Response("body { color: red; }", {
      headers: { "Content-Type": "text/css", ETag: '"asset-version"' },
    });
  };
  const response = await app.fetch("/jemdoc.css?v=1");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "body { color: red; }");
  assert.equal(response.headers.get("Content-Type"), "text/css");
  assert.equal(response.headers.get("ETag"), '"asset-version"');
  assertHeaders(response);
  assert.equal(app.reads.length, 0);
});

for (const [path, assetPath] of [
  ["/?source=direct", "/index.html?source=direct"],
  ["/callback.html?code=a%2Bb", "/callback.html?code=a%2Bb"],
]) {
  test(`${path} resolves the intended HTML asset without dropping its query`, async (t) => {
    const app = setup(t);
    app.env.ASSETS.fetch = async (request) => {
      assert.equal(request.url, `${ORIGIN}${assetPath}`);
      assert.equal(request.headers.get("If-None-Match"), '"previous-version"');
      return new Response("<html></html>", {
        headers: { "Content-Type": "text/html" },
      });
    };
    const response = await app.fetch(path, {
      headers: { "If-None-Match": '"previous-version"' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Location"), null);
    assertHeaders(response);
  });
}

test("static asset 404 responses retain their status and security headers", async (t) => {
  const app = setup(t);
  app.env.ASSETS.fetch = async () => new Response("Not found", { status: 404 });
  const response = await app.fetch("/private-file.txt");
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found");
  assertHeaders(response);
});

test("the apex redirects paths and OAuth query parameters to the canonical host", async (t) => {
  const app = setup(t);
  const response = await app.fetch(
    "https://calebkan.com/callback.html?code=a%2Bb&state=test",
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("Location"),
    `${ORIGIN}/callback.html?code=a%2Bb&state=test`,
  );
  assertHeaders(response);
  assert.equal(app.reads.length, 0);
});

for (const method of ["GET", "HEAD"]) {
  test(`the apex ${method} redirect declares HTML after Cloudflare verification`, async (t) => {
    const app = setup(t);
    const response = await app.fetch(
      "https://calebkan.com/?__cf_chl_tk=test-token&source=mobile",
      { method },
    );
    assert.equal(response.status, 308);
    assert.equal(
      response.headers.get("Location"),
      "https://www.calebkan.com/?__cf_chl_tk=test-token&source=mobile",
    );
    assert.equal(
      response.headers.get("Content-Type"),
      "text/html; charset=utf-8",
    );
    assert.equal(response.headers.get("Content-Disposition"), null);
    assert.equal(await response.text(), "");
    assertHeaders(response);
  });
}

test("unknown API routes return JSON 404s with security and CORS headers", async (t) => {
  const app = setup(t);
  const response = await app.fetch("/api/not-found");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assertHeaders(response, true);
});

test("asset failures return private generic errors with all security headers", async (t) => {
  const app = setup(t);
  const response = await app.fetch("/missing.html");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assertHeaders(response);
});

for (const path of [GITHUB_PATH, SPOTIFY_PATH]) {
  test(`${path} rejects POST without touching edge cache or upstream`, async (t) => {
    let upstreamCalls = 0;
    const app = setup(t, async () => {
      upstreamCalls++;
      return githubData();
    });
    const response = await app.fetch(path, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assertHeaders(response, true);
    assert.equal(upstreamCalls, 0);
    assert.equal(app.reads.length, 0);
    assert.equal(app.writes.length, 0);
  });
}

test("GitHub caches only successful JSON under a query-free key", async (t) => {
  let calls = 0;
  const app = setup(t, async () => {
    calls++;
    return githubData();
  });
  const first = await app.fetch(`${GITHUB_PATH}?cachebuster=one`);
  assert.equal(first.status, 200);
  assertHeaders(first, true);
  assert.deepEqual(await first.json(), {
    contributions: [{ date: "2026-09-21", count: 3 }],
  });
  await app.flush();
  const cached = await app.fetch(`${GITHUB_PATH}?cachebuster=two`);
  assertHeaders(cached, true);
  assert.deepEqual(await cached.json(), {
    contributions: [{ date: "2026-09-21", count: 3 }],
  });
  assert.equal(calls, 1);
  assert.deepEqual(app.reads, [
    `${ORIGIN}${GITHUB_PATH}`,
    `${ORIGIN}${GITHUB_PATH}`,
  ]);
  assert.deepEqual(app.writes, [`${ORIGIN}${GITHUB_PATH}`]);
});

test("refilling edge cache cannot extend GitHub's warm-cache lifetime", async (t) => {
  let calls = 0;
  const app = setup(t, async () => githubData(++calls));
  await app.fetch(GITHUB_PATH);
  await app.flush();
  t.mock.timers.tick(30000);
  app.entries.clear();
  const warm = await app.fetch(GITHUB_PATH);
  await app.flush();
  assert.match(warm.headers.get("Cache-Control"), /s-maxage=30/);
  assert.equal(calls, 1);
  t.mock.timers.tick(30001);
  const fresh = await app.fetch(GITHUB_PATH);
  assert.equal(calls, 2);
  assert.deepEqual(await fresh.json(), {
    contributions: [{ date: "2026-09-21", count: 2 }],
  });
});

test("GitHub upstream failures have headers and never enter edge cache", async (t) => {
  let calls = 0;
  const app = setup(t, async () => {
    calls++;
    return new Response("Private upstream error", { status: 503 });
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.fetch(GITHUB_PATH);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Failed to fetch contributions",
    });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assertHeaders(response, true);
  }
  await app.flush();
  assert.equal(calls, 2);
  assert.equal(app.writes.length, 0);
});

test("Spotify stays uncached and supplies headers on playback and errors", async (t) => {
  let playbackCalls = 0;
  const app = setup(t, async (url) => {
    if (url === "https://accounts.spotify.com/api/token") {
      return Response.json({ access_token: "access", expires_in: 3600 });
    }
    playbackCalls++;
    return new Response(null, { status: playbackCalls < 3 ? 204 : 503 });
  });
  for (const expectedStatus of [200, 200, 500]) {
    const response = await app.fetch(SPOTIFY_PATH);
    assert.equal(response.status, expectedStatus);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assertHeaders(response, true);
  }
  assert.equal(playbackCalls, 3);
  assert.equal(app.reads.length, 0);
  assert.equal(app.writes.length, 0);
});

for (const operation of ["match", "put"]) {
  test(`GitHub remains available if edge cache ${operation} fails`, async (t) => {
    const app = setup(t);
    app.cache[operation] = async () => {
      throw new Error("Cache unavailable");
    };
    const response = await app.fetch(GITHUB_PATH);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      contributions: [{ date: "2026-09-21", count: 3 }],
    });
    assertHeaders(response, true);
    await app.flush();
  });
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(
        ...(await listFiles(join(directory, entry.name), `${relative}/`)),
      );
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}

test("the asset build publishes only public files and preserves callback CSP hashes", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "calebkan-assets-test-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writeFile(
    join(output, "stale-private-file.txt"),
    "must not be published",
  );
  await buildAssets(output);
  const expected = [
    "callback.html",
    "favicon/favicon.png",
    "index.html",
    "jemdoc.css",
    "js/github-calendar.js",
    "js/spotify.js",
    "js/theme-boot.js",
    "js/theme-toggle.js",
  ];
  assert.deepEqual(await listFiles(output), expected);
  for (const file of expected) {
    assert.deepEqual(
      await readFile(join(output, file)),
      await readFile(new URL(`../${file}`, import.meta.url)),
      `${file} must remain byte-for-byte identical`,
    );
  }
  const callback = await readFile(join(output, "callback.html"), "utf8");
  const csp = callback.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )?.[1];
  assert.ok(csp);
  for (const tag of ["script", "style"]) {
    const content = callback.match(
      new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`),
    )?.[1];
    assert.ok(content, `Missing inline ${tag}`);
    const hash = createHash("sha256").update(content).digest("base64");
    assert.ok(csp.includes(`'sha256-${hash}'`), `${tag} CSP hash must match`);
  }
});
