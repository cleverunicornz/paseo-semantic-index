import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "vitest"
import { loadServiceConfig } from "../src/config"

let root: string | undefined

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe("loadServiceConfig", () => {
  test("loads credentials from mode-independent secret files", async () => {
    root = await mkdtemp(join(tmpdir(), "semantic-index-config-"))
    const stateDirectory = join(root, "state")
    const cacheDirectory = join(root, "cache")
    const allowedRoot = join(root, "workspaces")
    await Promise.all([stateDirectory, cacheDirectory, allowedRoot].map((directory) => mkdir(directory)))
    const configFile = join(root, "config.json")
    await writeFile(
      configFile,
      JSON.stringify({
        stateDirectory,
        cacheDirectory,
        allowedRoots: [allowedRoot],
        listen: { host: "127.0.0.1", port: 7790 },
        indexing: {
          model: "test-model",
          dimension: 32,
          "openai-compatible": { baseUrl: "http://127.0.0.1:8001/v1" },
          qdrant: { url: "http://127.0.0.1:6333" },
        },
      }),
    )
    const secrets = {
      SEMANTIC_INDEX_CONTROL_TOKEN_FILE: join(root, "control-token"),
      SEMANTIC_INDEX_MCP_TOKEN_FILE: join(root, "mcp-token"),
      SEMANTIC_INDEX_QDRANT_API_KEY_FILE: join(root, "qdrant-token"),
      SEMANTIC_INDEX_EMBEDDER_API_KEY_FILE: join(root, "embedder-token"),
    }
    await Promise.all([
      writeFile(secrets.SEMANTIC_INDEX_CONTROL_TOKEN_FILE, "control-token-from-file\n"),
      writeFile(secrets.SEMANTIC_INDEX_MCP_TOKEN_FILE, "mcp-token-from-file-value\n"),
      writeFile(secrets.SEMANTIC_INDEX_QDRANT_API_KEY_FILE, "qdrant-token-from-file\n"),
      writeFile(secrets.SEMANTIC_INDEX_EMBEDDER_API_KEY_FILE, "embedder-token-from-file\n"),
    ])

    const config = await loadServiceConfig({ SEMANTIC_INDEX_CONFIG_FILE: configFile, ...secrets })
    expect(config.controlToken).toBe("control-token-from-file")
    expect(config.mcpToken).toBe("mcp-token-from-file-value")
    expect(config.indexing.qdrant.apiKey).toBe("qdrant-token-from-file")
    expect(config.indexing["openai-compatible"].apiKey).toBe("embedder-token-from-file")
  })
})
