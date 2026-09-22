export type GitHubEnv = Partial<Pick<Env, "GITHUB_TOKEN">>;

export type SpotifyEnv = Partial<
  Pick<
    Env,
    "SPOTIFY_CLIENT_ID" | "SPOTIFY_CLIENT_SECRET" | "SPOTIFY_REFRESH_TOKEN"
  >
>;

export interface ContributionsResponse {
  contributions: Array<{ date: string; count: number }>;
}

export type NowPlayingResponse =
  | { isPlaying: false }
  | {
      isPlaying: boolean;
      title: string;
      artist: string;
      album: string;
      albumArt: string;
      songUrl: string;
      progress: number;
      duration: number;
    };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}
