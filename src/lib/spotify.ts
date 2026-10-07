export const POLL_INTERVAL_ACTIVE = 1000; // Match --spotify-progress-duration in CSS.
export const POLL_INTERVAL_IDLE = 5000;
export const POLL_INTERVAL_BACKOFF = 30000;
export const MAX_CONSECUTIVE_ERRORS = 3;
export const FETCH_TIMEOUT_MS = 5000;
export const RESIZE_DEBOUNCE = 150;
export const MARQUEE_MOVE_FRACTION = 0.35; // Match the CSS movement phases (10%-45%, 55%-90%).
const MARQUEE_SPEED_PX_PER_SEC = 30;
const MARQUEE_MIN_DURATION_SEC = 4;
const SECONDS_PER_MINUTE = 60;
const ZERO_PAD_THRESHOLD = 10;
const PERCENT = 100;
const MS_PER_S = 1000;
const SPOTIFY_LINK_HOST = "open.spotify.com";
const SPOTIFY_CDN_HOST_SUFFIX = ".scdn.co"; // Match the CSP img-src directive.

// A transparent pixel keeps failed or unavailable artwork from showing a broken image.
export const PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export interface SpotifyData {
  isPlaying: boolean;
  title: string;
  artist: string;
  album: string;
  albumArt: string;
  songUrl: string;
  progress: number;
  duration: number;
}

export function parseSpotifyData(value: unknown): SpotifyData {
  if (
    typeof value !== "object" ||
    value === null ||
    !("isPlaying" in value) ||
    typeof value.isPlaying !== "boolean"
  ) {
    throw new Error("Spotify API returned unexpected response shape");
  }
  const text = (key: string): string => {
    const field: unknown = Reflect.get(value, key);
    return typeof field === "string" ? field : "";
  };
  const milliseconds = (key: string): number => {
    const field: unknown = Reflect.get(value, key);
    return typeof field === "number" && Number.isFinite(field)
      ? Math.max(0, field)
      : 0;
  };
  return {
    isPlaying: value.isPlaying,
    title: text("title"),
    artist: text("artist"),
    album: text("album"),
    albumArt: text("albumArt"),
    songUrl: text("songUrl"),
    progress: milliseconds("progress"),
    duration: milliseconds("duration"),
  };
}

export function isSafeSongUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && parsed.hostname === SPOTIFY_LINK_HOST
    );
  } catch {
    return false;
  }
}

export function isSafeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(SPOTIFY_CDN_HOST_SUFFIX)
    );
  } catch {
    return false;
  }
}

export function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / MS_PER_S);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${seconds < ZERO_PAD_THRESHOLD ? "0" : ""}${seconds}`;
}

export interface ProgressPosition {
  fraction: number;
  percentage: number;
  text: string;
}

export function progressPosition(
  progress: number,
  duration: number,
): ProgressPosition {
  const elapsed = Math.max(0, Math.min(progress, duration));
  const fraction = duration > 0 ? elapsed / duration : 0;
  const percentage = Math.round(fraction * PERCENT);
  return {
    fraction,
    percentage,
    text:
      duration > 0
        ? `${formatTime(elapsed)} of ${formatTime(duration)}`
        : `${percentage}%`,
  };
}

export function marqueeDuration(
  titleOverflow: number,
  artistOverflow: number,
): string {
  const maxOverflow = Math.max(titleOverflow, artistOverflow);
  return `${Math.max(maxOverflow / MARQUEE_SPEED_PX_PER_SEC / MARQUEE_MOVE_FRACTION, MARQUEE_MIN_DURATION_SEC)}s`;
}

export interface SpotifyTrack {
  title: string;
  artist: string;
  songUrl: string | undefined;
  artUrl: string;
  artAlt: string;
  failedArtUrl: string | null;
}

export interface PlaybackSample {
  progress: number;
  duration: number;
  instant: boolean;
}

export interface SpotifyState {
  hidden: boolean;
  trackId: string | null;
  track: SpotifyTrack | null;
  sample: PlaybackSample | null;
}

export const INITIAL_SPOTIFY_STATE: SpotifyState = {
  hidden: true,
  trackId: null,
  track: null,
  sample: null,
};

export type SpotifyAction =
  | { type: "playback"; data: SpotifyData; resumed: boolean }
  | { type: "art-error"; url: string };

export function spotifyReducer(
  state: SpotifyState,
  action: SpotifyAction,
): SpotifyState {
  if (action.type === "art-error") {
    if (
      !state.track ||
      state.track.artUrl !== action.url ||
      action.url === PLACEHOLDER_IMAGE
    )
      return state;
    return {
      ...state,
      track: {
        ...state.track,
        artUrl: PLACEHOLDER_IMAGE,
        failedArtUrl: action.url,
      },
    };
  }

  const { data, resumed } = action;
  if (!data.isPlaying)
    return { ...state, hidden: true, trackId: null, sample: null };
  const trackId = data.songUrl || JSON.stringify([data.title, data.artist]);
  const isNewTrack = trackId !== state.trackId;
  const safeArt = isSafeImageUrl(data.albumArt);
  const title = data.title || "Unknown";
  const artist = data.artist || "Unknown";
  const songUrl = isSafeSongUrl(data.songUrl) ? data.songUrl : undefined;
  const artAlt = data.album ? `${data.album} album art` : "Album art";
  const failedArtUrl =
    !isNewTrack && safeArt && data.albumArt === state.track?.failedArtUrl
      ? data.albumArt
      : null;
  const artUrl = safeArt && !failedArtUrl ? data.albumArt : PLACEHOLDER_IMAGE;
  let track = state.track;
  if (
    isNewTrack ||
    !track ||
    track.title !== title ||
    track.artist !== artist ||
    track.songUrl !== songUrl ||
    track.artUrl !== artUrl ||
    track.artAlt !== artAlt ||
    track.failedArtUrl !== failedArtUrl
  ) {
    track = {
      title,
      artist,
      songUrl,
      artUrl,
      artAlt,
      failedArtUrl,
    };
  }
  return {
    hidden: false,
    trackId,
    track,
    sample: {
      progress: data.progress,
      duration: data.duration,
      instant: isNewTrack || resumed,
    },
  };
}
