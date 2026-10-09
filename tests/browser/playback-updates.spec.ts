import { expect, test } from "@playwright/test";
import { mockServices, playing } from "./fixtures";

for (const songUrl of ["", "javascript:alert(1)"]) {
  test(`Spotify rescues focused song links when playback URL becomes ${JSON.stringify(songUrl)}`, async ({
    page,
  }) => {
    await mockServices(page);
    let track = { ...playing };
    await page.route("**/api/now-playing", (route) =>
      route.fulfill({ json: track }),
    );
    await page.goto("/");
    const title = page.locator("#spotify-title");
    await expect(title).toHaveAttribute("href", playing.songUrl);
    await title.focus();
    await expect(title).toBeFocused();

    track = {
      ...track,
      songUrl: "https://open.spotify.com/track/next-focused-link",
    };
    await expect(title).toHaveAttribute("href", track.songUrl);
    await expect(title).toBeFocused();

    track = { ...track, songUrl };
    await expect(title).not.toHaveAttribute("href");
    await expect(page.locator("#spotify-card")).toBeVisible();
    await expect(page.locator("#page-title")).toBeFocused();
  });
}

test("Spotify preserves scrolling-control focus when only the song link becomes inert", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockServices(page);
  let track = {
    ...playing,
    title: "A long title that overflows the narrow Spotify player",
  };
  await page.route("**/api/now-playing", (route) =>
    route.fulfill({ json: track }),
  );
  await page.goto("/");
  const control = page.getByRole("button", {
    name: "Pause text or resume text",
  });
  await expect(control).toBeVisible();
  await control.focus();
  await expect(control).toBeFocused();

  track = { ...track, songUrl: "javascript:alert(1)" };
  await expect(page.locator("#spotify-title")).not.toHaveAttribute("href");
  await expect(control).toBeVisible();
  await expect(control).toBeFocused();
});

test("same-track metadata updates refresh artwork and text scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockServices(page);
  let track = { ...playing, title: "Short", artist: "Artist" };
  await page.route("**/api/now-playing", (route) =>
    route.fulfill({ json: track }),
  );
  await page.goto("/");
  const title = page.locator("#spotify-title");
  const artist = page.locator("#spotify-artist");
  const artwork = page.locator("#spotify-album-art");
  await expect(title).toHaveText("Short");
  await expect(title).not.toHaveClass(/marquee/);

  track = {
    ...track,
    title: "An updated track title that overflows the narrow Spotify player",
    artist: "An updated artist name that overflows the narrow Spotify player",
    album: "Updated album",
    albumArt: "https://i.scdn.co/image/updated-metadata",
  };
  await expect(title).toHaveText(track.title);
  await expect(title).toHaveAccessibleName(`${track.title} on Spotify`);
  await expect(artist).toHaveText(track.artist);
  await expect(artwork).toHaveAttribute("src", track.albumArt);
  await expect(artwork).toHaveAttribute("alt", "Updated album album art");
  await expect(title).toHaveClass(/marquee/);
  await expect(artist).toHaveClass(/marquee/);
  const control = page.getByRole("button", {
    name: "Pause text or resume text",
  });
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  // Safari does not focus buttons on pointer clicks. Exercise keyboard focus
  // explicitly before the metadata update removes the scrolling control.
  await control.focus();
  await expect(control).toBeFocused();

  track = { ...track, title: "Short again", artist: "Artist" };
  await expect(title).toHaveText(track.title);
  await expect(artist).toHaveText(track.artist);
  await expect(title).not.toHaveClass(/marquee/);
  await expect(artist).not.toHaveClass(/marquee/);
  await expect(control).toHaveCount(0);
  await expect(title).toBeFocused();
});
