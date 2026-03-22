const GITHUB_USERNAME = "caleb-kan";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_GRAPHQL_API = "https://api.github.com/graphql";
const FETCH_TIMEOUT_MS = 5000;
const MS_PER_S = 1000;

// 1 minute: balances freshness against GitHub API rate limits (5000 req/hr)
const CACHE_DURATION_SECONDS = 60;

const HTTP_OK = 200;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const ALLOWED_METHOD = "GET";

let cachedData = null;
let cacheExpiresAt = 0;

const CONTRIBUTIONS_QUERY = `
query($username: String!) {
  user(login: $username) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
  }
}
`;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchContributions() {
  const now = Date.now();
  if (cachedData && now < cacheExpiresAt) {
    return cachedData;
  }

  if (!GITHUB_TOKEN) {
    throw new Error("Missing GITHUB_TOKEN environment variable");
  }

  const response = await fetchWithTimeout(GITHUB_GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: CONTRIBUTIONS_QUERY,
      variables: { username: GITHUB_USERNAME },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status}`);
  }

  const json = await response.json().catch((parseError) => {
    throw new Error("GitHub API returned non-JSON response", {
      cause: parseError,
    });
  });

  if (json.errors && json.errors.length > 0) {
    const msg = json.errors[0].message || JSON.stringify(json.errors[0]);
    throw new Error(`GitHub API error: ${msg}`);
  }

  if (!json.data?.user) {
    throw new Error(
      `GitHub user "${GITHUB_USERNAME}" not found or not accessible`,
    );
  }
  const calendar = json.data.user.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error("GitHub API response missing contribution calendar data");
  }

  // Transform to expected format: { contributions: [{ date, count }] }
  const contributions = [];
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      contributions.push({
        date: day.date,
        count: day.contributionCount,
      });
    }
  }

  const data = { contributions };
  cachedData = data;
  cacheExpiresAt = now + CACHE_DURATION_SECONDS * MS_PER_S;

  return data;
}

export default async function handler(req, res) {
  if (req.method !== ALLOWED_METHOD) {
    res.setHeader("Allow", ALLOWED_METHOD);
    return res
      .status(HTTP_METHOD_NOT_ALLOWED)
      .json({ error: "Method not allowed" });
  }

  // Browsers always fetch fresh (max-age=0); Vercel CDN caches for CACHE_DURATION_SECONDS with equal stale-while-revalidate
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${CACHE_DURATION_SECONDS}, stale-while-revalidate=${CACHE_DURATION_SECONDS}`,
  );

  try {
    const data = await fetchContributions();
    return res.status(HTTP_OK).json(data);
  } catch (error) {
    console.error("GitHub contributions API error:", error);
    return res
      .status(HTTP_INTERNAL_SERVER_ERROR)
      .json({ error: "Failed to fetch contributions" });
  }
}
