const GITHUB_USERNAME = 'caleb-kan';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_GRAPHQL_API = 'https://api.github.com/graphql';

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

async function fetchContributions() {
  const now = Date.now();
  if (cachedData && now < cacheExpiresAt) {
    return cachedData;
  }

  if (!GITHUB_TOKEN) {
    throw new Error('Missing GITHUB_TOKEN environment variable');
  }

  const response = await fetch(GITHUB_GRAPHQL_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: CONTRIBUTIONS_QUERY,
      variables: { username: GITHUB_USERNAME },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(`GitHub API error: ${json.errors[0].message}`);
  }

  const calendar = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error('No contribution data found');
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

const ALLOWED_ORIGINS = new Set([
  'https://calebkan.com',
  'https://www.calebkan.com',
]);

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${CACHE_DURATION_SECONDS}, stale-while-revalidate=60`);
  res.setHeader('Vary', 'Origin');

  try {
    const data = await fetchContributions();
    return res.status(200).json(data);
  } catch (error) {
    console.error('GitHub contributions API error:', error);
    return res.status(500).json({ error: 'Failed to fetch contributions' });
  }
}
