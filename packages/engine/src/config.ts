import { z } from "zod"
import type { IndexingConfigInput } from "./indexing/config-manager"
import { DEFAULT_VECTOR_STORE } from "./indexing/constants"
import { FILE_EXTENSION_PATTERN, normalizeFileExtensions } from "./file-extensions"

export { DEFAULT_VECTOR_STORE } from "./indexing/constants"
export { isFileExtension, normalizeFileExtensions, parseFileExtensions } from "./file-extensions"

export const IndexingConfig = z
  .object({
    enabled: z.boolean().default(true),
    provider: z.literal("openai-compatible").default("openai-compatible"),
    model: z.string().min(1),
    dimension: z.number().int().positive(),
    vectorStore: z.literal("qdrant").default("qdrant"),
    "openai-compatible": z
      .object({
        baseUrl: z.url(),
        apiKey: z.string().optional(),
      })
      .strict(),
    qdrant: z
      .object({
        url: z.url(),
        apiKey: z.string().optional(),
      })
      .strict(),
    searchMinScore: z.number().min(0).max(1).optional(),
    searchMaxResults: z.number().int().positive().max(200).optional(),
    embeddingBatchSize: z.number().int().positive().max(200).optional(),
    scannerMaxBatchRetries: z.number().int().positive().max(10).optional(),
    fileExtensions: z.array(z.string().trim().regex(FILE_EXTENSION_PATTERN)).min(1).optional(),
  })
  .strict()

export type IndexingConfig = z.infer<typeof IndexingConfig>

export const IndexingSchema = IndexingConfig

export function toIndexingConfigInput(config: IndexingConfig): IndexingConfigInput {
  return {
    enabled: config.enabled,
    embedderProvider: "openai-compatible",
    vectorStoreProvider: DEFAULT_VECTOR_STORE,
    modelId: config.model,
    modelDimension: config.dimension,
    qdrantUrl: config.qdrant.url,
    qdrantApiKey: config.qdrant.apiKey,
    searchMinScore: config.searchMinScore,
    searchMaxResults: config.searchMaxResults,
    embeddingBatchSize: config.embeddingBatchSize,
    scannerMaxBatchRetries: config.scannerMaxBatchRetries,
    fileExtensions: normalizeFileExtensions(config.fileExtensions),
    openAiCompatibleBaseUrl: config["openai-compatible"].baseUrl,
    openAiCompatibleApiKey: config["openai-compatible"].apiKey,
  }
}
