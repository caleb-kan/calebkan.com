import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import type { TestContext } from "node:test";
import { isRecord } from "../api/types";
import type { GitHubEnv, SpotifyEnv } from "../api/types";

type ApiName = "github-contributions" | "now-playing";
type FetchMock = (
  url: RequestInfo | URL,
  options?: RequestInit,
) => Promise<Response>;
type ApiHandler = (
  request: Request,
  env: GitHubEnv & SpotifyEnv,
) => Promise<Response>;

const testEnv = {
  GITHUB_TOKEN: "test-github-token",
  SPOTIFY_CLIENT_ID: "test-client",
  SPOTIFY_CLIENT_SECRET: "test-secret",
  SPOTIFY_REFRESH_TOKEN: "test-refresh",
};

// Each test imports a fresh copy so warm-instance caches cannot leak across tests.
let importId = 0;
async function loadHandler(
  name: ApiName,
  t: TestContext,
  fetcher: FetchMock,
): Promise<ApiHandler> {
  t.mock.method(globalThis, "fetch", fetcher);
  t.mock.method(console, "error", () => {});
  const module: { default: ApiHandler } = await import(
    new URL(`../api/${name}.ts?test=${++importId}`, import.meta.url).href
  );
  return module.default;
}

function request(api: ApiName, method = "GET"): Request {
  return new Request(`https://www.calebkan.com/api/${api}`, { method });
}
const json = (data: unknown) => Response.json(data);

function nextResponse(queue: Array<() => Response>): Response {
  const next = queue.shift();
  assert.ok(next, "Unexpected upstream request");
  return next();
}

function delayedResponse() {
  let resolveResponse: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  assert.ok(resolveResponse);
  return { promise, resolve: resolveResponse };
}

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

for (const api of ["github-contributions", "now-playing"] as const) {
  test(`${api} rejects writes without calling an upstream service`, async (t) => {
    const handler = await loadHandler(api, t, () => {
      throw new Error("Unexpected upstream request");
    });
    const res = await handler(request(api, "POST"), testEnv);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("Allow"), "GET");
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
    assert.deepEqual(await res.json(), { error: "Method not allowed" });
  });
}

for (const [api, missingSecret, expectedError] of [
  ["github-contributions", "GITHUB_TOKEN", "Failed to fetch contributions"],
  ["now-playing", "SPOTIFY_CLIENT_ID", "Failed to fetch now playing data"],
  ["now-playing", "SPOTIFY_CLIENT_SECRET", "Failed to fetch now playing data"],
  ["now-playing", "SPOTIFY_REFRESH_TOKEN", "Failed to fetch now playing data"],
] as const) {
  test(`${api} fails privately without requesting upstream when ${missingSecret} is missing`, async (t) => {
    let calls = 0;
    const handler = await loadHandler(api, t, async () => {
      calls++;
      return json({});
    });
    const env: GitHubEnv & SpotifyEnv = { ...testEnv };
    delete env[missingSecret];
    const res = await handler(request(api), env);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: expectedError });
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
    assert.equal(calls, 0);
  });
}

test("GitHub contributions are transformed and reused until the cache expires", async (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: Date.UTC(2026, 8, 16),
  });
  let calls = 0;
  const handler = await loadHandler(
    "github-contributions",
    t,
    async (url, options) => {
      calls++;
      const headers = new Headers(options?.headers);
      assert.ok(headers.get("User-Agent"), "GitHub requires a User-Agent");
      assert.equal(headers.get("Authorization"), "Bearer test-github-token");
      return json(calendar);
    },
  );
  const res = await handler(request("github-contributions"), testEnv);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    contributions: [{ date: "2026-09-16", count: 3 }],
  });
  await handler(request("github-contributions"), testEnv);
  assert.equal(calls, 1);
  t.mock.timers.tick(60001);
  await handler(request("github-contributions"), testEnv);
  assert.equal(calls, 2);
  assert.equal(
    res.headers.get("Cache-Control"),
    "public, max-age=0, s-maxage=60",
  );
});

test("GitHub failures return a generic error without public caching", async (t) => {
  const handler = await loadHandler("github-contributions", t, async () =>
    json({ errors: [{ message: "Private upstream details" }] }),
  );
  const res = await handler(request("github-contributions"), testEnv);
  assert.equal(res.status, 500);
  assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
  assert.deepEqual(await res.json(), {
    error: "Failed to fetch contributions",
  });
});

