import { expect, test, type Page } from "@playwright/test";
import { contributions, mockServices } from "./fixtures";

async function calendarGeometry(page: Page) {
  return page.locator(".card-main, #github-calendar").evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}

for (const { width, font } of [
  { width: 1440, font: "system-ui" },
  { width: 375, font: "system-ui" },
  { width: 320, font: "system-ui" },
  { width: 320, font: "Verdana" },
]) {
  test(`email label shares the address baseline at ${width}px with ${font}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockServices(page);
    await page.goto("/");
    await page.evaluate(async (family) => {
      document.body.style.fontFamily = family;
      await document.fonts.ready;
    }, font);
    const baselines = await page
      .locator(".contact-line > *")
      .evaluateAll((elements) =>
        elements.map((element) => {
          // A zero-height inline box sits on the actual text baseline.
          const marker = document.createElement("span");
          marker.style.cssText =
            "display: inline-block; width: 0; height: 0; vertical-align: baseline";
          element.append(marker);
          const baseline = marker.getBoundingClientRect().top;
          marker.remove();
          return baseline;
        }),
      );
    expect(baselines).toHaveLength(2);
    expect(Math.abs(baselines[0] - baselines[1])).toBeLessThanOrEqual(1);
  });
}

for (const { width, textSize } of [
  { width: 1440, textSize: "100%" },
  { width: 375, textSize: "100%" },
  { width: 320, textSize: "200%" },
]) {
  test(`delayed contributions preserve the centered card at ${width}px with ${textSize} text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockServices(page);

    let releaseCalendar!: () => void;
    const calendarReady = new Promise<void>((resolve) => {
      releaseCalendar = resolve;
    });
    await page.route("**/api/github-contributions", async (route) => {
      await calendarReady;
      await route.fulfill({ json: contributions });
    });
    const calendarRequested = page.waitForRequest(
      "**/api/github-contributions",
    );

    try {
      await page.goto("/");
      await calendarRequested;
      await page.evaluate(async (size) => {
        document.documentElement.style.fontSize = size;
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, textSize);
      await expect(page.locator("#spotify-card")).toBeHidden();
      await expect(page.locator("#github-calendar svg")).toHaveCount(0);
      const loadingGeometry = await calendarGeometry(page);
      expect(loadingGeometry).toHaveLength(2);

      releaseCalendar();
      await expect(page.locator("#github-calendar svg")).toBeVisible();
      expect(await calendarGeometry(page)).toEqual(loadingGeometry);
    } finally {
      releaseCalendar();
    }
  });
}

