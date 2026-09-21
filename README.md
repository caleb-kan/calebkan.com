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

`wrangler.jsonc` defines the Worker and asset configuration. The build copies
only eight explicitly listed public files into `dist/`; source, tests, and
credentials are never published as static files. The browser code and design
remain plain HTML, CSS, and JavaScript.

GitHub Actions checks every pull request and push to `main`. Cloudflare Workers
Builds deploys `main` automatically after running the same checks. Runtime
secrets are stored in Cloudflare, separate from build configuration:

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

To roll back a deployment, use the Worker's **Deployments** page in Cloudflare
or `npx wrangler rollback`.
