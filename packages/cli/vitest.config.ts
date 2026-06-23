import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // CLI integration and publish-package tests exercise real package/dist files.
    // Keep test files serial to avoid npm pack/prepack races against other suites.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        isolate: true,
      },
    },
    testTimeout: 60_000,
  },
});
