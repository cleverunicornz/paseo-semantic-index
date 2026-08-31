import { getDefaultModelId } from "./model-registry"
import { resolveEmbeddingProfile } from "./embedding-profile"

import { OpenAICompatibleEmbedder } from "./embedders/openai-compatible"
import { QdrantVectorStore } from "./vector-store/qdrant-client"
import { CodeParser, DirectoryScanner, FileWatcher } from "./processors"
import type { ICodeParser, IEmbedder, IFileWatcher, IVectorStore } from "./interfaces"
import type { CodeIndexConfigManager } from "./config-manager"
import type { CacheManager } from "./cache-manager"
import type { IndexingTelemetryMeta, IndexingTelemetryReporter } from "./interfaces/telemetry"
import { DEFAULT_VECTOR_STORE } from "./constants"
import { Log } from "../util/log"
import type { IgnoreMatcher } from "./shared/load-ignore"

const log = Log.create({ service: "indexing-factory" })

/**
 * Factory class responsible for creating and configuring code indexing service dependencies.
 *
 * RATIONALE: Removed vscode.ExtensionContext, Package, RooIgnoreController, and
 * LanceDBManager inputs. All batch sizing, retry counts, vector-store selection,
 * and model selection now come from the injected CodeIndexConfigManager.
 */
export class CodeIndexServiceFactory {
  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly workspacePath: string,
    private readonly cacheManager: CacheManager,
    private readonly cacheDirectory: string,
    private readonly onTelemetry?: IndexingTelemetryReporter,
  ) {}

  private getTelemetryMeta(): IndexingTelemetryMeta {
    const cfg = this.configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? DEFAULT_VECTOR_STORE,
      modelId: cfg.modelId,
    }
  }

  public createEmbedder(): IEmbedder {
    const config = this.configManager.getConfig()
    const provider = config.embedderProvider

    if (provider === "openai-compatible") {
      if (!config.openAiCompatibleOptions?.baseUrl) throw new Error("OpenAI-compatible base URL is required.")
      return new OpenAICompatibleEmbedder(
        config.openAiCompatibleOptions.baseUrl,
        config.openAiCompatibleOptions.apiKey,
        config.modelId,
      )
    }

    throw new Error(`Unsupported embedder provider: ${provider}`)
  }

  public async validateEmbedder(embedder: IEmbedder): Promise<{ valid: boolean; error?: string }> {
    try {
      log.info("validating embedder", { provider: embedder.embedderInfo.name })
      const result = await embedder.validateConfiguration()
      if (result.valid) {
        log.info("embedder validation succeeded", { provider: embedder.embedderInfo.name })
      }
      if (!result.valid) {
        log.warn("embedder validation failed", {
          provider: embedder.embedderInfo.name,
          error: result.error,
        })
      }
      return result
    } catch (err) {
      log.error("embedder validation failed", { err })
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Configuration validation error",
      }
    }
  }

  public createVectorStore(workspacePath = this.workspacePath): IVectorStore {
    const config = this.configManager.getConfig()
    const profile = resolveEmbeddingProfile(config.embedderProvider, config.modelId, config.modelDimension)

    if (!profile || profile.dimension <= 0) {
      throw new Error(
        `Cannot determine vector dimension for model "${config.modelId ?? getDefaultModelId(config.embedderProvider)}" with provider "${config.embedderProvider}". ` +
          (config.embedderProvider === "openai-compatible"
            ? "Please set the model dimension explicitly."
            : "Check your model configuration."),
      )
    }

    if (config.vectorStoreProvider !== "qdrant") throw new Error("Only the Qdrant vector store is supported.")

    if (!config.qdrantUrl) throw new Error("Qdrant URL is required.")
    log.info("creating vector store", {
      provider: config.embedderProvider,
      vectorStore: "qdrant",
      model: profile.modelId,
      vectorSize: profile.dimension,
    })
    return new QdrantVectorStore(workspacePath, config.qdrantUrl, profile.dimension, config.qdrantApiKey, profile)
  }

  public createDirectoryScanner(
    embedder: IEmbedder,
    vectorStore: IVectorStore,
    parser: ICodeParser,
    ignoreInstance: IgnoreMatcher,
  ): DirectoryScanner {
    const config = this.configManager.getConfig()
    const meta = this.getTelemetryMeta()
    return new DirectoryScanner(
      embedder,
      vectorStore,
      parser,
      this.cacheManager,
      ignoreInstance,
      config.embeddingBatchSize,
      config.scannerMaxBatchRetries,
      this.onTelemetry,
      meta,
      config.fileExtensions,
    )
  }

  public createFileWatcher(
    embedder: IEmbedder,
    vectorStore: IVectorStore,
    cacheManager: CacheManager,
    ignoreInstance: IgnoreMatcher,
    parser: ICodeParser,
  ): IFileWatcher {
    const config = this.configManager.getConfig()
    const meta = this.getTelemetryMeta()
    return new FileWatcher(
      this.workspacePath,
      cacheManager,
      embedder,
      vectorStore,
      ignoreInstance,
      config.embeddingBatchSize,
      config.scannerMaxBatchRetries,
      this.onTelemetry,
      meta,
      config.fileExtensions,
      parser,
    )
  }

  public createServices(
    cacheManager: CacheManager,
    ignoreInstance: IgnoreMatcher,
  ): {
    embedder: IEmbedder
    vectorStore: IVectorStore
    parser: ICodeParser
    scanner: DirectoryScanner
    fileWatcher: IFileWatcher
  } {
    if (!this.configManager.isFeatureConfigured) {
      throw new Error("Code indexing is not configured. Save your settings to start indexing.")
    }

    const config = this.configManager.getConfig()
    log.info("creating indexing services", {
      workspacePath: this.workspacePath,
      provider: config.embedderProvider,
      vectorStore: config.vectorStoreProvider,
      model: config.modelId ?? getDefaultModelId(config.embedderProvider),
      configured: config.isConfigured,
    })

    const embedder = this.createEmbedder()
    const vectorStore = this.createVectorStore()
    const parser = new CodeParser(config.fileExtensions)
    const scanner = this.createDirectoryScanner(embedder, vectorStore, parser, ignoreInstance)
    const fileWatcher = this.createFileWatcher(embedder, vectorStore, cacheManager, ignoreInstance, parser)

    log.info("indexing services created", {
      workspacePath: this.workspacePath,
      provider: embedder.embedderInfo.name,
    })

    return { embedder, vectorStore, parser, scanner, fileWatcher }
  }
}