test("enlarged calendar errors preserve the loading space", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockServices(page);
  let releaseCalendar!: () => void;
  const calendarReady = new Promise<void>((resolve) => {
    releaseCalendar = resolve;
  });
  await page.route("**/api/github-contributions", async (route) => {
    await calendarReady;
    await route.fulfill({ status: 503, body: "Temporarily unavailable" });
  });

  try {
    await page.goto("/");
    await page.evaluate(async () => {
      document.documentElement.style.fontSize = "200%";
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    const loadingGeometry = await calendarGeometry(page);
    releaseCalendar();
    await expect(page.locator("#github-calendar")).toHaveText(
      "Unable to display contributions",
    );
    expect(await calendarGeometry(page)).toEqual(loadingGeometry);
  } finally {
    releaseCalendar();
  }
});

test("Spotify text enlarges without overflowing the narrow player", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockServices(page, true);
  await page.goto("/");
  await expect(page.locator("#spotify-card")).toBeVisible();
  await page.evaluate(async () => {
    document.documentElement.style.fontSize = "200%";
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(page.locator(".spotify-header")).toHaveCSS("font-size", "26px");
  await expect(page.locator("#spotify-title")).toHaveCSS("font-size", "32px");
  await expect(page.locator("#spotify-artist")).toHaveCSS("font-size", "28px");
  const geometry = await page.evaluate(() => {
    const card = document.getElementById("spotify-card");
    if (!card) throw new Error("The Spotify player must exist");
    return {
      card: card.getBoundingClientRect().toJSON(),
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      content: Array.from(
        card.querySelectorAll(
          ".spotify-header, #spotify-title, #spotify-artist",
        ),
        (element) => element.getBoundingClientRect().toJSON(),
      ),
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const bounds of geometry.content) {
    expect(bounds.left).toBeGreaterThanOrEqual(geometry.card.left);
    expect(bounds.right).toBeLessThanOrEqual(geometry.card.right);
  }
});

for (const font of ["system-ui", "Verdana"]) {
  test(`the enlarged scrolling control wraps between its words with ${font}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockServices(page, true);
    await page.goto("/");
    await page.evaluate(async (family) => {
      document.body.style.fontFamily = family;
      document.documentElement.style.fontSize = "200%";
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }, font);
    const control = page.getByRole("button", {
      name: "Pause text or resume text",
    });
    await expect(control).toBeVisible();
    await control.click();
    await expect(control).toHaveText("Resume text");
    const label = await control.locator("span").evaluate((element) => {
      const text = element.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) {
        throw new Error(
          "The text-scrolling control must retain its visible label",
        );
      }
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, "Resume".length);
      return {
        wordLines: range.getClientRects().length,
        label: element.getBoundingClientRect().toJSON(),
        control: element.parentElement?.getBoundingClientRect().toJSON(),
      };
    });
    expect(label.wordLines).toBe(1);
    expect(label.control).toBeDefined();
    expect(label.label.right).toBeLessThanOrEqual(label.control.right);
    expect(label.control.height).toBeGreaterThanOrEqual(44);
  });
}

for (const width of [320, 375]) {
  for (const textSize of ["100%", "200%"]) {
    test(`contact content and theme control remain separate at ${width}px with ${textSize} text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mockServices(page, true);
      await page.goto("/");
      await expect(page.locator("#github-calendar svg")).toBeVisible();
      await expect(page.locator("#spotify-card")).toBeVisible();
      await page.evaluate(async (size) => {
        document.documentElement.style.fontSize = size;
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, textSize);

      const layout = await page.evaluate(() => {
        const card = document.querySelector(".card-main");
        const heading = document.getElementById("page-title");
        const toggle = document.querySelector(".theme-toggle");
        if (!card || !heading || !toggle) {
          throw new Error("The portfolio heading and theme control must exist");
        }
        return {
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          card: card.getBoundingClientRect().toJSON(),
          heading: heading.getBoundingClientRect().toJSON(),
          toggle: toggle.getBoundingClientRect().toJSON(),
          content: Array.from(
            card.querySelectorAll(
              '#page-title, a[href^="mailto:"], .social-links, .social-links a',
            ),
            (element) => ({
              name: element.getAttribute("aria-label") || element.className,
              box: element.getBoundingClientRect().toJSON(),
            }),
          ),
        };
      });

      expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
      const overlaps =
        layout.heading.left < layout.toggle.right &&
        layout.heading.right > layout.toggle.left &&
        layout.heading.top < layout.toggle.bottom &&
        layout.heading.bottom > layout.toggle.top;
      expect(overlaps, "The heading must not overlap the theme control").toBe(
        false,
      );
      for (const { name, box } of layout.content) {
        expect(box.left, `${name} left edge`).toBeGreaterThanOrEqual(
          layout.card.left,
        );
        expect(box.right, `${name} right edge`).toBeLessThanOrEqual(
          layout.card.right,
        );
        expect(box.top, `${name} top edge`).toBeGreaterThanOrEqual(
          layout.card.top,
        );
        expect(box.bottom, `${name} bottom edge`).toBeLessThanOrEqual(
          layout.card.bottom,
        );
      }
    });
  }
}

test("portfolio controls retain visible keyboard focus", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockServices(page);
  await page.goto("/");
  const controls = page.locator(".card-main button, .card-main a[href]");
  expect(await controls.count()).toBeGreaterThan(0);
  // Safari on macOS uses Option+Tab to include every clickable item when the
  // system's default keyboard navigation preference excludes buttons and links.
  const nextControl =
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab";

  for (const control of await controls.all()) {
    await page.keyboard.press(nextControl);
    await expect(control).toBeFocused();
    const focus = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(":focus-visible"),
        outlineWidth: parseFloat(style.outlineWidth),
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
      };
    });
    expect(focus.visible).toBe(true);
    expect(focus.outlineWidth).toBeGreaterThan(0);
    expect(focus.outlineStyle).not.toBe("none");
    expect(focus.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("Spotify song links retain an unclipped keyboard focus outline", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockServices(page, true);
  await page.goto("/");
  await expect(page.locator("#spotify-card")).toBeVisible();
  const nextControl =
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab";
  const mainControls = await page
    .locator(".card-main button, .card-main a[href]")
    .count();
  for (let index = 0; index <= mainControls; index++) {
    await page.keyboard.press(nextControl);
  }
  const title = page.locator("#spotify-title");
  await expect(title).toBeFocused();
  const outline = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const extension =
      parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const clippedBy: string[] = [];
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const ancestorStyle = getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      const clipsX = /^(hidden|clip|scroll|auto)$/.test(
        ancestorStyle.overflowX,
      );
      const clipsY = /^(hidden|clip|scroll|auto)$/.test(
        ancestorStyle.overflowY,
      );
      if (
        (clipsX &&
          (box.left - extension < bounds.left ||
            box.right + extension > bounds.right)) ||
        (clipsY &&
          (box.top - extension < bounds.top ||
            box.bottom + extension > bounds.bottom))
      ) {
        clippedBy.push(ancestor.id || ancestor.className || ancestor.tagName);
      }
    }
    return {
      visible: element.matches(":focus-visible"),
      width: parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      clippedBy,
    };
  });
  expect(outline.visible).toBe(true);
  expect(outline.width).toBeGreaterThan(0);
  expect(outline.style).not.toBe("none");
  expect(outline.clippedBy).toEqual([]);
});

