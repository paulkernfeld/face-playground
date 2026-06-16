import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "fs";
import path from "path";

export default defineConfig({
  base: "/face-playground/",
  server: {
    // Dev-only endpoint: PUT /api/fixture/<name> saves to fixtures/
    proxy: {},
  },
  plugins: [
    {
      name: "fixture-save",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const match = req.url?.match(/^\/api\/fixture\/(.+)$/);
          if (!match || req.method !== "PUT") return next();

          const filename = match[1];
          // Sanitize: only allow alphanumeric, dash, dot, underscore
          if (!/^[\w.-]+$/.test(filename)) {
            res.writeHead(400);
            res.end("invalid filename");
            return;
          }

          const dir = path.resolve(__dirname, "fixtures");
          fs.mkdirSync(dir, { recursive: true });
          const dest = path.join(dir, filename);

          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            fs.writeFileSync(dest, Buffer.concat(chunks));
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("ok");
          });
        });
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Default is 2 MB; raise so JS bundles don't get skipped if they grow.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // MediaPipe WASM (CORS-enabled, jsdelivr)
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "mediapipe-wasm",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // MediaPipe model .task files (CORS-enabled, storage.googleapis.com)
            urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "mediapipe-models",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // MorphCast SDK (mphtools + ai-sdk + module chunks fetched lazily)
            urlPattern: /^https:\/\/(ai-)?sdk\.morphcast\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "morphcast-sdk",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "face playground",
        short_name: "face-playground",
        description: "Webcam mini-games using MediaPipe face + body tracking.",
        theme_color: "#f7efe2",
        background_color: "#f7efe2",
        display: "standalone",
        start_url: "/face-playground/",
        scope: "/face-playground/",
        icons: [],
      },
    }),
  ],
});
