const API_URL = "/api/github-contributions";
// Keep the Worker API cache duration and the browser polling cadence in sync.
export const CALENDAR_POLL_INTERVAL = 60000;
const FETCH_TIMEOUT_MS = 5000;
export const CELL_SIZE = 11;
const CELL_GAP = 3;
const STROKE_PADDING = 2;
export const CELL_CORNER_RADIUS = 2;
export const STROKE_WIDTH = 1;
const ISO_DATE_LENGTH = 10;
const DAYS_PER_WEEK = 7;
const WEEKS_BACK = 52;
const WEEKS = WEEKS_BACK + 1;
const Q1_FRACTION = 0.25;
const Q2_FRACTION = 0.5;
const Q3_FRACTION = 0.75;
const MAX_CONSECUTIVE_ERRORS = 5;
const END_OF_DAY_H = 23;
const END_OF_DAY_M = 59;
const END_OF_DAY_S = 59;
const END_OF_DAY_MS = 999;
const CONTRIBUTION_COLORS_DARK = [
  "#161b22",
  "#0e4429",
  "#006d32",
  "#26a641",
  "#39d353",
] as const;
const CONTRIBUTION_COLORS_LIGHT = [
  "#ebedf0",
  "#9be9a8",
  "#40c463",
  "#30a14e",
  "#216e39",
] as const;
const STROKE_OPACITY = 0.4;
const STROKE_COLOR_DARK = `rgba(255, 255, 255, ${STROKE_OPACITY})`;
const STROKE_COLOR_LIGHT = `rgba(0, 0, 0, ${STROKE_OPACITY})`;

// Keep the CSS --calendar-aspect-ratio in sync with these dimensions.
const SVG_WIDTH =
  WEEKS * (CELL_SIZE + CELL_GAP) - CELL_GAP + 2 * STROKE_PADDING;
const SVG_HEIGHT =
  DAYS_PER_WEEK * (CELL_SIZE + CELL_GAP) - CELL_GAP + 2 * STROKE_PADDING;
export const CALENDAR_VIEW_BOX = `${-STROKE_PADDING} ${-STROKE_PADDING} ${SVG_WIDTH} ${SVG_HEIGHT}`;

export interface Contribution {
  date: string;
  count: number;
}

export interface CalendarData {
  contributions: Contribution[];
}

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;
type Quartiles = readonly [number, number, number, number];
const DEFAULT_QUARTILES: Quartiles = [0, 1, 3, 6];

export interface CalendarCell {
  date: string;
  x: number;
  y: number;
  level: ContributionLevel;
  title: string;
}

