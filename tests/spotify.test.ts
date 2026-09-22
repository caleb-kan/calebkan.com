import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  createSpotifyPoller,
  type SpotifyRuntime,
} from "../src/lib/spotify-poller";
import {
  FETCH_TIMEOUT_MS,
  INITIAL_SPOTIFY_STATE,
  PLACEHOLDER_IMAGE,
  POLL_INTERVAL_ACTIVE,
  POLL_INTERVAL_BACKOFF,
  POLL_INTERVAL_IDLE,
  formatTime,
  isSafeImageUrl,
  isSafeSongUrl,
  marqueeDuration,
  parseSpotifyData,
  progressPosition,
  spotifyReducer,
  type SpotifyData,
} from "../src/lib/spotify";

const playing: SpotifyData = {
  isPlaying: true,
  title: "A song",
  artist: "An artist",
  album: "An album",
  albumArt: "https://i.scdn.co/image/example",
  songUrl: "https://open.spotify.com/track/example",
  progress: 30000,
  duration: 180000,
};

function pollerHarness(handler: (signal: AbortSignal) => Promise<Response>) {
  let now = 0;
  let requests = 0;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const received: { data: SpotifyData; resumed: boolean }[] = [];
  const runtime: SpotifyRuntime = {
    fetch: async (_url, init) => {
      const signal = init?.signal;
      assert.ok(signal);
      requests++;
      return handler(signal);
    },
    now: () => now,
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return {
        cancel: () => {
          timers.delete(id);
        },
      };
    },
  };
  const poller = createSpotifyPoller(
    (data, resumed) => received.push({ data, resumed }),
    runtime,
  );
  return {
    poller,
    received,
    timers,
    requests: () => requests,
    advance(milliseconds: number) {
      now += milliseconds;
    },
    async start() {
      poller.start();
      await setImmediate();
    },
    async runNext() {
      const entry = timers.entries().next().value;
      assert.ok(entry, "A timer must be scheduled");
      const [id, task] = entry;
      timers.delete(id);
      now += task.delay;
      task.callback();
      await setImmediate();
      return task.delay;
    },
    nextDelay() {
      assert.equal(
        timers.size,
        1,
        "Completed requests must leave only the next poll timer",
      );
      return timers.values().next().value?.delay;
    },
  };
}

test("Spotify accepts only HTTPS links and album images on the allowed hosts", () => {
  assert.equal(isSafeSongUrl(playing.songUrl), true);
  assert.equal(isSafeImageUrl(playing.albumArt), true);
  for (const url of [
    "javascript:alert(1)",
    "http://open.spotify.com/track/example",
    "https://open.spotify.com.evil.example/track/example",
    "https://open.spotify.com@evil.example/track/example",
    "/relative",
    "not a URL",
  ])
    assert.equal(isSafeSongUrl(url), false, url);
  for (const url of [
    "http://i.scdn.co/image/example",
    "https://i.scdn.co.evil.example/image/example",
    "https://scdn.co/image/example",
    "data:image/svg+xml,<svg/>",
    "not a URL",
  ])
    assert.equal(isSafeImageUrl(url), false, url);
});

test("Spotify validates the playback discriminator and normalizes malformed optional fields", () => {
  for (const value of [null, [], {}, { isPlaying: "true" }, 1]) {
    assert.throws(() => parseSpotifyData(value), /unexpected response shape/);
  }
  assert.deepEqual(parseSpotifyData(playing), playing);
  const data = parseSpotifyData({
    isPlaying: true,
    title: { unsafe: true },
    progress: -1,
    duration: Infinity,
  });
  assert.equal(data.title, "");
  assert.equal(data.progress, 0);
  assert.equal(data.duration, 0);
});

test("Spotify formats progress and keeps a shared marquee movement speed", () => {
  assert.equal(formatTime(-1), "0:00");
  assert.equal(formatTime(65000), "1:05");
  assert.deepEqual(progressPosition(30000, 180000), {
    fraction: 1 / 6,
    percentage: 17,
    text: "0:30 of 3:00",
  });
  assert.deepEqual(progressPosition(0, 0), {
    fraction: 0,
    percentage: 0,
    text: "0%",
  });
  assert.equal(progressPosition(200000, 180000).fraction, 1);
  assert.equal(marqueeDuration(10, 20), "4s");
  assert.equal(marqueeDuration(105, 50), "10s");
  assert.equal(marqueeDuration(50, 105), "10s");
});

test("Spotify keeps failed art on a placeholder until its URL or track changes", () => {
  const first = spotifyReducer(INITIAL_SPOTIFY_STATE, {
    type: "playback",
    data: playing,
    resumed: false,
  });
  assert.equal(first.hidden, false);
  assert.equal(first.sample?.instant, true);
  const failed = spotifyReducer(first, {
    type: "art-error",
    url: playing.albumArt,
  });
  assert.equal(failed.track?.artUrl, PLACEHOLDER_IMAGE);
  const same = spotifyReducer(failed, {
    type: "playback",
    data: playing,
    resumed: false,
  });
  assert.equal(same.track?.artUrl, PLACEHOLDER_IMAGE);
  assert.equal(same.sample?.instant, false);
  const updated = spotifyReducer(same, {
    type: "playback",
    data: { ...playing, albumArt: "https://i.scdn.co/image/new" },
    resumed: true,
  });
  assert.equal(updated.track?.artUrl, "https://i.scdn.co/image/new");
  assert.equal(updated.sample?.instant, true);
  const nextTrack = spotifyReducer(failed, {
    type: "playback",
    data: { ...playing, songUrl: "https://open.spotify.com/track/new" },
    resumed: false,
  });
  assert.equal(nextTrack.track?.artUrl, playing.albumArt);
  assert.equal(nextTrack.track?.failedArtUrl, null);
  assert.equal(
    spotifyReducer(first, {
      type: "art-error",
      url: "https://i.scdn.co/image/stale",
    }),
    first,
  );
});

