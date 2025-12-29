const GITHUB_USERNAME = 'caleb-kan';
const API_URL = `https://github-contributions-api.jogruber.de/v4/${GITHUB_USERNAME}`;

// Cache contributions for 10 minutes
const CACHE_DURATION_SECONDS = 600;

let cachedData = null;
let cacheExpiresAt = 0;

async function fetchContributions() {
  const now = Date.now();
  if (cachedData && now < cacheExpiresAt) {
    return cachedData;
  }

  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error(`GitHub contributions API failed: ${response.status}`);
  }

  const data = await response.json();
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
  res.setHeader('Cache-Control', `public, s-maxage=${CACHE_DURATION_SECONDS}, stale-while-revalidate=60`);
  res.setHeader('Vary', 'Origin');

  try {
    const data = await fetchContributions();
    return res.status(200).json(data);
  } catch (error) {
    console.error('GitHub contributions API error:', error);
    return res.status(500).json({ error: 'Failed to fetch contributions' });
  }
}
