import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { defineConfig, type HmrContext, type ViteDevServer } from "vite";

export default defineConfig(async ({ command }) => {
  let server: ViteDevServer | undefined;
  const developmentNonce = command === "serve" ? randomUUID() : undefined;
  async function buildThemeBoot() {
    const result = await build({
      entryPoints: ["src/theme-boot.ts"],
      outfile: "public/theme-boot.js",
      bundle: true,
      format: "iife",
      target: "es2015",
      minify: command === "build",
      metafile: true,
    });
    return new Set(
      Object.keys(result.metafile.inputs).map((file) => resolve(file)),
    );
  }
  let bootDependencies = await buildThemeBoot();

  return {
    html: { cspNonce: developmentNonce },
    plugins: [
      react(),
      tailwindcss(),
      cloudflare(),
      {
        name: "prerender-portfolio",
        configureServer(devServer: ViteDevServer) {
          server = devServer;
        },
        async handleHotUpdate(context: HmrContext) {
          if (!bootDependencies.has(context.file)) return;
          bootDependencies = await buildThemeBoot();
          context.server.ws.send({ type: "full-reload" });
          return [];
        },
        transformIndexHtml: {
          order: "pre",
          async handler(html: string) {
            // Vite's refresh preamble and injected development styles receive
            // this nonce. Production retains the original self-only policy.
            if (developmentNonce) {
              html = html.replace(
                /(script-src|style-src) 'self'/g,
                `$1 'self' 'nonce-${developmentNonce}'`,
              );
              // The callback otherwise inherits connect-src from default-src
              // 'none'. Use the actual local server origins, including its
              // selected port, instead of permitting arbitrary WebSockets.
              const websocketSources = (server?.resolvedUrls?.local ?? [])
                .map((address) => {
                  const url = new URL(address);
                  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
                  return url.origin;
                })
                .join(" ");
              if (websocketSources) {
                html = html.replace(
                  /(\bcontent=")([^"]*\bdefault-src\b[^"]*)(")/g,
                  (_match, prefix: string, policy: string, suffix: string) => {
                    const developmentPolicy = /\bconnect-src\b/.test(policy)
                      ? policy.replace(
                          /\bconnect-src[^;]*/,
                          (directive) => `${directive} ${websocketSources}`,
                        )
                      : `${policy}; connect-src 'self' ${websocketSources}`;
                    return `${prefix}${developmentPolicy}${suffix}`;
                  },
                );
              }
            }
            if (!html.includes("<!--app-html-->")) return html;
            const { App } = server
              ? await server.ssrLoadModule("/src/app.tsx")
              : await tsImport("./src/app.tsx", import.meta.url);
            // Static HTML and the hydrated page share one React component tree.
            // Keep the portfolio readable when scripting is disabled or delayed.
            return html.replace("<!--app-html-->", () =>
              renderToString(createElement(App)),
            );
          },
        },
      },
      {
        name: "styles-before-hydration",
        apply: "build",
        transformIndexHtml: {
          order: "post",
          handler(html: string) {
            // A deferred module must follow the stylesheets it measures.
            // Vite normally inserts module scripts before generated CSS.
            const modules: string[] = [];
            const document = html.replace(
              /\s*<script\b(?=[^>]*\btype="module")[^>]*>[\s\S]*?<\/script>/g,
              (script) => {
                modules.push(script.trim());
                return "";
              },
            );
            return document.replace(
              "</head>",
              `${modules.join("\n")}\n  </head>`,
            );
          },
        },
      },
    ],
    // Only the browser environment has HTML entry points. The Cloudflare
    // plugin owns the Worker's separate entry and generated deploy config.
    environments: {
      client: {
        build: {
          sourcemap: false,
          rollupOptions: {
            input: {
              main: resolve(import.meta.dirname, "index.html"),
              callback: resolve(import.meta.dirname, "callback.html"),
            },
          },
        },
      },
    },
  };
});
