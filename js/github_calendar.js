(function () {
  var GITHUB_USERNAME = 'caleb-kan';
  var API_URL = 'https://github-contributions-api.jogruber.de/v4/';
  var CELL_SIZE = 11;
  var CELL_GAP = 3;
  var STROKE_PADDING = 1; // Padding for stroke on empty squares
  var CONTRIBUTION_COLORS = ['transparent', '#0e4429', '#006d32', '#26a641', '#39d353'];

  var cachedData = null;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function calculateQuartiles(data) {
    if (!data || !data.contributions) return [0, 1, 3, 6];

    var counts = data.contributions
      .map(function(d) { return d.count; })
      .filter(function(c) { return c > 0; })
      .sort(function(a, b) { return a - b; });

    if (counts.length === 0) return [0, 1, 3, 6];

    var q1 = counts[Math.floor(counts.length * 0.25)] || 1;
    var q2 = counts[Math.floor(counts.length * 0.50)] || 3;
    var q3 = counts[Math.floor(counts.length * 0.75)] || 6;

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
    var isDark = document.documentElement.classList.contains('dark');
    return isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';
  }

  function getStartDate() {
    var today = new Date();
    var oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    while (oneYearAgo.getDay() !== 0) {
      oneYearAgo.setDate(oneYearAgo.getDate() - 1);
    }
    return oneYearAgo;
  }

  function getWeekCount(startDate) {
    var today = new Date();
    var weekMs = 7 * 24 * 60 * 60 * 1000;
    var weeks = Math.ceil((today - startDate) / weekMs);
    return Math.min(weeks, 53);
  }

  function formatDate(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function buildContributionMap(data) {
    var map = {};
    if (data && data.contributions) {
      data.contributions.forEach(function(day) {
        map[day.date] = day.count;
      });
    }
    return map;
  }

  function createSquare(week, day, date, count, quartiles) {
    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    var level = getContributionLevel(count, quartiles);

    rect.setAttribute('width', CELL_SIZE);
    rect.setAttribute('height', CELL_SIZE);
    rect.setAttribute('x', week * (CELL_SIZE + CELL_GAP));
    rect.setAttribute('y', day * (CELL_SIZE + CELL_GAP));
    rect.setAttribute('rx', '5.5');

    // Apply stroke to all squares for better definition
    rect.setAttribute('stroke', getStrokeColor());
    rect.setAttribute('stroke-width', '1');

    // Set fill based on contribution level
    if (level === 0) {
      rect.setAttribute('fill', 'transparent');
    } else {
      rect.setAttribute('fill', CONTRIBUTION_COLORS[level]);
    }

    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = count + ' contributions on ' + date;
    rect.appendChild(title);

    return rect;
  }

  function renderCalendar(container, data) {
    var startDate = getStartDate();
    var weeks = getWeekCount(startDate);
    var contributionMap = buildContributionMap(data);
    var quartiles = calculateQuartiles(data);
    var currentDate = new Date(startDate);
    var today = new Date();
    today.setHours(23, 59, 59, 999);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var svgWidth = weeks * (CELL_SIZE + CELL_GAP) - CELL_GAP + (2 * STROKE_PADDING);
    var svgHeight = 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP + (2 * STROKE_PADDING);

    svg.setAttribute('viewBox', (-STROKE_PADDING) + ' ' + (-STROKE_PADDING) + ' ' + svgWidth + ' ' + svgHeight);

    renderLoop: for (var week = 0; week < weeks; week++) {
      for (var day = 0; day < 7; day++) {
        if (currentDate > today) break renderLoop;

        var dateStr = formatDate(currentDate);
        var count = contributionMap[dateStr] || 0;
        var square = createSquare(week, day, dateStr, count, quartiles);

        svg.appendChild(square);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    container.innerHTML = '';
    container.appendChild(svg);
  }

  function loadCalendar() {
    var container = document.getElementById('github-calendar');
    if (!container) return;

    container.textContent = 'Loading contributions...';

    fetch(API_URL + GITHUB_USERNAME)
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to fetch');
        return response.json();
      })
      .then(function(data) {
        cachedData = data;
        renderCalendar(container, data);
      })
      .catch(function(error) {
        console.error('Error loading GitHub contributions:', error);
        container.textContent = 'Unable to load contributions';
      });
  }

  function updateCalendarTheme() {
    if (cachedData) {
      var container = document.getElementById('github-calendar');
      if (container) renderCalendar(container, cachedData);
    }
  }

  ready(function () {
    loadCalendar();

    var observer = new MutationObserver(function(mutations) {
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
  });
})();
