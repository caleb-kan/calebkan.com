(function() {
  'use strict';

  const API_URL = '/api/github-contributions';
  const POLL_INTERVAL = 60000; // 1 minute
  const CELL_SIZE = 11;
  const CELL_GAP = 3;
  const STROKE_PADDING = 2; // Padding to prevent stroke clipping

  // GitHub's official contribution colors
  const CONTRIBUTION_COLORS_DARK = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
  const CONTRIBUTION_COLORS_LIGHT = ['#ebedf0', '#9be9a8', '#30c463', '#30a14e', '#216e39'];

  let cachedData = null;
  let pollTimeoutId = null;
  let inFlight = false;
  let isActive = false;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function calculateQuartiles(data) {
    if (!data || !data.contributions) return [0, 1, 3, 6];

    const counts = data.contributions
      .map(function(d) { return d.count; })
      .filter(function(c) { return c > 0; })
      .sort(function(a, b) { return a - b; });

    if (counts.length === 0) return [0, 1, 3, 6];

    const q1 = counts[Math.floor(counts.length * 0.25)] || 1;
    const q2 = counts[Math.floor(counts.length * 0.50)] || 3;
    const q3 = counts[Math.floor(counts.length * 0.75)] || 6;

    return [0, q1, q2, q3];
  }

  function getContributionLevel(count, quartiles) {
    if (count === 0) return 0;
    if (count <= quartiles[1]) return 1;
    if (count <= quartiles[2]) return 2;
    if (count <= quartiles[3]) return 3;
    return 4;
  }

  function getStrokeColor() {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';
  }

  function getContributionColors() {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? CONTRIBUTION_COLORS_DARK : CONTRIBUTION_COLORS_LIGHT;
  }

  function getStartDate() {
    const today = new Date();
    // Use UTC to match GitHub API dates
    const dayOfWeek = today.getUTCDay();
    // Go to start of current week (Sunday) in UTC
    const startOfWeek = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - dayOfWeek - 52 * 7
    ));
    return startOfWeek;
  }

  function formatDate(date) {
    // Format as UTC date to match GitHub API
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function buildContributionMap(data) {
    const map = {};
    if (data && data.contributions) {
      data.contributions.forEach(function(day) {
        map[day.date] = day.count;
      });
    }
    return map;
  }

  function createSquare(week, day, date, count, quartiles) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const level = getContributionLevel(count, quartiles);
    const colors = getContributionColors();

    rect.setAttribute('width', CELL_SIZE);
    rect.setAttribute('height', CELL_SIZE);
    rect.setAttribute('x', week * (CELL_SIZE + CELL_GAP));
    rect.setAttribute('y', day * (CELL_SIZE + CELL_GAP));
    rect.setAttribute('rx', '5.5');

    // Apply stroke to all squares for better definition
    rect.setAttribute('stroke', getStrokeColor());
    rect.setAttribute('stroke-width', '1');

    // Set fill based on contribution level
    rect.setAttribute('fill', colors[level]);

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = count + ' contributions on ' + date;
    rect.appendChild(title);

    return rect;
  }

  function renderCalendar(container, data) {
    const startDate = getStartDate();
    const weeks = 53;
    const contributionMap = buildContributionMap(data);
    const quartiles = calculateQuartiles(data);
    const currentDate = new Date(startDate);
    // Use UTC for "today" to match GitHub API dates
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const svgWidth = weeks * (CELL_SIZE + CELL_GAP) - CELL_GAP + (2 * STROKE_PADDING);
    const svgHeight = 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP + (2 * STROKE_PADDING);

    svg.setAttribute('viewBox', (-STROKE_PADDING) + ' ' + (-STROKE_PADDING) + ' ' + svgWidth + ' ' + svgHeight);

    renderLoop: for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        if (currentDate > today) break renderLoop;

        const dateStr = formatDate(currentDate);
        const count = contributionMap[dateStr] || 0;
        const square = createSquare(week, day, dateStr, count, quartiles);

        svg.appendChild(square);
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    }

    container.innerHTML = '';
    container.appendChild(svg);
  }

  function fetchCalendar() {
    return fetch(API_URL)
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to fetch');
        return response.json();
      });
  }

  function updateCalendarTheme() {
    if (cachedData) {
      const container = document.getElementById('github-calendar');
      if (container) renderCalendar(container, cachedData);
    }
  }

  function pollOnce() {
    if (!isActive || inFlight) return;

    const container = document.getElementById('github-calendar');
    if (!container) return;

    // Show loading text only on initial load
    if (!cachedData) {
      container.textContent = 'Loading contributions...';
    }

    const pollStartTime = Date.now();
    inFlight = true;

    fetchCalendar()
      .then(function(data) {
        cachedData = data;
        renderCalendar(container, data);
      })
      .catch(function(error) {
        console.error('Error loading GitHub contributions:', error);
        if (!cachedData) {
          container.textContent = 'Unable to load contributions';
        }
      })
      .finally(function() {
        inFlight = false;
        if (!isActive) return;

        // Schedule next poll relative to when this poll started
        const elapsed = Date.now() - pollStartTime;
        const delay = Math.max(0, POLL_INTERVAL - elapsed);
        pollTimeoutId = setTimeout(function() {
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

  ready(function() {
    startPolling();

    // Update colors when theme changes
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.attributeName === 'class') {
          updateCalendarTheme();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Pause polling when tab is hidden
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    });
  });
})();
