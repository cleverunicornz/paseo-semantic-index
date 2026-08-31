import { readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { IndexingConfig } from "@cleverunicornz/semantic-index-engine/config"
import { z } from "zod"

const absolutePath = z.string().min(1).refine(isAbsolute, "Expected an absolute path")

export const ServiceFileConfig = z
  .object({
    stateDirectory: absolutePath,
    cacheDirectory: absolutePath,
    allowedRoots: z.array(absolutePath).min(1),
    listen: z
      .object({
        host: z.literal("127.0.0.1").default("127.0.0.1"),
        port: z.number().int().min(0).max(65_535),
      })
      .strict(),
    indexing: IndexingConfig,
  })
  .strict()
export type ServiceFileConfig = z.infer<typeof ServiceFileConfig>

export const ServiceConfig = ServiceFileConfig.extend({
  controlToken: z.string().min(16),
  mcpToken: z.string().min(16),
})
export type ServiceConfig = z.infer<typeof ServiceConfig>

async function readSecret(
  environment: NodeJS.ProcessEnv,
  valueName: string,
  fileName: string,
): Promise<string | undefined> {
  const direct = environment[valueName]?.trim()
  if (direct) return direct
  const secretFile = environment[fileName]?.trim()
  if (!secretFile) return undefined
  const value = (await readFile(resolve(secretFile), "utf8")).trim()
  if (!value) throw new Error(`${fileName} points to an empty secret file`)
  return value
}

export async function loadServiceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ServiceConfig> {
  const configuredPath = environment.SEMANTIC_INDEX_CONFIG_FILE
  if (!configuredPath) throw new Error("SEMANTIC_INDEX_CONFIG_FILE is required")
  const configPath = resolve(configuredPath)
  const file = ServiceFileConfig.parse(JSON.parse(await readFile(configPath, "utf8")))
  const controlToken = await readSecret(
    environment,
    "SEMANTIC_INDEX_CONTROL_TOKEN",
    "SEMANTIC_INDEX_CONTROL_TOKEN_FILE",
  )
  const mcpToken = await readSecret(environment, "SEMANTIC_INDEX_MCP_TOKEN", "SEMANTIC_INDEX_MCP_TOKEN_FILE")
  const embedderApiKey = await readSecret(
    environment,
    "SEMANTIC_INDEX_EMBEDDER_API_KEY",
    "SEMANTIC_INDEX_EMBEDDER_API_KEY_FILE",
  )
  const qdrantApiKey = await readSecret(
    environment,
    "SEMANTIC_INDEX_QDRANT_API_KEY",
    "SEMANTIC_INDEX_QDRANT_API_KEY_FILE",
  )
  if (!controlToken) {
    throw new Error("SEMANTIC_INDEX_CONTROL_TOKEN or SEMANTIC_INDEX_CONTROL_TOKEN_FILE is required")
  }
  if (!mcpToken) throw new Error("SEMANTIC_INDEX_MCP_TOKEN or SEMANTIC_INDEX_MCP_TOKEN_FILE is required")

  return ServiceConfig.parse({
    ...file,
    controlToken,
    mcpToken,
    indexing: {
      ...file.indexing,
      "openai-compatible": {
        ...file.indexing["openai-compatible"],
        apiKey: embedderApiKey ?? file.indexing["openai-compatible"].apiKey,
      },
      qdrant: {
        ...file.indexing.qdrant,
        apiKey: qdrantApiKey ?? file.indexing.qdrant.apiKey,
      },
    },
  })
}
