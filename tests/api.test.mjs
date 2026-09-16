import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

// Each test imports a fresh copy so warm-instance caches cannot leak across tests.
let importId = 0;
async function loadHandler(name, t, fetcher) {
  process.env.GITHUB_TOKEN = "test-github-token";
  process.env.SPOTIFY_CLIENT_ID = "test-client";
  process.env.SPOTIFY_CLIENT_SECRET = "test-secret";
  process.env.SPOTIFY_REFRESH_TOKEN = "test-refresh";
  t.mock.method(globalThis, "fetch", fetcher);
  t.mock.method(console, "error", () => {});
  return (
    await import(
      new URL(`../api/${name}.js?test=${++importId}`, import.meta.url)
    )
  ).default;
}

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
const json = (data) => Response.json(data);
const token = () => json({ access_token: "test-access", expires_in: 3600 });
const track = {
  is_playing: true,
  currently_playing_type: "track",
  progress_ms: 30000,
  item: {
    name: "Example track",
    artists: [{ name: "Example artist" }],
    duration_ms: 180000,
    album: {
      name: "Example album",
      images: [
        { width: 640, url: "https://i.scdn.co/large" },
        { width: 64, url: "https://i.scdn.co/small" },
        { width: 300, url: "https://i.scdn.co/medium" },
      ],
    },
    external_urls: { spotify: "https://open.spotify.com/track/example" },
  },
};
const calendar = {
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          weeks: [
            {
              contributionDays: [{ date: "2026-09-16", contributionCount: 3 }],
            },
          ],
        },
      },
    },
  },
};

for (const api of ["github-contributions", "now-playing"]) {
  test(`${api} rejects writes without calling an upstream service`, async (t) => {
    const handler = await loadHandler(api, t, () => {
      throw new Error("Unexpected upstream request");
    });
    const res = responseRecorder();
    await handler({ method: "POST" }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET");
  });
}

test("GitHub contributions are transformed and reused until the cache expires", async (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: Date.UTC(2026, 8, 16),
  });
  let calls = 0;
  const handler = await loadHandler("github-contributions", t, async () => {
    calls++;
    return json(calendar);
  });
  const res = responseRecorder();
  await handler({ method: "GET" }, res);
  assert.deepEqual(res.body, {
    contributions: [{ date: "2026-09-16", count: 3 }],
  });
  await handler({ method: "GET" }, responseRecorder());
  assert.equal(calls, 1);
  t.mock.timers.tick(60001);
  await handler({ method: "GET" }, responseRecorder());
  assert.equal(calls, 2);
  assert.match(res.headers["Cache-Control"], /s-maxage=60/);
});

test("GitHub failures return a generic error without public caching", async (t) => {
  const handler = await loadHandler("github-contributions", t, async () =>
    json({ errors: [{ message: "Private upstream details" }] }),
  );
  const res = responseRecorder();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers["Cache-Control"], undefined);
  assert.equal(res.body.error, "Failed to fetch contributions");
});

test("Spotify refreshes a rejected token once and preserves track and image selection", async (t) => {
  const queue = [
    token,
    () => new Response(null, { status: 401 }),
    token,
    () => json(track),
  ];
  const handler = await loadHandler("now-playing", t, async () =>
    queue.shift()(),
  );
  const res = responseRecorder();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(queue.length, 0);
  assert.equal(res.body.isPlaying, true);
  assert.equal(res.body.albumArt, "https://i.scdn.co/medium");
  assert.equal(res.body.title, "Example track");
  assert.equal(res.body.progress, 30000);
  assert.match(res.headers["Cache-Control"], /no-store/);
});

test("Spotify stops after a second 401", async (t) => {
  const queue = [
    token,
    () => new Response(null, { status: 401 }),
    token,
    () => new Response(null, { status: 401 }),
  ];
  const handler = await loadHandler("now-playing", t, async () =>
    queue.shift()(),
  );
  const res = responseRecorder();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(queue.length, 0);
});

for (const [label, upstream] of [
  ["idle", () => new Response(null, { status: 204 })],
  [
    "non-track",
    () =>
      json({ is_playing: true, currently_playing_type: "episode", item: {} }),
  ],
]) {
  test(`Spotify ${label} responses hide the card`, async (t) => {
    const queue = [token, upstream];
    const handler = await loadHandler("now-playing", t, async () =>
      queue.shift()(),
    );
    const res = responseRecorder();
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { isPlaying: false });
  });
}

// A successful HTTP header is not a complete response. The five-second deadline
// must also abort a stalled JSON body, otherwise the serverless request hangs.
for (const [api, stallAt] of [
  ["github-contributions", 1],
  ["now-playing", 1],
  ["now-playing", 2],
]) {
  test(`${api} aborts a stalled response body on upstream request ${stallAt}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    const handler = await loadHandler(api, t, async (url, { signal }) => {
      if (++calls !== stallAt) return token();
      return new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener(
              "abort",
              () => controller.error(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          },
        }),
      );
    });
    const res = responseRecorder();
    const pending = handler({ method: "GET" }, res);
    await setImmediate();
    t.mock.timers.tick(5001);
    await setImmediate();
    assert.equal(
      res.statusCode,
      500,
      "The request must finish after its deadline, including while reading JSON",
    );
    await pending;
  });
}
