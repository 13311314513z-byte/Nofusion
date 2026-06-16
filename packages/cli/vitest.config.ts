import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        isolate: true,
      },
    },
    testTimeout: 60_000,
  },
});
