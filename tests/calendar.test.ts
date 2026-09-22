import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CalendarGraphic,
  GithubCalendar,
} from "../src/components/github-calendar";
import {
  buildCalendarCells,
  calculateQuartiles,
  CALENDAR_POLL_INTERVAL,
  getContributionLevel,
  parseCalendarData,
  startCalendarPolling,
  type CalendarCell,
} from "../src/lib/github-calendar";

class Visibility extends EventTarget {
  hidden = false;

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

async function calendarPage(
  t: TestContext,
  fetcher: typeof fetch = async () => Response.json({ contributions: [] }),
  initiallyHidden = false,
) {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: Date.parse("2026-09-19T23:59:00Z"),
  });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  const visibility = new Visibility();
  visibility.hidden = initiallyHidden;
  let cells: CalendarCell[] | null = null;
  let updates = 0;
  let errors = 0;
  let requests = 0;
  const dispose = startCalendarPolling({
    visibility,
    onUpdate: (nextCells) => {
      updates++;
      cells = nextCells;
    },
    onError: () => errors++,
    fetcher: async (...args) => {
      requests++;
      return fetcher(...args);
    },
  });
  t.after(dispose);
  await setImmediate();
  return {
    cells: () => cells,
    updates: () => updates,
    errors: () => errors,
    requests: () => requests,
    dispose,
    visibility,
    async tick(ms = CALENDAR_POLL_INTERVAL) {
      t.mock.timers.tick(ms);
      await setImmediate();
    },
  };
}

test("calendar advances its date window at UTC midnight even if counts are unchanged", async (t) => {
  const page = await calendarPage(t);
  assert.equal(page.cells()?.at(-1)?.date, "2026-09-19");
  await page.tick();
  assert.equal(page.cells()?.at(-1)?.date, "2026-09-20");
  assert.equal(page.cells()?.[0]?.date, "2025-09-21");
});

test("calendar keeps the existing model when data and date have not changed", async (t) => {
  const page = await calendarPage(t);
  await page.tick();
  const cells = page.cells();
  await page.tick();
  assert.equal(page.cells(), cells);
  assert.equal(page.updates(), 2);
});

test("calendar stops after repeated failures and stays stopped after tab restore", async (t) => {
  const page = await calendarPage(t, async () => {
    throw new Error("Offline");
  });
  for (let i = 1; i < 5; i++) await page.tick();
  assert.equal(page.requests(), 5);
  page.visibility.setHidden(true);
  page.visibility.setHidden(false);
  await page.tick();
  assert.equal(page.requests(), 5);
  assert.equal(page.errors(), 5);
});

test("calendar preserves its successful render during failures", async (t) => {
  let online = true;
  const page = await calendarPage(t, async () => {
    if (!online) throw new Error("Offline");
    return Response.json({ contributions: [] });
  });
  const cells = page.cells();
  online = false;
  await page.tick();
  assert.equal(page.cells(), cells);
  assert.equal(page.errors(), 0);
});

test("calendar pauses while hidden and immediately refreshes when visible", async (t) => {
  const page = await calendarPage(t);
  page.visibility.setHidden(true);
  await page.tick(CALENDAR_POLL_INTERVAL * 3);
  assert.equal(page.requests(), 1);
  page.visibility.setHidden(false);
  await setImmediate();
  assert.equal(page.requests(), 2);
});

test("calendar opened in a background tab waits until it becomes visible", async (t) => {
  const page = await calendarPage(t, undefined, true);
  assert.equal(page.requests(), 0);
  await page.tick(CALENDAR_POLL_INTERVAL * 3);
  assert.equal(page.requests(), 0);
  assert.equal(page.updates(), 0);
  assert.equal(page.errors(), 0);

  page.visibility.setHidden(false);
  await setImmediate();
  assert.equal(page.requests(), 1);
  assert.equal(page.updates(), 1);
  page.visibility.setHidden(true);
  await page.tick(CALENDAR_POLL_INTERVAL * 3);
  assert.equal(page.requests(), 1);
});

test("calendar prevents overlapping requests and keeps cadence relative to request start", async (t) => {
  let finishRequest: ((response: Response) => void) | undefined;
  let firstRequest = true;
  const page = await calendarPage(t, async () => {
    if (!firstRequest) return Response.json({ contributions: [] });
    firstRequest = false;
    return new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
  });
  page.visibility.setHidden(true);
  page.visibility.setHidden(false);
  await page.tick(2000);
  assert.equal(page.requests(), 1);
  finishRequest?.(Response.json({ contributions: [] }));
  await setImmediate();
  await page.tick(CALENDAR_POLL_INTERVAL - 2001);
  assert.equal(page.requests(), 1);
  await page.tick(1);
  assert.equal(page.requests(), 2);
});

