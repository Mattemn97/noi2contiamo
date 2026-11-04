import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // I test DOM sono pesanti: con troppi worker in parallelo vanno in timeout sui PC lenti.
    maxWorkers: 2,
    projects: [
      { test: { name: "core", root: "packages/core", environment: "node" } },
      { test: { name: "data", root: "packages/data", environment: "node" } },
      { test: { name: "web", root: "apps/web", environment: "jsdom", setupFiles: ["./src/test/setup.ts"] } },
    ],
  },
});
