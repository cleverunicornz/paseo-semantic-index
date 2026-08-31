import type { ServiceStatus, ServicePhase } from "./contracts"
import type { ServiceConfig } from "./config"
import { SemanticIndexHttpServer } from "./http-server"
import { McpSessionManager } from "./mcp"
import { IndexRegistry, type RegistryOptions } from "./registry"
import { consoleLogger, type Logger } from "./types"

export interface SemanticIndexServiceOptions {
  logger?: Logger
  registry?: Omit<RegistryOptions, "logger">
}

export class SemanticIndexService {
  readonly registry: IndexRegistry
  readonly mcp: McpSessionManager
  readonly http: SemanticIndexHttpServer

  private phase: ServicePhase = "starting"
  private message = "Semantic index service is starting."
  private startedAt: string | undefined
  private updatedAt = new Date().toISOString()
  private startTask: Promise<void> | undefined
  private readonly logger: Logger

  constructor(
    readonly config: ServiceConfig,
    options: SemanticIndexServiceOptions = {},
  ) {
    this.logger = options.logger ?? consoleLogger
    this.registry = new IndexRegistry(config, { logger: this.logger, ...options.registry })
    this.mcp = new McpSessionManager(this.registry, this.logger)
    this.http = new SemanticIndexHttpServer({
      config,
      registry: this.registry,
      mcp: this.mcp,
      logger: this.logger,
      serviceStatus: () => this.status(),
    })
    this.registry.subscribe(() => {
      this.updatedAt = new Date().toISOString()
    })
  }

  status(): ServiceStatus {
    return {
      phase: this.phase,
      version: "0.1.0",
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      message: this.message,
      registrations: this.registry.list(),
      activeManagers: new Set(this.registry.list().map((registration) => registration.path)).size,
      mcpSessions: this.mcp.size,
    }
  }

  start(): Promise<void> {
    if (this.startTask) return this.startTask
    this.startTask = this.runStart()
    return this.startTask
  }

  private async runStart(): Promise<void> {
    this.phase = "starting"
    this.message = "Starting HTTP interfaces and restoring index registrations."
    this.updatedAt = new Date().toISOString()
    try {
      const address = await this.http.start()
      this.logger.info("Semantic index HTTP server is listening", address)
      await this.registry.initialize()
      this.phase = "ready"
      this.message = "Semantic index service is ready."
      this.startedAt = new Date().toISOString()
      this.updatedAt = this.startedAt
    } catch (error) {
      this.phase = "degraded"
      this.message = error instanceof Error ? error.message : String(error)
      this.updatedAt = new Date().toISOString()
      this.logger.error("Semantic index service failed to start", { error: this.message })
      throw error
    }
  }

  async close(): Promise<void> {
    this.phase = "stopping"
    this.message = "Semantic index service is stopping."
    this.updatedAt = new Date().toISOString()
    await this.mcp.close()
    await this.http.close()
    await this.registry.dispose()
    this.phase = "stopped"
    this.message = "Semantic index service is stopped."
    this.updatedAt = new Date().toISOString()
  }
}