test("Spotify hides idle playback, forgets its identity, and safely disables invalid links", () => {
  const first = spotifyReducer(INITIAL_SPOTIFY_STATE, {
    type: "playback",
    data: playing,
    resumed: false,
  });
  const hidden = spotifyReducer(first, {
    type: "playback",
    data: { ...playing, isPlaying: false },
    resumed: false,
  });
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.trackId, null);
  assert.equal(hidden.sample, null);
  assert.equal(
    spotifyReducer(hidden, { type: "playback", data: playing, resumed: false })
      .sample?.instant,
    true,
  );
  const unsafe = spotifyReducer(INITIAL_SPOTIFY_STATE, {
    type: "playback",
    data: {
      ...playing,
      songUrl: "javascript:alert(1)",
      albumArt: "https://evil.example/art",
      title: "",
      artist: "",
    },
    resumed: false,
  });
  assert.equal(unsafe.track?.songUrl, undefined);
  assert.equal(unsafe.track?.artUrl, PLACEHOLDER_IMAGE);
  assert.equal(unsafe.track?.title, "Unknown");
  assert.equal(unsafe.track?.artist, "Unknown");
});

test("Spotify polls active and idle playback at their original cadence with elapsed compensation", async () => {
  let data = playing;
  const harness = pollerHarness(async () => {
    harness.advance(200);
    return Response.json(data);
  });
  await harness.start();
  assert.equal(harness.nextDelay(), POLL_INTERVAL_ACTIVE - 200);
  data = { ...playing, isPlaying: false };
  await harness.runNext();
  assert.equal(harness.nextDelay(), POLL_INTERVAL_IDLE - 200);
  assert.equal(harness.received.length, 2);
  harness.poller.dispose();
  assert.equal(harness.timers.size, 0);
});

test("Spotify backs off after three failures and a success resets the error tier", async () => {
  let failing = true;
  const harness = pollerHarness(async () => {
    if (failing) return new Response("unavailable", { status: 503 });
    return Response.json(playing);
  });
  await harness.start();
  assert.equal(harness.nextDelay(), POLL_INTERVAL_IDLE);
  await harness.runNext();
  assert.equal(harness.nextDelay(), POLL_INTERVAL_IDLE);
  await harness.runNext();
  assert.equal(harness.nextDelay(), POLL_INTERVAL_BACKOFF);
  failing = false;
  await harness.runNext();
  assert.equal(harness.nextDelay(), POLL_INTERVAL_ACTIVE);
  failing = true;
  await harness.runNext();
  assert.equal(harness.nextDelay(), POLL_INTERVAL_ACTIVE);
  harness.poller.dispose();
});

test("Spotify preserves the displayed track and resume flag through transient errors", async () => {
  let failing = false;
  const harness = pollerHarness(async () => {
    if (failing) throw new DOMException("Timed out", "AbortError");
    return Response.json(playing);
  });
  await harness.start();
  harness.poller.stop();
  failing = true;
  harness.poller.start(true);
  await setImmediate();
  for (let attempt = 0; attempt < 4; attempt++) {
    assert.equal(harness.nextDelay(), POLL_INTERVAL_ACTIVE);
    await harness.runNext();
  }
  assert.equal(harness.received.length, 1);
  failing = false;
  await harness.runNext();
  assert.equal(harness.received.at(-1)?.resumed, true);
  harness.poller.dispose();
});

test("Spotify prevents overlapping requests and resumes after an in-flight visibility change", async () => {
  let resolveResponse: ((response: Response) => void) | undefined;
  const harness = pollerHarness(
    () =>
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
  );
  await harness.start();
  harness.poller.stop();
  harness.poller.start(true);
  assert.equal(harness.requests(), 1);
  assert.ok(resolveResponse);
  resolveResponse(Response.json(playing));
  await setImmediate();
  assert.equal(harness.received.at(-1)?.resumed, true);
  assert.equal(harness.nextDelay(), POLL_INTERVAL_ACTIVE);
  harness.poller.stop();
  assert.equal(harness.timers.size, 0);
  harness.poller.dispose();
});

test("Spotify's timeout covers a stalled JSON body and does not count as a persistent error", async () => {
  const harness = pollerHarness(
    async (signal) =>
      new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener(
              "abort",
              () =>
                controller.error(new DOMException("Timed out", "AbortError")),
              { once: true },
            );
          },
        }),
      ),
  );
  await harness.start();
  assert.equal(harness.nextDelay(), FETCH_TIMEOUT_MS);
  for (let attempt = 0; attempt < 4; attempt++) {
    await harness.runNext();
    assert.equal(
      harness.nextDelay(),
      0,
      "A timeout already consumed the idle interval",
    );
    await harness.runNext();
    assert.equal(harness.nextDelay(), FETCH_TIMEOUT_MS);
  }
  harness.poller.dispose();
  await setImmediate();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.received.length, 0);
});

test("Spotify cleanup aborts its request and suppresses late rendering and timers", async () => {
  let signal: AbortSignal | undefined;
  let resolveResponse: ((response: Response) => void) | undefined;
  const harness = pollerHarness((requestSignal) => {
    signal = requestSignal;
    return new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
  });
  await harness.start();
  harness.poller.dispose();
  assert.equal(signal?.aborted, true);
  assert.equal(harness.timers.size, 0);
  assert.ok(resolveResponse);
  resolveResponse(Response.json(playing));
  await setImmediate();
  assert.equal(harness.received.length, 0);
  assert.equal(harness.timers.size, 0);
  harness.poller.start();
  assert.equal(harness.requests(), 1);
});
