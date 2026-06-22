import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@actalk/inkos-core": resolve(__dirname, "../core/src/index.ts"),
      "@actalk/inkos-core/browser": resolve(__dirname, "../core/src/browser-index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        // Isolate each test file in its own fork to prevent module mock leakage
        // from server.test.ts's vi.mock("@actalk/inkos-core") affecting other files.
        singleFork: false,
        isolate: true,
      },
    },
    // Increase timeout for server.test.ts which makes real HTTP calls
    testTimeout: 30_000,
    // Automatically reset all mocks before each test to ensure isolation
    // within split test files that share mocked modules
    mockReset: true,
  },
});