test("reduced motion keeps the background still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockServices(page, true);
  await page.goto("/");
  await expect(page.locator("#spotify-card")).toBeVisible();

  const background = await page.evaluate(async () => {
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await nextFrame();
    const before = getComputedStyle(document.body).backgroundPosition;
    await nextFrame();
    await nextFrame();
    return {
      before,
      after: getComputedStyle(document.body).backgroundPosition,
      running: document.body
        .getAnimations()
        .some((animation) => animation.playState === "running"),
    };
  });
  expect(background.after).toBe(background.before);
  expect(background.running).toBe(false);
});

test("glass surfaces stay opaque and untransformed during first load", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockServices(page, true);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const samples = await page.evaluate(async () => {
    const observations: {
      surface: string;
      opacity: string;
      transform: string;
      animatesSurface: boolean;
    }[] = [];
    for (let frame = 0; frame < 8; frame++) {
      for (const card of document.querySelectorAll(
        ".card-main, .card-spotify",
      )) {
        const style = getComputedStyle(card);
        observations.push({
          surface: card.className,
          opacity: style.opacity,
          transform: style.transform,
          animatesSurface: card.getAnimations().some((animation) => {
            const effect = animation.effect;
            return (
              effect instanceof KeyframeEffect &&
              effect
                .getKeyframes()
                .some(
                  (keyframe) =>
                    "opacity" in keyframe || "transform" in keyframe,
                )
            );
          }),
        });
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    return observations;
  });

  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) {
    expect(sample.opacity, `${sample.surface} opacity`).toBe("1");
    expect(sample.transform, `${sample.surface} transform`).toBe("none");
    expect(sample.animatesSurface, `${sample.surface} entrance animation`).toBe(
      false,
    );
  }
});