export function calculateQuartiles(data: CalendarData): Quartiles {
  const counts = data.contributions
    .map((day) => day.count)
    .filter((count) => count > 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return DEFAULT_QUARTILES;

  const q1 = counts[Math.floor(counts.length * Q1_FRACTION)] ?? 0;
  const q2 = Math.max(
    counts[Math.floor(counts.length * Q2_FRACTION)] ?? 0,
    q1 + 1,
  );
  const q3 = Math.max(
    counts[Math.floor(counts.length * Q3_FRACTION)] ?? 0,
    q2 + 1,
  );
  return [0, q1, q2, q3];
}

export function getContributionLevel(
  count: number,
  [, q1, q2, q3]: Quartiles,
): ContributionLevel {
  if (count === 0) return 0;
  if (count <= q1) return 1;
  if (count <= q2) return 2;
  if (count <= q3) return 3;
  return 4;
}

export function getCalendarColors(isDark: boolean) {
  return {
    colors: isDark ? CONTRIBUTION_COLORS_DARK : CONTRIBUTION_COLORS_LIGHT,
    stroke: isDark ? STROKE_COLOR_DARK : STROKE_COLOR_LIGHT,
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

export function buildCalendarCells(
  data: CalendarData,
  now = new Date(),
): CalendarCell[] {
  const currentDate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - now.getUTCDay() - WEEKS_BACK * DAYS_PER_WEEK,
    ),
  );
  const today = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      END_OF_DAY_H,
      END_OF_DAY_M,
      END_OF_DAY_S,
      END_OF_DAY_MS,
    ),
  );
  const contributionMap = new Map(
    data.contributions.map((day) => [day.date, day.count]),
  );
  const quartiles = calculateQuartiles(data);
  const cells: CalendarCell[] = [];
  for (let week = 0; week < WEEKS; week++) {
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      if (currentDate > today) return cells;
      const date = formatDate(currentDate);
      const count = contributionMap.get(date) ?? 0;
      const noun = count === 1 ? "contribution" : "contributions";
      cells.push({
        date,
        x: week * (CELL_SIZE + CELL_GAP),
        y: day * (CELL_SIZE + CELL_GAP),
        level: getContributionLevel(count, quartiles),
        title: `${count} ${noun} on ${date}`,
      });
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
  }
  return cells;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseCalendarData(value: unknown): CalendarData {
  if (!isRecord(value) || !Array.isArray(value.contributions)) {
    throw new Error("GitHub API returned unexpected response shape");
  }
  const contributions = value.contributions.map((day: unknown) => {
    if (
      !isRecord(day) ||
      typeof day.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
      typeof day.count !== "number" ||
      !Number.isSafeInteger(day.count) ||
      day.count < 0
    ) {
      throw new Error("GitHub API returned unexpected contribution data");
    }
    return { date: day.date, count: day.count };
  });
  return { contributions };
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

interface CalendarPollingOptions {
  visibility: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >;
  onUpdate: (cells: CalendarCell[]) => void;
  onError: () => void;
  fetcher?: typeof fetch;
}

/** Owns one mounted calendar's polling lifecycle, including its pending request. */
export function startCalendarPolling({
  visibility,
  onUpdate,
  onError,
  fetcher = fetch,
}: CalendarPollingOptions): () => void {
  let cachedJson: string | null = null;
  let renderedDate: string | null = null;
  let hasRendered = false;
  let pollTimeout: ReturnType<typeof setTimeout> | undefined;
  let requestTimeout: ReturnType<typeof setTimeout> | undefined;
  let activeRequest: AbortController | undefined;
  let inFlight = false;
  let isActive = false;
  let consecutiveErrors = 0;
  let stoppedByErrors = false;
  let disposed = false;

  function stopPolling() {
    isActive = false;
    clearTimeout(pollTimeout);
    pollTimeout = undefined;
  }

  async function fetchCalendar(): Promise<CalendarData> {
    const controller = new AbortController();
    activeRequest = controller;
    requestTimeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetcher(API_URL, { signal: controller.signal });
      if (!response.ok) {
        // Release the unused body before clearing the request deadline.
        controller.abort();
        throw new Error(`GitHub API returned HTTP ${response.status}`);
      }
      const data: unknown = await response.json().catch((error: unknown) => {
        if (isAbortError(error)) throw error;
        throw new Error("GitHub API returned non-JSON response", {
          cause: error,
        });
      });
      return parseCalendarData(data);
    } finally {
      clearTimeout(requestTimeout);
      requestTimeout = undefined;
      activeRequest = undefined;
    }
  }

  async function pollOnce(): Promise<void> {
    if (!isActive || inFlight || disposed) return;
    const pollStartTime = Date.now();
    inFlight = true;
    try {
      const data = await fetchCalendar();
      if (disposed) return;
      consecutiveErrors = 0;
      const json = JSON.stringify(data);
      const now = new Date();
      const today = formatDate(now);
      if (json !== cachedJson || today !== renderedDate) {
        try {
          onUpdate(buildCalendarCells(data, now));
          cachedJson = json;
          renderedDate = today;
          hasRendered = true;
        } catch (error) {
          console.error("Error rendering GitHub calendar:", error);
          // Keep the last good render and retry transient render failures.
          if (!hasRendered) onError();
        }
      }
    } catch (error) {
      if (disposed) return;
      if (isAbortError(error)) {
        console.warn("GitHub calendar: fetch timed out");
        return;
      }
      consecutiveErrors++;
      console.error("Error loading GitHub contributions:", error);
      if (!hasRendered) onError();
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `GitHub calendar: stopping polling after ${MAX_CONSECUTIVE_ERRORS} consecutive failures`,
        );
        stoppedByErrors = true;
        stopPolling();
      }
    } finally {
      inFlight = false;
      if (isActive && !disposed) {
        const elapsed = Date.now() - pollStartTime;
        pollTimeout = setTimeout(
          () => {
            pollTimeout = undefined;
            void pollOnce();
          },
          Math.max(0, CALENDAR_POLL_INTERVAL - elapsed),
        );
      }
    }
  }

  function startPolling() {
    if (isActive || disposed) return;
    isActive = true;
    void pollOnce();
  }

  function handleVisibility() {
    if (visibility.hidden) {
      stopPolling();
    } else if (!stoppedByErrors) {
      consecutiveErrors = 0;
      startPolling();
    }
  }

  visibility.addEventListener("visibilitychange", handleVisibility);
  if (!visibility.hidden) startPolling();

  return () => {
    disposed = true;
    stopPolling();
    clearTimeout(requestTimeout);
    activeRequest?.abort();
    visibility.removeEventListener("visibilitychange", handleVisibility);
  };
}
