const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_ENDPOINT =
  "https://api.spotify.com/v1/me/player/currently-playing";
const FETCH_TIMEOUT_MS = 5000;
const MS_PER_S = 1000;
const SECONDS_PER_MINUTE = 60;
const TOKEN_REFRESH_MARGIN_MS = SECONDS_PER_MINUTE * MS_PER_S; // Re-fetch access token 60s before expiry to avoid clock-skew failures
const DEFAULT_TOKEN_EXPIRY_S = 3600;
const ALBUM_ART_TARGET_PX = 300; // Spotify medium size; close to 2x the 160px CSS display size for retina clarity
const FALLBACK_TEXT = "Unknown";
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const ALLOWED_METHOD = "GET";

let cachedToken = null;
let tokenExpiresAt = 0;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    // Read successful JSON bodies inside the deadline. Leave 401/204 responses
    // unparsed so token retry and idle playback keep their existing behavior.
    const data =
      response.ok && response.status !== HTTP_NO_CONTENT
        ? await response.json().catch((parseError) => {
            if (parseError.name === "AbortError") throw parseError;
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

async function getAccessToken(env) {
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

  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  const { response, data } = await fetchWithTimeout(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    }),
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status}`);
  }

  if (!data.access_token) {
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
  tokenExpiresAt = now + expiresInSeconds * MS_PER_S - TOKEN_REFRESH_MARGIN_MS;

  return cachedToken;
}

// Pick the smallest image >= target size for retina, regardless of array sort order
function pickAlbumImage(images) {
  if (!images || images.length === 0) return "";
  let bestFit = null; // smallest image >= target
  let largest = null; // largest image overall (fallback)
  for (const img of images) {
    if (
      !img ||
      typeof img.width !== "number" ||
      img.width <= 0 ||
      typeof img.url !== "string"
    )
      continue;
    if (img.width >= ALBUM_ART_TARGET_PX) {
      if (!bestFit || img.width < bestFit.width) bestFit = img;
    }
    if (!largest || img.width > largest.width) largest = img;
  }
  return (
    (bestFit || largest)?.url ||
    images.find((img) => img && typeof img.url === "string")?.url ||
    ""
  );
}

async function getNowPlaying(env) {
  let accessToken = await getAccessToken(env);
  let { response, data } = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // If the token was revoked or expired despite our margin, force-refresh and retry once
  if (response.status === HTTP_UNAUTHORIZED) {
    cachedToken = null;
    tokenExpiresAt = 0;
    accessToken = await getAccessToken(env);
    ({ response, data } = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }));
    if (response.status === HTTP_UNAUTHORIZED) {
      cachedToken = null;
      tokenExpiresAt = 0;
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

  if (!data.item || data.currently_playing_type !== "track") {
    return { isPlaying: false };
  }

  return {
    isPlaying: data.is_playing === true,
    title: data.item.name || FALLBACK_TEXT,
    artist:
      data.item.artists?.map((artist) => artist.name).join(", ") ||
      FALLBACK_TEXT,
    album: data.item.album?.name || FALLBACK_TEXT,
    albumArt: pickAlbumImage(data.item.album?.images),
    songUrl: data.item.external_urls?.spotify || "",
    progress: data.progress_ms ?? 0,
    duration: data.item.duration_ms ?? 0,
  };
}

export default async function handler(request, env) {
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
    return Response.json(
      { error: "Failed to fetch now playing data" },
      {
        status: HTTP_INTERNAL_SERVER_ERROR,
        headers,
      },
    );
  }
}
