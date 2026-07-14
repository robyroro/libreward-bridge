import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globals: false, environment: "node", restoreMocks: true, testTimeout: 30_000 },
});
