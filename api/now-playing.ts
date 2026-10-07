import { isAbortError, isRecord } from "./types";
import type { NowPlayingResponse, SpotifyEnv } from "./types";

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_ENDPOINT =
  "https://api.spotify.com/v1/me/player/currently-playing";
const FETCH_TIMEOUT_MS = 5000;
const MS_PER_S = 1000;
const SECONDS_PER_MINUTE = 60;
const TOKEN_REFRESH_MARGIN_MS = SECONDS_PER_MINUTE * MS_PER_S; // Re-fetch access token 60s before expiry to avoid clock-skew failures
const DEFAULT_TOKEN_EXPIRY_S = 3600;
const DEFAULT_RETRY_AFTER_SECONDS = 30;
const MAX_RETRY_AFTER_SECONDS = 3600;
const ALBUM_ART_TARGET_PX = 300; // Spotify medium size; close to 2x the 160px CSS display size for retina clarity
const FALLBACK_TEXT = "Unknown";
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const ALLOWED_METHOD = "GET";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let tokenRequest: Promise<string> | null = null;
// Coordinate upstream backoff across visitors without caching playback responses.
let retryAt = 0;

class SpotifyRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Spotify upstream rate limit");
  }
}

function cooldownRemainingSeconds(): number {
  return Math.max(0, Math.ceil((retryAt - Date.now()) / MS_PER_S));
}

