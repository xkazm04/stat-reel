/**
 * Studio dev server: 127.0.0.1:5173, proxying the StatReel API (127.0.0.1:8787).
 * `server.fs.allow` includes the repo root so the tokens' @font-face URLs (repo `fonts/`) load;
 * no external font CDN is ever used.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const api = process.env.STATREEL_API ?? "http://127.0.0.1:8787";

/** Node only sends proxied headers with the first body chunk; flush them so EventSource opens at once. */
const sse: ProxyOptions = {
  target: api,
  changeOrigin: false,
  configure: (proxy) => {
    proxy.on("proxyRes", (proxyRes, _req, res) => {
      if (String(proxyRes.headers["content-type"] ?? "").startsWith("text/event-stream"))
        setImmediate(() => res.flushHeaders());
    });
  },
};

const proxy: Record<string, ProxyOptions> = {
  "/api": { target: api, changeOrigin: false },
  "/events": sse,
  "/files": { target: api, changeOrigin: false },
  "/mcp": { target: api, changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy,
  },
  preview: { host: "127.0.0.1", port: 4173, proxy },
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 1500 },
});
