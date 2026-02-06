const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_ENDPOINT =
  "https://api.spotify.com/v1/me/player/currently-playing";
const FETCH_TIMEOUT_MS = 5000;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error("Missing Spotify credentials");
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: REFRESH_TOKEN,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Spotify token refresh returned no access token");
  }

  cachedToken = data.access_token;
  const expiresInSeconds = Number(data.expires_in) || 3600;
  tokenExpiresAt = now + expiresInSeconds * 1000 - 60 * 1000;

  return cachedToken;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getNowPlaying() {
  let accessToken = await getAccessToken();
  let response = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    accessToken = await getAccessToken();
    response = await fetchWithTimeout(NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  if (response.status === 204) {
    return { isPlaying: false };
  }

  if (response.status >= 400) {
    console.error(`Spotify API error: ${response.status}`);
    return { isPlaying: false };
  }

  const data = await response.json();

  if (!data.item) {
    return { isPlaying: false };
  }

  return {
    isPlaying: data.is_playing,
    title: data.item.name || "Unknown",
    artist:
      data.item.artists?.map((artist) => artist.name).join(", ") || "Unknown",
    album: data.item.album?.name || "Unknown",
    albumArt: data.item.album?.images?.[0]?.url || "",
    songUrl: data.item.external_urls?.spotify || "",
    progress: data.progress_ms || 0,
    duration: data.item.duration_ms || 0,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

  try {
    const nowPlaying = await getNowPlaying();
    return res.status(200).json(nowPlaying);
  } catch (error) {
    console.error("Spotify API error:", error);
    return res.status(500).json({ isPlaying: false });
  }
}