test("Spotify refreshes a rejected token once and preserves track and image selection", async (t) => {
  const queue = [
    token,
    () => new Response(null, { status: 401 }),
    token,
    () => json(track),
  ];
  const handler = await loadHandler("now-playing", t, async (url, options) => {
    const headers = new Headers(options?.headers);
    if (url === "https://accounts.spotify.com/api/token") {
      assert.equal(
        headers.get("Authorization"),
        "Basic dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=",
      );
      assert.ok(options?.body instanceof URLSearchParams);
      assert.equal(options.body.get("refresh_token"), "test-refresh");
    } else {
      assert.equal(headers.get("Authorization"), "Bearer test-access");
    }
    return nextResponse(queue);
  });
  const res = await handler(request("now-playing"), testEnv);
  const body: unknown = await res.json();
  assert.ok(isRecord(body));
  assert.equal(res.status, 200);
  assert.equal(queue.length, 0);
  assert.equal(body.isPlaying, true);
  assert.equal(body.albumArt, "https://i.scdn.co/medium");
  assert.equal(body.title, "Example track");
  assert.equal(body.progress, 30000);
  assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
});

test("Spotify stops after a second 401", async (t) => {
  const queue = [
    token,
    () => new Response(null, { status: 401 }),
    token,
    () => new Response(null, { status: 401 }),
  ];
  const handler = await loadHandler("now-playing", t, async () =>
    nextResponse(queue),
  );
  const res = await handler(request("now-playing"), testEnv);
  assert.equal(res.status, 500);
  assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
  assert.deepEqual(await res.json(), {
    error: "Failed to fetch now playing data",
  });
  assert.equal(queue.length, 0);
});

test("a delayed Spotify 401 reuses a token refreshed by another request", async (t) => {
  let tokenCalls = 0;
  let stalePlaybackCalls = 0;
  let freshPlaybackCalls = 0;
  const delayed = delayedResponse();
  const handler = await loadHandler("now-playing", t, async (url, options) => {
    if (url === "https://accounts.spotify.com/api/token") {
      tokenCalls++;
      return tokenCalls <= 2
        ? json({ access_token: `token-${tokenCalls}`, expires_in: 3600 })
        : new Response(null, { status: 429 });
    }
    const authorization = new Headers(options?.headers).get("Authorization");
    if (authorization === "Bearer token-1") {
      stalePlaybackCalls++;
      if (stalePlaybackCalls === 1) return new Response(null, { status: 204 });
      if (stalePlaybackCalls === 2) return delayed.promise;
      return new Response(null, { status: 401 });
    }
    assert.equal(authorization, "Bearer token-2");
    freshPlaybackCalls++;
    return new Response(null, { status: 204 });
  });

  await handler(request("now-playing"), testEnv);
  const pending = handler(request("now-playing"), testEnv);
  await setImmediate();
  const refreshed = await handler(request("now-playing"), testEnv);
  delayed.resolve(new Response(null, { status: 401 }));
  const retried = await pending;
  const subsequent = await handler(request("now-playing"), testEnv);

  assert.equal(refreshed.status, 200);
  assert.equal(retried.status, 200);
  assert.equal(subsequent.status, 200);
  assert.equal(tokenCalls, 2, "A stale 401 must not discard the newer token");
  assert.equal(freshPlaybackCalls, 3);
});

test("a delayed second Spotify 401 preserves another request's newer token", async (t) => {
  let tokenCalls = 0;
  let firstTokenCalls = 0;
  let secondTokenCalls = 0;
  let thirdTokenCalls = 0;
  const delayed = delayedResponse();
  const handler = await loadHandler("now-playing", t, async (url, options) => {
    if (url === "https://accounts.spotify.com/api/token") {
      tokenCalls++;
      return tokenCalls <= 3
        ? json({ access_token: `token-${tokenCalls}`, expires_in: 3600 })
        : new Response(null, { status: 429 });
    }
    const authorization = new Headers(options?.headers).get("Authorization");
    if (authorization === "Bearer token-1") {
      return new Response(null, {
        status: ++firstTokenCalls === 1 ? 204 : 401,
      });
    }
    if (authorization === "Bearer token-2") {
      if (++secondTokenCalls === 1) return delayed.promise;
      return new Response(null, { status: 401 });
    }
    assert.equal(authorization, "Bearer token-3");
    thirdTokenCalls++;
    return new Response(null, { status: 204 });
  });

  await handler(request("now-playing"), testEnv);
  const pending = handler(request("now-playing"), testEnv);
  await setImmediate();
  const refreshed = await handler(request("now-playing"), testEnv);
  delayed.resolve(new Response(null, { status: 401 }));
  const failed = await pending;
  const subsequent = await handler(request("now-playing"), testEnv);

  assert.equal(refreshed.status, 200);
  assert.equal(failed.status, 500, "A request still retries only once");
  assert.equal(subsequent.status, 200);
  assert.equal(
    tokenCalls,
    3,
    "A failed retry must not discard the newer token",
  );
  assert.equal(thirdTokenCalls, 2);
});

test("Spotify preserves optional track defaults and paused playback", async (t) => {
  const queue = [
    token,
    () =>
      json({
        is_playing: false,
        currently_playing_type: "track",
        progress_ms: null,
        item: {
          name: "",
          artists: [],
          album: null,
          external_urls: null,
          duration_ms: null,
        },
      }),
  ];
  const handler = await loadHandler("now-playing", t, async () =>
    nextResponse(queue),
  );
  const response = await handler(request("now-playing"), testEnv);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    isPlaying: false,
    title: "Unknown",
    artist: "Unknown",
    album: "Unknown",
    albumArt: "",
    songUrl: "",
    progress: 0,
    duration: 0,
  });
});

