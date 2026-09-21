import githubContributions from "../api/github-contributions.js";
import nowPlaying from "../api/now-playing.js";

const APEX_HOST = "calebkan.com";
const CANONICAL_ORIGIN = "https://www.calebkan.com";
const API_PREFIX = "/api/";
const GITHUB_PATH = "/api/github-contributions";
const SPOTIFY_PATH = "/api/now-playing";
const HTTP_PERMANENT_REDIRECT = 308;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-XSS-Protection": "0",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

function withHeaders(response, isApi) {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    result.headers.set(name, value);
  }
  if (isApi) {
    result.headers.set("Access-Control-Allow-Origin", CANONICAL_ORIGIN);
    result.headers.set("Vary", "Origin");
  }
  return result;
}

async function githubResponse(request, env, ctx) {
  if (request.method !== "GET") return githubContributions(request, env);

  // Query strings do not change this public endpoint. Normalize the key so
  // cache-busting parameters cannot force extra upstream GitHub requests.
  const url = new URL(request.url);
  url.search = "";
  const key = new Request(url);
  const cache = globalThis.caches?.default;
  try {
    const cached = await cache?.match(key);
    if (cached) return cached;
  } catch (error) {
    console.error("GitHub edge cache read failed:", error);
  }

  const response = await githubContributions(request, env);
  if (response.ok && cache) {
    // Cache API honors s-maxage. The handler sends only the remaining warm
    // cache lifetime, so copying it into another edge cache cannot extend it.
    ctx.waitUntil(
      cache.put(key, response.clone()).catch((error) => {
        console.error("GitHub edge cache write failed:", error);
      }),
    );
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith(API_PREFIX);
    try {
      if (url.hostname === APEX_HOST) {
        const destination = new URL(CANONICAL_ORIGIN);
        destination.pathname = url.pathname;
        destination.search = url.search;
        return withHeaders(
          // Safari needs a document MIME type when Cloudflare resumes this
          // navigation after a challenge; an untyped response can download.
          new Response(null, {
            status: HTTP_PERMANENT_REDIRECT,
            headers: {
              Location: destination.href,
              "Content-Type": "text/html; charset=utf-8",
            },
          }),
          isApi,
        );
      }

      let response;
      if (url.pathname === GITHUB_PATH) {
        response = await githubResponse(request, env, ctx);
      } else if (url.pathname === SPOTIFY_PATH) {
        response = await nowPlaying(request, env);
      } else if (isApi) {
        response = Response.json(
          { error: "Not found" },
          { status: HTTP_NOT_FOUND, headers: { "Cache-Control": "no-store" } },
        );
      } else {
        // Exact HTML paths preserve Spotify's registered callback URL.
        if (url.pathname === "/") {
          url.pathname = "/index.html";
          response = await env.ASSETS.fetch(new Request(url, request));
        } else {
          response = await env.ASSETS.fetch(request);
        }
      }
      return withHeaders(response, isApi);
    } catch (error) {
      console.error("Worker request failed:", error);
      return withHeaders(
        Response.json(
          { error: "Internal server error" },
          {
            status: HTTP_INTERNAL_SERVER_ERROR,
            headers: { "Cache-Control": "no-store" },
          },
        ),
        isApi,
      );
    }
  },
};
