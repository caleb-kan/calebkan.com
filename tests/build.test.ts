import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const publicDirectory = "dist/client";

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesIn(path) : [path];
      }),
    )
  ).flat();
}

test("only browser assets are published, with no source files or credentials", async () => {
  const files = await filesIn(publicDirectory);
  for (const file of files) {
    assert.match(
      file,
      /^dist\/client\/(?:index\.html|callback\.html|theme-boot\.js|favicon\/favicon\.png|assets\/[\w-]+\.(?:js|css|png)|\.assetsignore)$/,
    );
  }
  assert.ok(files.includes("dist/client/favicon/favicon.png"));
  const config = JSON.parse(
    await readFile("dist/calebkan_com/wrangler.json", "utf8"),
  );
  assert.equal(config.assets.directory, "../client");
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.html_handling, "none");
  assert.equal(config.assets.not_found_handling, "none");
  assert.equal(config.observability.redact_query_string, true);
});

test("prerendered content, metadata, strict CSP, and synchronous boot survive the build", async () => {
  const html = await readFile(`${publicDirectory}/index.html`, "utf8");
  assert.match(html, /<h1 id="page-title" tabindex="-1">Caleb Kan<\/h1>/);
  assert.match(html, /href="mailto:calebkan1106@gmail.com"/);
  assert.match(html, /aria-label="Dark mode" aria-pressed="true"/);
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/www.calebkan.com\/"/,
  );
  assert.match(html, /script-src 'self';/);
  assert.doesNotMatch(
    html,
    /unsafe-inline|unsafe-eval|nonce-|localhost|@vite|\/src\//,
  );
  assert.match(html, /<script src="\/theme-boot.js"><\/script>/);
  assert.ok(html.indexOf("/theme-boot.js") < html.indexOf('rel="stylesheet"'));
  assert.ok(
    html.lastIndexOf('rel="stylesheet"') < html.indexOf('type="module"'),
  );
  assert.match(html, /<section[^>]+id="spotify-card"[^>]+hidden=""/);
});

test("callback uses same-origin compiled assets and no executable inline code", async () => {
  const html = await readFile(`${publicDirectory}/callback.html`, "utf8");
  assert.match(html, /default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(html, /<style|unsafe-inline/);
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.equal(match[1].trim(), "");
  }
  assert.match(html, /src="\/assets\/callback-[\w-]+\.js"/);
});
