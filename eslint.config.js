import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "e2e/**", "scripts/**", "*.config.*", "client/vite.config.ts"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
  {
    // The server core also runs in the browser's practice worker: no Node APIs outside the Node entry.
    files: ["server/src/**/*.ts"],
    ignores: ["server/src/main.ts", "server/src/log.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*", "ws", "http", "https", "crypto", "fs", "path", "os", "net", "url"], message: "Server core must stay platform-neutral (see server/src/platform.ts)." }] }],
      "no-restricted-globals": ["error", { name: "process", message: "Pass settings in through HubOptions instead." }, { name: "Buffer", message: "Use Uint8Array." }],
    },
  },
);
