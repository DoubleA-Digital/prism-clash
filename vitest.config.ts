import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@prism/shared": new URL("./shared/src/index.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") } },
  test: { include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts", "client/test/**/*.test.ts"], environment: "node", testTimeout: 60000 },
});
