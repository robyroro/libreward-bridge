import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    restoreMocks: true,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      exclude: ["tests/**", "dist/**", "examples/**"],
    },
  },
});
