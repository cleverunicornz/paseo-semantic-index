import { loadServiceConfig, SemanticIndexService } from "@cleverunicornz/semantic-index-service"
import type { ServiceStatus } from "@cleverunicornz/semantic-index-service/contracts"

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PluginRuntime {
  private service: SemanticIndexService | undefined
  private failure: string | undefined
  private readonly startedAt = new Date().toISOString()
  private readonly ready: Promise<SemanticIndexService>

  constructor() {
    this.ready = this.start()
    void this.ready.catch((error) => {
      this.failure = message(error)
      console.error(`[semantic-index] startup failed: ${this.failure}`)
    })
  }

  private async start(): Promise<SemanticIndexService> {
    const config = await loadServiceConfig()
    const service = new SemanticIndexService(config)
    this.service = service
    await service.start()
    return service
  }

  status(): ServiceStatus {
    if (this.service) return this.service.status()
    const now = new Date().toISOString()
    return {
      phase: this.failure ? "degraded" : "starting",
      version: "0.1.0",
      startedAt: this.startedAt,
      updatedAt: now,
      message: this.failure ?? "Semantic index plugin is loading configuration.",
      registrations: [],
      activeManagers: 0,
      mcpSessions: 0,
    }
  }

  private async active(): Promise<SemanticIndexService> {
    return this.ready
  }

  async workspaceStatus(workspacePath: string) {
    const service = await this.active()
    try {
      const canonical = await service.registry.resolveRegisteredPath(workspacePath)
      return service.registry.statusForPath(canonical)
    } catch {
      return null
    }
  }

  async register(input: { id: string; path: string; baselinePath?: string }) {
    const service = await this.active()
    return service.registry.register(input.id, { path: input.path, baselinePath: input.baselinePath })
  }

  async release(input: { id: string; purge?: boolean }) {
    const service = await this.active()
    await service.registry.release(input.id, input.purge)
    return { released: input.id }
  }

  async reindex(id: string) {
    const service = await this.active()
    return service.registry.startOperation(id, "reindex")
  }

  async close(): Promise<void> {
    const service = await this.ready.catch(() => this.service)
    await service?.close()
  }
}

const runtime = new PluginRuntime()

export const getServiceStatus = () => runtime.status()
export const getWorkspaceStatus = ({ path }: { path: string }) => runtime.workspaceStatus(path)
export const registerWorkspace = (input: { id: string; path: string; baselinePath?: string }) => runtime.register(input)
export const releaseWorkspace = (input: { id: string; purge?: boolean }) => runtime.release(input)
export const reindexWorkspace = ({ id }: { id: string }) => runtime.reindex(id)
export const closeRuntime = () => runtime.close()
