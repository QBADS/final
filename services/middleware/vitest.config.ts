import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Several test files spin up a real Express server + a real fake-HTTP
    // quantum-pipeline on ephemeral ports and log in via the real dashboard
    // auth flow. Running them concurrently caused unexplained hangs in this
    // sandbox (each passes instantly in isolation) - sequential execution
    // is slower but reliable, and this suite is small enough that it doesn't matter.
    fileParallelism: false,
  },
});
