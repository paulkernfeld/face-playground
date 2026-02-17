import { defineConfig } from "vite";
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
  ],
});
