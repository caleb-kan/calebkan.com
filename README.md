# [calebkan.com](https://calebkan.com/)

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

Prettier Formatting:

```sh
npm install -g prettier
prettier --write .
prettier --check .
```
