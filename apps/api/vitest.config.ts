import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false, // tests share one database
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
