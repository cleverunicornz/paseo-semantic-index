import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    environment: "node",
    include: [
      "test/kilocode/indexing/cache-manager.test.ts",
      "test/kilocode/indexing/config-manager.test.ts",
      "test/kilocode/indexing/search-service.test.ts",
      "test/kilocode/indexing/state-manager.test.ts",
      "test/kilocode/indexing/worktree-overlay.test.ts",
      "test/kilocode/indexing/shared/get-relative-path.test.ts",
      "test/kilocode/indexing/shared/load-ignore.test.ts",
      "test/kilocode/indexing/shared/validation-helpers.test.ts",
      "test/kilocode/indexing/processors/file-watcher.test.ts",
      "test/kilocode/tree-sitter/wasm-resolution.test.ts"
    ],
    testTimeout: 30_000,
  },
})
