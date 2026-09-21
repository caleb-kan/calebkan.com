import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PUBLIC_FILES = [
  "index.html",
  "callback.html",
  "jemdoc.css",
  "favicon/favicon.png",
  "js/github-calendar.js",
  "js/spotify.js",
  "js/theme-boot.js",
  "js/theme-toggle.js",
];

// An explicit file allowlist keeps credentials and server code out of hosting.
export async function buildAssets(output = resolve(ROOT, "dist")) {
  await rm(output, { recursive: true, force: true });
  for (const file of PUBLIC_FILES) {
    const destination = resolve(output, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(ROOT, file), destination);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildAssets();
  console.log(`Prepared ${PUBLIC_FILES.length} public assets.`);
}
