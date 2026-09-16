# [calebkan.com](https://www.calebkan.com/)

## Local Development

Install the Vercel CLI:

```sh
brew install vercel-cli
```

Link the project and pull environment variables:

```sh
vercel login
vercel link
vercel env pull
```

Run the local dev server:

```sh
vercel dev
```

Prettier formatting:

```sh
npm install -g prettier
prettier --write .
prettier --check .
```

## Verification

Run the regression checks with Node.js 22 or newer (no dependencies required):

```sh
node --test tests/*.test.mjs
for f in js/*.js api/*.js; do node -c "$f"; done
prettier --check .
```

For visual changes, also check first load and both themes in a browser, the
1100px / 768px / 600px breakpoints, reduced motion, and Spotify appearing and
hiding. The calendar's reserved CSS aspect ratio must match its SVG viewBox.
