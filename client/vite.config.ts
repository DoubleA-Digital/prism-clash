import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Dev ports: PORT is the game server's (the /ws proxy target), CLIENT_PORT this dev server's.
const serverPort = Number(process.env.PORT ?? 8787);
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);

export default defineConfig({
  resolve: { alias: { "@prism/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) } },
  server: {
    port: clientPort,
    proxy: { "/ws": { target: `ws://localhost:${serverPort}`, ws: true }, "/healthz": `http://localhost:${serverPort}` },
  },
  build: { target: "es2022", outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});