function parseRetryAfterSeconds(value: string | null): number {
  const seconds = value && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(seconds) && seconds > 0
    ? Math.min(seconds, MAX_RETRY_AFTER_SECONDS)
    : DEFAULT_RETRY_AFTER_SECONDS;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
): Promise<{ response: Response; data: unknown }> {
  const remaining = cooldownRemainingSeconds();
  if (remaining > 0) throw new SpotifyRateLimitError(remaining);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    // Release ignored error bodies before clearing the deadline or retrying a
    // 401. Aborting preserves the status without awaiting stream cancellation.
    if (!response.ok) controller.abort();
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      const seconds = parseRetryAfterSeconds(
        response.headers.get("Retry-After"),
      );
      retryAt = Math.max(retryAt, Date.now() + seconds * MS_PER_S);
      throw new SpotifyRateLimitError(cooldownRemainingSeconds());
    }
    // Read successful JSON bodies inside the deadline. Leave 204 responses
    // unparsed so idle playback keeps its existing behavior.
    const data: unknown =
      response.ok && response.status !== HTTP_NO_CONTENT
        ? await response.json().catch((parseError: unknown) => {
            if (isAbortError(parseError)) throw parseError;
            throw new Error("Spotify endpoint returned non-JSON response", {
              cause: parseError,
            });
          })
        : null;
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function getAccessToken(env: SpotifyEnv): Promise<string> {
  const {
    SPOTIFY_CLIENT_ID: CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: CLIENT_SECRET,
    SPOTIFY_REFRESH_TOKEN: REFRESH_TOKEN,
  } = env;
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error("Missing Spotify credentials");
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }
  if (tokenRequest) return tokenRequest;

  const pending = refreshAccessToken(
    CLIENT_ID,
    CLIENT_SECRET,
    REFRESH_TOKEN,
    now,
  );
  tokenRequest = pending;
  try {
    return await pending;
  } finally {
    if (tokenRequest === pending) tokenRequest = null;
  }
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  requestedAt: number,
): Promise<string> {
  const basic = btoa(`${clientId}:${clientSecret}`);

  const { response, data } = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status}`);
  }

  if (
    !isRecord(data) ||
    typeof data.access_token !== "string" ||
    !data.access_token
  ) {
    throw new Error("Spotify token refresh returned no access token");
  }

  if (data.refresh_token) {
    console.warn(
      "Spotify issued a new refresh_token; the old token may be invalidated. " +
        "Update SPOTIFY_REFRESH_TOKEN env var immediately.",
    );
  }

  cachedToken = data.access_token;
  const expiresInSeconds = Number(data.expires_in) || DEFAULT_TOKEN_EXPIRY_S;
  tokenExpiresAt =
    requestedAt + expiresInSeconds * MS_PER_S - TOKEN_REFRESH_MARGIN_MS;

  return cachedToken;
}

// Pick the smallest image >= target size for retina, regardless of array sort order
function pickAlbumImage(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const images: unknown[] = value;
  let bestFit: { width: number; url: string } | null = null;
  let largest: { width: number; url: string } | null = null;
  for (const img of images) {
    if (
      !isRecord(img) ||
      typeof img.width !== "number" ||
      !Number.isFinite(img.width) ||
      img.width <= 0 ||
      typeof img.url !== "string" ||
      !img.url.trim()
    )
      continue;
    if (img.width >= ALBUM_ART_TARGET_PX) {
      if (!bestFit || img.width < bestFit.width) {
        bestFit = { width: img.width, url: img.url };
      }
    }
    if (!largest || img.width > largest.width) {
      largest = { width: img.width, url: img.url };
    }
  }
  return (
    (bestFit || largest)?.url ||
    images.find(
      (img): img is Record<string, unknown> & { url: string } =>
        isRecord(img) && typeof img.url === "string" && !!img.url.trim(),
    )?.url ||
    ""
  );
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error("Spotify response contains an invalid text field");
  }
  return value;
}

function optionalMilliseconds(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Spotify response contains an invalid numeric field");
  }
  return value;
}

async function getNowPlaying(env: SpotifyEnv): Promise<NowPlayingResponse> {
  let accessToken = await getAccessToken(env);
  let { response, data } = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // Retry once with a newer cached token or refresh a revoked or expired token.
  if (response.status === HTTP_UNAUTHORIZED) {
    // A different request may have refreshed the shared cache while this
    // response was in flight. Only invalidate the token this request used.
    if (cachedToken === accessToken) {
      cachedToken = null;
      tokenExpiresAt = 0;
    }
    accessToken = await getAccessToken(env);
    ({ response, data } = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }));
    if (response.status === HTTP_UNAUTHORIZED) {
      if (cachedToken === accessToken) {
        cachedToken = null;
        tokenExpiresAt = 0;
      }
      throw new Error(
        "Spotify token refresh failed: still getting 401. Check SPOTIFY_REFRESH_TOKEN.",
      );
    }
  }

  if (response.status === HTTP_NO_CONTENT) {
    return { isPlaying: false };
  }

  if (response.status >= HTTP_CLIENT_ERROR_MIN) {
    throw new Error(`Spotify API error: ${response.status}`);
  }

  if (!isRecord(data) || typeof data.is_playing !== "boolean") {
    throw new Error("Spotify API returned an invalid response");
  }

  if (!data.item || data.currently_playing_type !== "track") {
    return { isPlaying: false };
  }

  const item = data.item;
  if (!isRecord(item)) {
    throw new Error("Spotify API returned an invalid track");
  }
  const album = isRecord(item.album) ? item.album : undefined;
  const externalUrls = isRecord(item.external_urls)
    ? item.external_urls
    : undefined;
  let artist: string | undefined;
  if (item.artists != null) {
    if (!Array.isArray(item.artists)) {
      throw new Error("Spotify API returned invalid artists");
    }
    const artists: unknown[] = item.artists;
    artist = artists
      .map((entry) => {
        if (!isRecord(entry)) {
          throw new Error("Spotify API returned an invalid artist");
        }
        return optionalString(entry.name);
      })
      .join(", ");
  }

  return {
    isPlaying: data.is_playing,
    title: optionalString(item.name) || FALLBACK_TEXT,
    artist: artist || FALLBACK_TEXT,
    album: optionalString(album?.name) || FALLBACK_TEXT,
    albumArt: pickAlbumImage(album?.images),
    songUrl: optionalString(externalUrls?.spotify) || "",
    progress: optionalMilliseconds(data.progress_ms) ?? 0,
    duration: optionalMilliseconds(item.duration_ms) ?? 0,
  };
}

export default async function handler(
  request: Request,
  env: SpotifyEnv,
): Promise<Response> {
  if (request.method !== ALLOWED_METHOD) {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: HTTP_METHOD_NOT_ALLOWED,
        headers: { Allow: ALLOWED_METHOD, "Cache-Control": "no-store" },
      },
    );
  }

  // No caching -- playback state changes every second
  const headers = { "Cache-Control": "no-cache, no-store, must-revalidate" };

  try {
    const nowPlaying = await getNowPlaying(env);
    return Response.json(nowPlaying, { status: HTTP_OK, headers });
  } catch (error) {
    console.error("Spotify API error:", error);
    const rateLimited = error instanceof SpotifyRateLimitError;
    return Response.json(
      { error: "Failed to fetch now playing data" },
      {
        status: rateLimited
          ? HTTP_TOO_MANY_REQUESTS
          : HTTP_INTERNAL_SERVER_ERROR,
        headers: rateLimited
          ? { ...headers, "Retry-After": String(error.retryAfterSeconds) }
          : headers,
      },
    );
  }
}
