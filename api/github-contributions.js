const GITHUB_USERNAME = "caleb-kan";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_GRAPHQL_API = "https://api.github.com/graphql";
const FETCH_TIMEOUT_MS = 5000;

// Cache contributions for 1 minute
const CACHE_DURATION_SECONDS = 60;

let cachedData = null;
let cacheExpiresAt = 0;

const CONTRIBUTIONS_QUERY = `
query($username: String!) {
  user(login: $username) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
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

  const json = await response.json().catch(() => {
    throw new Error("GitHub API returned non-JSON response");
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
  cacheExpiresAt = now + CACHE_DURATION_SECONDS * 1000;

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Browsers always fetch fresh (max-age=0); Vercel CDN caches for 60s with 60s stale-while-revalidate
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${CACHE_DURATION_SECONDS}, stale-while-revalidate=${CACHE_DURATION_SECONDS}`,
  );

  try {
    const data = await fetchContributions();
    return res.status(200).json(data);
  } catch (error) {
    console.error("GitHub contributions API error:", error);
    return res.status(500).json({ error: "Failed to fetch contributions" });
  }
}
