import type { Page } from "@playwright/test";

export const FIXED_TIME = new Date("2026-09-22T12:00:00Z");
export const PLACEHOLDER_IMAGE =
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
export const contributions = {
  contributions: Array.from({ length: 365 }, (_, index) => ({
    date: new Date(FIXED_TIME.getTime() - index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count: index % 13,
  })),
};
export const playing = {
  isPlaying: true,
  title: "Migration test track",
  artist: "Test artist",
  album: "Test album",
  albumArt: "https://i.scdn.co/image/migration-test",
  songUrl: "https://open.spotify.com/track/migration-test",
  progress: 30_000,
  duration: 180_000,
};

export async function mockServices(page: Page, active = false) {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.route("**/api/github-contributions", (route) =>
    route.fulfill({ json: contributions }),
  );
  await page.route("**/api/now-playing", (route) =>
    route.fulfill({ json: active ? playing : { isPlaying: false } }),
  );
  await page.route("https://i.scdn.co/**", (route) =>
    route.fulfill({
      contentType: "image/gif",
      body: Buffer.from(PLACEHOLDER_IMAGE, "base64"),
    }),
  );
}
