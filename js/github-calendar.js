(function () {
  "use strict";

  const API_URL = "/api/github-contributions";
  const POLL_INTERVAL = 60000; // 1 minute: matches CACHE_DURATION_SECONDS in api/github-contributions.js (polling faster only hits CDN cache)
  const FETCH_TIMEOUT_MS = 5000;
  const CELL_SIZE = 11;
  const CELL_GAP = 3;
  const STROKE_PADDING = 2; // Padding to prevent stroke clipping
  const CELL_CORNER_RADIUS = 2;
  const STROKE_WIDTH = 1;
  const ISO_DATE_LENGTH = 10; // "YYYY-MM-DD".length
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DAYS_PER_WEEK = 7;
  const WEEKS_BACK = 52;
  const WEEKS = WEEKS_BACK + 1;
  const Q1_FRACTION = 0.25;
  const Q2_FRACTION = 0.5;
  const Q3_FRACTION = 0.75;

  // Contribution colors matching GitHub's palette
  const CONTRIBUTION_COLORS_DARK = [
    "#161b22",
    "#0e4429",
    "#006d32",
    "#26a641",
    "#39d353",
  ];
  const CONTRIBUTION_COLORS_LIGHT = [
    "#ebedf0",
    "#9be9a8",
    "#40c463",
    "#30a14e",
    "#216e39",
  ];
  const STROKE_OPACITY = 0.4;
  const STROKE_COLOR_DARK = `rgba(255, 255, 255, ${STROKE_OPACITY})`;
  const STROKE_COLOR_LIGHT = `rgba(0, 0, 0, ${STROKE_OPACITY})`;

  const container = document.getElementById("github-calendar");
  if (!container) {
    console.warn("github-calendar: #github-calendar element not found");
    return;
  }

  const MAX_CONSECUTIVE_ERRORS = 5;
  // Fallback quartile boundaries [zero-floor, Q1, Q2, Q3] mapping contribution counts to color levels 0-4
  const DEFAULT_QUARTILES = [0, 1, 3, 6];
  const END_OF_DAY_H = 23;
  const END_OF_DAY_M = 59;
  const END_OF_DAY_S = 59;
  const END_OF_DAY_MS = 999;

  let cachedJson = null;
  let hasRendered = false;
  let pollTimeoutId = null;
  let inFlight = false;
  let isActive = false;
  let consecutiveErrors = 0;

  function calculateQuartiles(data) {
    if (!data || !data.contributions) return DEFAULT_QUARTILES;

    const counts = data.contributions
      .map((d) => d.count)
      .filter((c) => c > 0)
      .sort((a, b) => a - b);

    if (counts.length === 0) return DEFAULT_QUARTILES;

    const q1 = counts[Math.floor(counts.length * Q1_FRACTION)];
    const q2 = Math.max(
      counts[Math.floor(counts.length * Q2_FRACTION)],
      q1 + 1,
    );
    const q3 = Math.max(
      counts[Math.floor(counts.length * Q3_FRACTION)],
      q2 + 1,
    );

    return [0, q1, q2, q3];
  }

  function getContributionLevel(count, [, q1, q2, q3]) {
    if (count === 0) return 0;
    if (count <= q1) return 1;
    if (count <= q2) return 2;
    if (count <= q3) return 3;
    return 4;
  }

  function getThemeColors() {
    const isDark = document.documentElement.classList.contains("dark");
    return {
      colors: isDark ? CONTRIBUTION_COLORS_DARK : CONTRIBUTION_COLORS_LIGHT,
      stroke: isDark ? STROKE_COLOR_DARK : STROKE_COLOR_LIGHT,
    };
  }

  function getStartDate() {
    const today = new Date();
    const dayOfWeek = today.getUTCDay();
    return new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - dayOfWeek - WEEKS_BACK * DAYS_PER_WEEK,
      ),
    );
  }

  function formatDate(date) {
    return date.toISOString().slice(0, ISO_DATE_LENGTH);
  }

  function buildContributionMap(data) {
    const map = {};
    if (data && data.contributions) {
      for (const day of data.contributions) {
        map[day.date] = day.count;
      }
    }
    return map;
  }

  function createSquare(week, day, date, count, quartiles, colors, stroke) {
    const rect = document.createElementNS(SVG_NS, "rect");
    const level = getContributionLevel(count, quartiles);

    rect.setAttribute("width", CELL_SIZE);
    rect.setAttribute("height", CELL_SIZE);
    rect.setAttribute("x", week * (CELL_SIZE + CELL_GAP));
    rect.setAttribute("y", day * (CELL_SIZE + CELL_GAP));
    rect.setAttribute("rx", CELL_CORNER_RADIUS);
    rect.setAttribute("data-level", level);

    rect.setAttribute("stroke-width", STROKE_WIDTH);
    rect.style.fill = colors[level];
    rect.style.stroke = stroke;

    const title = document.createElementNS(SVG_NS, "title");
    const noun = count === 1 ? "contribution" : "contributions";
    title.textContent = `${count} ${noun} on ${date}`;
    rect.appendChild(title);

    return rect;
  }

  function renderCalendar(data) {
    const startDate = getStartDate();
    const contributionMap = buildContributionMap(data);
    const quartiles = calculateQuartiles(data);
    const { colors, stroke } = getThemeColors();
    const currentDate = new Date(startDate);
    const now = new Date();
    // End of today (UTC) so future cells are excluded
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

    const svg = document.createElementNS(SVG_NS, "svg");
    const svgWidth =
      WEEKS * (CELL_SIZE + CELL_GAP) - CELL_GAP + 2 * STROKE_PADDING;
    const svgHeight =
      DAYS_PER_WEEK * (CELL_SIZE + CELL_GAP) - CELL_GAP + 2 * STROKE_PADDING;

    svg.setAttribute(
      "viewBox",
      `${-STROKE_PADDING} ${-STROKE_PADDING} ${svgWidth} ${svgHeight}`,
    );
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", "gh-cal-title");

    const svgTitle = document.createElementNS(SVG_NS, "title");
    svgTitle.id = "gh-cal-title";
    svgTitle.textContent = "GitHub contribution calendar";
    svg.appendChild(svgTitle);

    renderLoop: for (let week = 0; week < WEEKS; week++) {
      for (let day = 0; day < DAYS_PER_WEEK; day++) {
        if (currentDate > today) break renderLoop;

        const dateStr = formatDate(currentDate);
        const count = contributionMap[dateStr] || 0;
        const square = createSquare(
          week,
          day,
          dateStr,
          count,
          quartiles,
          colors,
          stroke,
        );

        svg.appendChild(square);
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    }

    container.replaceChildren(svg);
  }

  function fetchCalendar() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    return fetch(API_URL, { signal: controller.signal })
      .then(function (response) {
        if (!response.ok)
          throw new Error(`GitHub API returned HTTP ${response.status}`);
        return response.json().catch(function (parseError) {
          throw new Error("GitHub API returned non-JSON response", {
            cause: parseError,
          });
        });
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.contributions)) {
          throw new Error("GitHub API returned unexpected response shape");
        }
        return data;
      })
      .finally(() => clearTimeout(timeout));
  }

  function updateCalendarColors() {
    const svg = container.querySelector("svg");
    if (!svg) return;

    const { colors, stroke } = getThemeColors();
    const rects = svg.querySelectorAll("rect[data-level]");

    for (const rect of rects) {
      const level = parseInt(rect.getAttribute("data-level"), 10);
      if (isNaN(level) || level < 0 || level >= colors.length) continue;
      rect.style.fill = colors[level];
      rect.style.stroke = stroke;
    }
  }

  // Update colors when theme changes
  const observer = new MutationObserver(updateCalendarColors);

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  function pollOnce() {
    if (!isActive || inFlight) return;

    const pollStartTime = Date.now();
    inFlight = true;

    fetchCalendar()
      .then(function (data) {
        consecutiveErrors = 0;
        const json = JSON.stringify(data);
        if (json !== cachedJson) {
          try {
            renderCalendar(data);
            cachedJson = json;
            hasRendered = true;
          } catch (renderError) {
            console.error("Error rendering GitHub calendar:", renderError);
            // Do not cache json here: allow the next poll to re-attempt the render
            // in case the failure was transient (e.g. DOM in a bad state during tab restore)
            if (!hasRendered) {
              container.textContent = "Unable to display contributions";
            }
          }
        }
      })
      .catch(function (error) {
        if (error.name === "AbortError") {
          console.warn("GitHub calendar: fetch timed out");
          return;
        }
        consecutiveErrors++;
        console.error("Error loading GitHub contributions:", error);
        if (!hasRendered) {
          container.textContent = "Unable to display contributions";
        }
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(
            `GitHub calendar: stopping polling after ${MAX_CONSECUTIVE_ERRORS} consecutive failures`,
          );
          stopPolling();
        }
      })
      .finally(function () {
        inFlight = false;
        if (!isActive) return;

        // Schedule next poll relative to when this poll started
        const elapsed = Date.now() - pollStartTime;
        const delay = Math.max(0, POLL_INTERVAL - elapsed);
        pollTimeoutId = setTimeout(function () {
          pollTimeoutId = null;
          pollOnce();
        }, delay);
      });
  }

  function startPolling() {
    if (isActive) return;
    isActive = true;
    pollOnce();
  }

  function stopPolling() {
    isActive = false;
    if (pollTimeoutId) clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }

  startPolling();

  // Pause polling when tab is hidden
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopPolling();
    } else {
      consecutiveErrors = 0;
      startPolling();
    }
  });
})();