for (const [label, images, expected] of [
  [
    "largest undersized image",
    [
      { width: 64, url: "https://i.scdn.co/small" },
      { width: 160, url: "https://i.scdn.co/largest" },
    ],
    "https://i.scdn.co/largest",
  ],
  [
    "first usable URL when dimensions are missing",
    [null, { width: 300 }, { url: "https://i.scdn.co/fallback" }],
    "https://i.scdn.co/fallback",
  ],
  ["empty artwork list", [], ""],
] as const) {
  test(`Spotify preserves the ${label} album-art fallback`, async (t) => {
    const queue = [
      token,
      () =>
        json({
          ...track,
          item: {
            ...track.item,
            album: { ...track.item.album, images },
          },
        }),
    ];
    const handler = await loadHandler("now-playing", t, async () =>
      nextResponse(queue),
    );
    const response = await handler(request("now-playing"), testEnv);
    const body: unknown = await response.json();
    assert.equal(response.status, 200);
    assert.ok(isRecord(body));
    assert.equal(body.albumArt, expected);
  });
}

for (const [api, payload] of [
  ["github-contributions", null],
  ["github-contributions", { data: { user: {} } }],
  ["now-playing", null],
  ["now-playing", { access_token: 42 }],
] as const) {
  test(`${api} rejects malformed upstream payload ${JSON.stringify(payload)} privately`, async (t) => {
    const handler = await loadHandler(api, t, async () => json(payload));
    const response = await handler(request(api), testEnv);
    assert.equal(response.status, 500);
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
    assert.deepEqual(await response.json(), {
      error:
        api === "github-contributions"
          ? "Failed to fetch contributions"
          : "Failed to fetch now playing data",
    });
  });
}

for (const [label, upstream] of [
  ["idle", () => new Response(null, { status: 204 })],
  [
    "non-track",
    () =>
      json({ is_playing: true, currently_playing_type: "episode", item: {} }),
  ],
] as const) {
  test(`Spotify ${label} responses hide the card`, async (t) => {
    const queue = [token, upstream];
    const handler = await loadHandler("now-playing", t, async () =>
      nextResponse(queue),
    );
    const res = await handler(request("now-playing"), testEnv);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { isPlaying: false });
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
  });
}

for (const [api, failureAt, status] of [
  ["github-contributions", 1, 503],
  ["now-playing", 1, 400],
  ["now-playing", 2, 503],
] as const) {
  test(`${api} aborts the unused body of upstream ${status} response ${failureAt}`, async (t) => {
    let calls = 0;
    let discardedSignal: AbortSignal | undefined;
    const handler = await loadHandler(api, t, async (_url, options) => {
      if (++calls !== failureAt) return token();
      const signal = options?.signal;
      assert.ok(signal);
      discardedSignal = signal;
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
        { status },
      );
    });
    const response = await handler(request(api), testEnv);
    assert.equal(response.status, 500);
    assert.ok(
      discardedSignal?.aborted,
      "Unused error bodies must release their fetch",
    );
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  });
}

test("Spotify releases an unread 401 body before refreshing and retrying", async (t) => {
  let calls = 0;
  let rejectedSignal: AbortSignal | undefined;
  const handler = await loadHandler("now-playing", t, async (_url, options) => {
    calls++;
    if (calls === 1) return token();
    if (calls === 2) {
      const signal = options?.signal;
      assert.ok(signal);
      rejectedSignal = signal;
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
        { status: 401 },
      );
    }
    assert.ok(
      rejectedSignal?.aborted,
      "Release the rejected response before retrying",
    );
    return calls === 3 ? token() : json(track);
  });
  const response = await handler(request("now-playing"), testEnv);
  assert.equal(response.status, 200);
  assert.equal(calls, 4);
});

// A successful HTTP header is not a complete response. The five-second deadline
// must also abort a stalled JSON body, otherwise the serverless request hangs.
for (const [api, stallAt] of [
  ["github-contributions", 1],
  ["now-playing", 1],
  ["now-playing", 2],
] as const) {
  test(`${api} aborts a stalled response body on upstream request ${stallAt}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    const handler = await loadHandler(api, t, async (url, options) => {
      const signal = options?.signal;
      assert.ok(signal);
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
    let res: Response | undefined;
    const pending = handler(request(api), testEnv).then((response) => {
      res = response;
    });
    await setImmediate();
    t.mock.timers.tick(5001);
    await setImmediate();
    assert.equal(
      res?.status,
      500,
      "The request must finish after its deadline, including while reading JSON",
    );
    assert.ok(res);
    assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
    await pending;
  });
}
