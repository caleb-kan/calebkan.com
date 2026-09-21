# [calebkan.com](https://www.calebkan.com/)

## Local Development

Install Node.js 24 (see `.nvmrc`), then:

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Fill in the four secrets in `.dev.vars`. This file is ignored by Git and is
never included in the deployed assets.

```sh
npm run dev
```

Open <http://localhost:8787>. Wrangler runs the static site and both APIs in
Cloudflare's local runtime.

## Hosting and Deployment

One Cloudflare Worker, `calebkan-com`, serves the site and its GitHub/Spotify
APIs. Cloudflare also manages DNS and HTTPS. `calebkan.com` redirects to
`www.calebkan.com`, preserving paths and query strings.

The zone's **Canonical host redirect** Single Redirect runs before the
security challenge. Keep this rule enabled: completing a challenge on the
apex and then redirecting from the Worker can trigger a download in Safari.
The rule matches `http.host eq "calebkan.com"`, returns status `308`, targets
`concat("https://www.calebkan.com", http.request.uri.path)`, and preserves the
query string. Manage it under **Cloudflare → calebkan.com → Rules**; Wrangler
deployments do not manage zone rules. Under Attack Mode stays enabled, so
verification occurs on the canonical `www` host.

`wrangler.jsonc` defines the Worker and asset configuration. The build copies
only eight explicitly listed public files into `dist/`; source, tests, and
credentials are never published as static files. The browser code and design
remain plain HTML, CSS, and JavaScript.

GitHub Actions checks every pull request and push to `main`. Cloudflare Workers
Builds deploys `main` automatically after running the same checks. The build
command is `npm run check && npm run build`; the production deploy command is
`npm run deploy`. Other branches upload preview versions without changing
production.

Runtime secrets are stored in Cloudflare, separate from build configuration:

- `GITHUB_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

To deploy manually:

```sh
npx wrangler login
npm run check
npm run deploy
```

To update a secret without printing it:

```sh
npx wrangler secret put GITHUB_TOKEN
```

## Verification

Run formatting, regression tests, syntax checks, and deployment validation:

```sh
npm run check
npx wrangler deploy --dry-run
```

For visual changes, also check first load and both themes in a browser, the
1100px / 768px / 600px breakpoints, reduced motion, and Spotify appearing and
hiding. The calendar's reserved CSS aspect ratio must match its SVG viewBox.

The GitHub response is cached for up to 60 seconds in the Worker and the local
Cloudflare data center. Spotify playback responses are never cached. Security
headers and API CORS are applied centrally in `worker/index.js`.
Worker logs redact query strings so Spotify authorization codes are not
recorded in request URLs.
Keep Cloudflare's **Browser Cache TTL** set to **Respect Existing Headers**
(`0` in the API), so it does not override the calendar's freshness policy.

Cloudflare Under Attack Mode remains enabled for the custom domains. Browsers
may see a security verification page before the site loads, and command-line
probes can receive a challenge. The Worker test URL is
<https://calebkan-com.caleb-kan.workers.dev>.

For redirect changes, test a fresh private Safari window starting at
`https://calebkan.com/`: it must reach the `www` security check and then render
the site without a download prompt. A direct request to the apex must return
`308` with the expected `Location` and no `cf-mitigated: challenge` header.

To roll back a deployment, use the Worker's **Deployments** page in Cloudflare
or `npx wrangler rollback`.
