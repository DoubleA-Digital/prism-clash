import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@prism/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true }, "/healthz": "http://localhost:8787" },
  },
  build: { target: "es2022", outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});
