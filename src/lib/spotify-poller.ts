import {
  FETCH_TIMEOUT_MS,
  MAX_CONSECUTIVE_ERRORS,
  POLL_INTERVAL_ACTIVE,
  POLL_INTERVAL_BACKOFF,
  POLL_INTERVAL_IDLE,
  parseSpotifyData,
  type SpotifyData,
} from "./spotify";

const API_URL = "/api/now-playing";
const HTTP_TOO_MANY_REQUESTS = 429;
const MAX_RETRY_AFTER_SECONDS = 3600;
const MS_PER_S = 1000;

interface ScheduledTask {
  cancel(): void;
}

export interface SpotifyRuntime {
  fetch: typeof fetch;
  now(): number;
  schedule(callback: () => void, delay: number): ScheduledTask;
}

const browserRuntime: SpotifyRuntime = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    return { cancel: () => clearTimeout(timer) };
  },
};

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function createSpotifyPoller(
  onData: (data: SpotifyData, resumed: boolean) => void,
  runtime: SpotifyRuntime = browserRuntime,
) {
  let active = false;
  let disposed = false;
  let inFlight = false;
  let hidden = true;
  let consecutiveErrors = 0;
  let retryAt = 0;
  let resumedFromHidden = false;
  let nextPoll: ScheduledTask | null = null;
  let requestTimeout: ScheduledTask | null = null;
  let requestController: AbortController | null = null;

  async function fetchNowPlaying(): Promise<SpotifyData | null> {
    const controller = new AbortController();
    requestController = controller;
    const timeout = runtime.schedule(
      () => controller.abort(),
      FETCH_TIMEOUT_MS,
    );
    requestTimeout = timeout;
    try {
      const response = await runtime.fetch(API_URL, {
        signal: controller.signal,
      });
      if (!response.ok) {
        // Release the unused body before clearing the request deadline.
        controller.abort();
        if (response.status === HTTP_TOO_MANY_REQUESTS) {
          const header = response.headers.get("Retry-After");
          const seconds =
            header && /^\d+$/.test(header.trim()) ? Number(header) : NaN;
          if (Number.isSafeInteger(seconds) && seconds > 0) {
            retryAt = Math.max(
              retryAt,
              runtime.now() +
                Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * MS_PER_S,
            );
          }
        }
        throw new Error(`Spotify returned HTTP ${response.status}`);
      }
      // The deadline includes body consumption, which can stall after headers arrive.
      const json: unknown = await response.json().catch((error: unknown) => {
        if (isAbortError(error)) throw error;
        throw new Error("Spotify API returned non-JSON response", {
          cause: error,
        });
      });
      const data = parseSpotifyData(json);
      consecutiveErrors = 0;
      retryAt = 0;
      return data;
    } catch (error) {
      if (disposed) return null;
      if (isAbortError(error)) {
        console.warn("Spotify API: fetch timed out");
        return null;
      }
      consecutiveErrors++;
      if (consecutiveErrors === MAX_CONSECUTIVE_ERRORS) {
        console.error(
          "Spotify API: persistent failure after",
          consecutiveErrors,
          "attempts:",
          error,
        );
      } else {
        console.warn("Spotify API error:", error);
      }
      return null;
    } finally {
      timeout.cancel();
      requestTimeout = null;
      requestController = null;
    }
  }

  function schedulePoll(delay: number) {
    nextPoll = runtime.schedule(() => {
      nextPoll = null;
      void pollOnce();
    }, delay);
  }

  async function pollOnce(): Promise<void> {
    if (!active || inFlight || disposed) return;
    const started = runtime.now();
    // Visibility changes may cancel the timer, but cannot bypass its cooldown.
    if (retryAt > started) {
      schedulePoll(retryAt - started);
      return;
    }
    inFlight = true;
    try {
      const data = await fetchNowPlaying();
      if (data === null || disposed) return;
      onData(data, resumedFromHidden);
      hidden = !data.isPlaying;
      resumedFromHidden = false;
    } catch (error) {
      console.error("Spotify render error:", error);
      resumedFromHidden = false;
    } finally {
      inFlight = false;
      if (active && !disposed) {
        const interval =
          consecutiveErrors >= MAX_CONSECUTIVE_ERRORS
            ? POLL_INTERVAL_BACKOFF
            : hidden
              ? POLL_INTERVAL_IDLE
              : POLL_INTERVAL_ACTIVE;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS)
          resumedFromHidden = false;
        const now = runtime.now();
        // Retry-After begins when response headers arrive, not at request start.
        const delay = Math.max(0, interval - (now - started), retryAt - now);
        schedulePoll(delay);
      }
    }
  }

  function stop() {
    active = false;
    nextPoll?.cancel();
    nextPoll = null;
  }

  return {
    start(resumed = false) {
      if (disposed) return;
      if (resumed) resumedFromHidden = true;
      if (active) return;
      active = true;
      void pollOnce();
    },
    stop,
    dispose() {
      disposed = true;
      stop();
      requestTimeout?.cancel();
      requestTimeout = null;
      requestController?.abort();
      requestController = null;
    },
  };
}
