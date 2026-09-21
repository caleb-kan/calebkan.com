const GITHUB_USERNAME = "caleb-kan";
const GITHUB_USER_AGENT = "calebkan.com";
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
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub API failed: ${response.status}`);
    }
    // Keep the deadline active until the entire body has arrived.
    return await response.json().catch((parseError) => {
      if (parseError.name === "AbortError") throw parseError;
      throw new Error("GitHub API returned non-JSON response", {
        cause: parseError,
      });
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchContributions(env) {
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    throw new Error("Missing GITHUB_TOKEN environment variable");
  }
  const now = Date.now();
  if (cachedData && now < cacheExpiresAt) {
    return cachedData;
  }

  const json = await fetchWithTimeout(GITHUB_GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": GITHUB_USER_AGENT,
    },
    body: JSON.stringify({
      query: CONTRIBUTIONS_QUERY,
      variables: { username: GITHUB_USERNAME },
    }),
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

export default async function handler(request, env) {
  if (request.method !== ALLOWED_METHOD) {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: HTTP_METHOD_NOT_ALLOWED,
        headers: { Allow: ALLOWED_METHOD, "Cache-Control": "no-store" },
      },
    );
  }

  try {
    const data = await fetchContributions(env);
    // Do not extend the lifetime of data already held by a warm Worker.
    const remaining = Math.max(
      0,
      Math.ceil((cacheExpiresAt - Date.now()) / MS_PER_S),
    );
    return Response.json(data, {
      status: HTTP_OK,
      headers: { "Cache-Control": `public, max-age=0, s-maxage=${remaining}` },
    });
  } catch (error) {
    console.error("GitHub contributions API error:", error);
    return Response.json(
      { error: "Failed to fetch contributions" },
      {
        status: HTTP_INTERNAL_SERVER_ERROR,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
