# [calebkan.com](https://www.calebkan.com/)

A personal portfolio built with TypeScript, React, Vite, and Tailwind CSS,
served by Cloudflare Workers. The GitHub contribution calendar and Spotify
Now Playing card use APIs in the same Worker.

## Local Development

Install Node.js 24 (see `.nvmrc`), then:

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Fill in the four secrets in `.dev.vars`. This file is ignored by Git and is
never included in the public assets.

```sh
npm run dev
```

Open <http://127.0.0.1:8787>. Vite provides development updates, and the
Cloudflare Vite plugin runs the Worker and both APIs in the local Cloudflare
runtime. To preview the production build:

```sh
npm run build
npm run preview
```

## Architecture

- `src/app.tsx` and `src/components/` define the React interface. Vite renders
  the same component tree into HTML at build time, then `src/main.tsx` hydrates
  it in the browser. The portfolio remains readable without JavaScript.
- `src/lib/` holds typed calendar, playback, polling, and theme logic.
  `src/theme-boot.ts` compiles to a separate synchronous script that applies
  the saved theme before styles load.
- `src/styles.css` preserves the design and uses Tailwind utilities through
  `@apply`. Tailwind Preflight is omitted to retain existing browser defaults.
- `api/*.ts` implement the upstream integrations. `worker/index.ts` routes
  requests and applies security headers and API CORS.
- `callback.html` uses `src/callback.ts` and `src/callback.css` for Spotify
  authorization. Its script and styles compile to same-origin assets.

The build publishes browser assets from `dist/client` only. The Worker bundle
and generated deployment configuration live separately in `dist/calebkan_com`.
Source files, tests, and credentials are not public assets. `wrangler types`
generates the Worker binding and runtime types from the configuration and empty
secret template.

## Verification

```sh
npm run check
npx wrangler deploy --dry-run
```

`check` verifies formatting, regenerates Worker types, checks TypeScript, builds
the application, and runs unit and build regression tests. A build must exist
before the Wrangler dry-run so it can find Vite's generated deployment config.

Browser tests run separately in Chromium and WebKit against the production
preview on port 8787 and a development CSP/HMR smoke test on port 8788:

```sh
npx playwright install chromium webkit
npm run test:browser
```

Run `npm run check` first and stop any servers on ports 8787 and 8788 before
browser testing. For visual changes, also inspect first load, both themes,
the 1100px / 768px / 600px breakpoints, reduced motion, and Spotify appearing
and hiding. The calendar's reserved CSS aspect ratio must match its SVG viewBox.

## Hosting and Deployment

The Cloudflare Worker is named `calebkan-com`. Cloudflare also manages DNS and
HTTPS. `calebkan.com` redirects to `www.calebkan.com`, preserving paths and
query strings. `wrangler.jsonc` defines both custom domains and the runtime;
Vite generates the final asset and bundle paths during the build.

GitHub Actions checks pull requests and pushes to `main`, including a deployment
dry-run. Cloudflare Workers Builds runs `npm run check`, which includes the
production build, then deploys that verified output from `main` with
`npx wrangler deploy`. Other branches use `npx wrangler versions upload`
without changing production. Local verification alone does not deploy changes.

To deploy manually:

```sh
npx wrangler login
npm run check
npm run deploy
```

Runtime secrets are stored in Cloudflare, separate from build configuration:

- `GITHUB_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

Update a secret without printing it using `npx wrangler secret put NAME`.
To roll back, use the Worker's **Deployments** page in Cloudflare or
`npx wrangler rollback`.

## Cloudflare Settings to Preserve

The zone's **Canonical host redirect** Single Redirect must run before the
security challenge. Keep it enabled: completing a challenge on the apex and
then redirecting from the Worker can trigger a download in Safari. The rule
matches `http.host eq "calebkan.com"`, returns status `308`, targets
`concat("https://www.calebkan.com", http.request.uri.path)`, and preserves the
query string. Manage it under **Cloudflare → calebkan.com → Rules**;
Wrangler deployments do not manage zone rules.

Keep **Browser Cache TTL** set to **Respect Existing Headers** (`0` in the
API). GitHub responses are cached for up to 60 seconds in warm Worker instances
and the Cloudflare data center, without extending their remaining lifetime.
Spotify responses are never cached. Worker logs redact query strings to avoid
recording Spotify authorization codes.

**Under Attack Mode remains enabled** on the custom domains, with verification
on the canonical `www` host. Browsers may see a security verification page, and
command-line probes can receive a challenge. The Worker test URL is
<https://calebkan-com.caleb-kan.workers.dev>.

After redirect changes, use a fresh private Safari window starting at
`https://calebkan.com/`. It must reach the `www` security check and then render
the site without a download prompt. A direct apex request must return `308`
with the expected `Location` and no `cf-mitigated: challenge` header.
