import { isAbortError, isRecord } from "./types";
import type { ContributionsResponse, GitHubEnv } from "./types";

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

let cachedData: ContributionsResponse | null = null;
let cacheExpiresAt = 0;
let contributionsRequest: Promise<ContributionsResponse> | null = null;

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

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      // We only need the status. Abort the unread body before clearing its
      // deadline, without waiting for a stream cancellation promise.
      controller.abort();
      throw new Error(`GitHub API failed: ${response.status}`);
    }
    // Keep the deadline active until the entire body has arrived.
    return await response.json().catch((parseError: unknown) => {
      if (isAbortError(parseError)) throw parseError;
      throw new Error("GitHub API returned non-JSON response", {
        cause: parseError,
      });
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchContributions(
  env: GitHubEnv,
): Promise<ContributionsResponse> {
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    throw new Error("Missing GITHUB_TOKEN environment variable");
  }
  const now = Date.now();
  if (cachedData && now < cacheExpiresAt) {
    return cachedData;
  }
  if (contributionsRequest) return contributionsRequest;

  const pending = fetchFreshContributions(GITHUB_TOKEN, now);
  contributionsRequest = pending;
  try {
    return await pending;
  } finally {
    if (contributionsRequest === pending) contributionsRequest = null;
  }
}

async function fetchFreshContributions(
  token: string,
  requestedAt: number,
): Promise<ContributionsResponse> {
  const json = await fetchWithTimeout(GITHUB_GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": GITHUB_USER_AGENT,
    },
    body: JSON.stringify({
      query: CONTRIBUTIONS_QUERY,
      variables: { username: GITHUB_USERNAME },
    }),
  });

  if (!isRecord(json)) {
    throw new Error("GitHub API returned an invalid response");
  }

  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const firstError: unknown = json.errors[0];
    const msg =
      (isRecord(firstError) && firstError.message) ||
      JSON.stringify(firstError);
    throw new Error(`GitHub API error: ${msg}`);
  }

  if (!isRecord(json.data) || !isRecord(json.data.user)) {
    throw new Error(
      `GitHub user "${GITHUB_USERNAME}" not found or not accessible`,
    );
  }
  const collection = json.data.user.contributionsCollection;
  const calendar = isRecord(collection) && collection.contributionCalendar;
  if (!isRecord(calendar) || !Array.isArray(calendar.weeks)) {
    throw new Error("GitHub API response missing contribution calendar data");
  }

  // Transform to expected format: { contributions: [{ date, count }] }
  const contributions: ContributionsResponse["contributions"] = [];
  const seenDates = new Set<string>();
  const weeks: unknown[] = calendar.weeks;
  for (const week of weeks) {
    if (!isRecord(week) || !Array.isArray(week.contributionDays)) {
      throw new Error("GitHub API response has invalid contribution weeks");
    }
    const days: unknown[] = week.contributionDays;
    for (const day of days) {
      if (
        !isRecord(day) ||
        typeof day.date !== "string" ||
        !isCalendarDate(day.date) ||
        seenDates.has(day.date) ||
        typeof day.contributionCount !== "number" ||
        !Number.isSafeInteger(day.contributionCount) ||
        day.contributionCount < 0
      ) {
        throw new Error("GitHub API response has invalid contribution days");
      }
      seenDates.add(day.date);
      contributions.push({
        date: day.date,
        count: day.contributionCount,
      });
    }
  }

  const data = { contributions };
  cachedData = data;
  cacheExpiresAt = requestedAt + CACHE_DURATION_SECONDS * MS_PER_S;

  return data;
}

export default async function handler(
  request: Request,
  env: GitHubEnv,
): Promise<Response> {
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
