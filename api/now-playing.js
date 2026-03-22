const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_ENDPOINT =
  "https://api.spotify.com/v1/me/player/currently-playing";
const FETCH_TIMEOUT_MS = 5000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000; // Re-fetch access token 60s before expiry to avoid clock-skew failures
const DEFAULT_TOKEN_EXPIRY_S = 3600;
const ALBUM_ART_TARGET_PX = 300; // Spotify medium size; close to 2x the 160px CSS display size for retina clarity

let cachedToken = null;
let tokenExpiresAt = 0;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error("Missing Spotify credentials");
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const response = await fetchWithTimeout(TOKEN_ENDPOINT, {
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

  const data = await response.json().catch((parseError) => {
    throw new Error("Spotify token endpoint returned non-JSON response", {
      cause: parseError,
    });
  });
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
  tokenExpiresAt = now + expiresInSeconds * 1000 - TOKEN_REFRESH_MARGIN_MS;

  return cachedToken;
}

// Pick the smallest image >= target size for retina, regardless of array sort order
function pickAlbumImage(images) {
  if (!images || images.length === 0) return "";
  let bestFit = null; // smallest image >= target
  let largest = null; // largest image overall (fallback)
  for (const img of images) {
    if (!img || typeof img.width !== "number") continue;
    if (img.width >= ALBUM_ART_TARGET_PX) {
      if (!bestFit || img.width < bestFit.width) bestFit = img;
    }
    if (!largest || img.width > largest.width) largest = img;
  }
  return (bestFit || largest)?.url || images.find((img) => img?.url)?.url || "";
}

async function getNowPlaying() {
  let accessToken = await getAccessToken();
  let response = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // If the token was revoked or expired despite our margin, force-refresh and retry once
  if (response.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    accessToken = await getAccessToken();
    response = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.status === 401) {
      throw new Error(
        "Spotify token refresh failed: still getting 401. Check SPOTIFY_REFRESH_TOKEN.",
      );
    }
  }

  if (response.status === 204) {
    return { isPlaying: false };
  }

  if (response.status >= 400) {
    throw new Error(`Spotify API error: ${response.status}`);
  }

  const data = await response.json().catch((parseError) => {
    throw new Error("Spotify now-playing endpoint returned non-JSON response", {
      cause: parseError,
    });
  });

  if (!data.item) {
    return { isPlaying: false };
  }

  return {
    isPlaying: data.is_playing === true,
    title: data.item.name || "Unknown",
    artist:
      data.item.artists?.map((artist) => artist.name).join(", ") || "Unknown",
    album: data.item.album?.name || "Unknown",
    albumArt: pickAlbumImage(data.item.album?.images),
    songUrl: data.item.external_urls?.spotify || "",
    progress: data.progress_ms ?? 0,
    duration: data.item.duration_ms ?? 0,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // No caching -- playback state changes every second
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

  try {
    const nowPlaying = await getNowPlaying();
    return res.status(200).json(nowPlaying);
  } catch (error) {
    console.error("Spotify API error:", error);
    return res.status(500).json({ error: "Failed to fetch now playing data" });
  }
}