test("a successful calendar response resets consecutive failure escalation", async (t) => {
  let calls = 0;
  const page = await calendarPage(t, async () => {
    calls++;
    if (calls === 5) return Response.json({ contributions: [] });
    throw new Error("Offline");
  });
  for (let i = 1; i < 9; i++) await page.tick();
  assert.equal(page.requests(), 9);
  assert.equal(page.updates(), 1);
  await page.tick();
  assert.equal(page.requests(), 10);
  await page.tick();
  assert.equal(page.requests(), 10);
});

test("calendar releases failed response bodies while preserving its render and HTTP error stop", async (t) => {
  let failing = false;
  let releasedBodies = 0;
  const page = await calendarPage(t, async (_url, options) => {
    if (!failing) return Response.json({ contributions: [] });
    const signal = options?.signal;
    assert.ok(signal);
    return new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener(
            "abort",
            () => {
              releasedBodies++;
              controller.error(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        },
      }),
      { status: 503 },
    );
  });
  const cells = page.cells();
  failing = true;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.tick();
    assert.equal(releasedBodies, attempt);
    assert.equal(page.cells(), cells);
  }
  assert.equal(page.errors(), 0);
  assert.equal(page.requests(), 6);
  page.visibility.setHidden(true);
  page.visibility.setHidden(false);
  await page.tick();
  assert.equal(page.requests(), 6);
});

test("calendar aborts stalled response bodies without escalating timeout errors", async (t) => {
  const page = await calendarPage(t, async (_url, options) => {
    const signal = options?.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        },
      }),
    );
  });
  for (let i = 0; i < 6; i++) {
    await page.tick(5000);
    await page.tick(CALENDAR_POLL_INTERVAL - 5000);
  }
  assert.equal(page.requests(), 7);
  assert.equal(page.errors(), 0);
});

test("calendar cleanup aborts in-flight work and removes visibility listeners", async (t) => {
  let signal: AbortSignal | null | undefined;
  let finishRequest: ((response: Response) => void) | undefined;
  const page = await calendarPage(t, async (_url, options) => {
    signal = options?.signal;
    return new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
  });
  page.dispose();
  assert.equal(signal?.aborted, true);
  finishRequest?.(Response.json({ contributions: [] }));
  await setImmediate();
  page.visibility.setHidden(true);
  page.visibility.setHidden(false);
  await page.tick();
  assert.equal(page.requests(), 1);
  assert.equal(page.updates(), 0);
  assert.equal(page.errors(), 0);
});

test("calendar rejects malformed payloads and invalid contribution values", () => {
  for (const data of [
    null,
    {},
    { contributions: {} },
    { contributions: [null] },
    { contributions: [{ date: "2026-09-19", count: -1 }] },
    { contributions: [{ date: "2026-09-19", count: "3" }] },
    { contributions: [{ date: "2026-09-19", count: Number.NaN }] },
  ]) {
    assert.throws(() => parseCalendarData(data), /unexpected/);
  }
});

test("calendar quartiles retain GitHub palette levels and strictly increasing thresholds", () => {
  assert.deepEqual(calculateQuartiles({ contributions: [] }), [0, 1, 3, 6]);
  const quartiles = calculateQuartiles({
    contributions: Array.from({ length: 4 }, () => ({
      date: "2026-09-19",
      count: 2,
    })),
  });
  assert.deepEqual(quartiles, [0, 2, 3, 4]);
  assert.deepEqual(
    [0, 2, 3, 4, 5].map((count) => getContributionLevel(count, quartiles)),
    [0, 1, 2, 3, 4],
  );
});

test("React calendar preserves the reserved wrapper, SVG geometry, tooltips, and theme colors", () => {
  const placeholder = renderToStaticMarkup(createElement(GithubCalendar));
  assert.equal(
    placeholder,
    '<div id="github-calendar" aria-live="polite">Loading contributions...</div>',
  );
  const cells = buildCalendarCells(
    { contributions: [{ date: "2026-09-19", count: 1 }] },
    new Date("2026-09-19T23:59:00Z"),
  );
  assert.equal(cells.length, 371);
  assert.equal(cells.at(-1)?.title, "1 contribution on 2026-09-19");
  assert.equal(cells.at(-1)?.x, 728);
  assert.equal(cells.at(-1)?.y, 84);
  for (const [isDark, zeroColor, stroke] of [
    [true, "#161b22", "rgba(255, 255, 255, 0.4)"],
    [false, "#ebedf0", "rgba(0, 0, 0, 0.4)"],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(CalendarGraphic, { cells, isDark }),
    );
    assert.ok(html.includes('viewBox="-2 -2 743 99"'));
    assert.ok(html.includes('role="img" aria-labelledby="gh-cal-title"'));
    assert.ok(
      html.includes('<title id="gh-cal-title">GitHub contribution calendar'),
    );
    assert.ok(html.includes('width="11" height="11" x="0" y="0" rx="2"'));
    assert.ok(html.includes(`fill:${zeroColor};stroke:${stroke}`));
    assert.ok(html.includes("<title>1 contribution on 2026-09-19</title>"));
  }
});
