import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { IndexingTelemetryEvent, VectorStoreSearchResult } from "@cleverunicornz/semantic-index-engine"
import type { ServiceConfig } from "../src/config"
import type { EngineProgress, ManagedIndex, ManagedIndexFactory } from "../src/types"

class TestEmitter<T> {
  private listeners = new Set<(value: T) => void>()

  on(listener: (value: T) => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  fire(value: T): void {
    for (const listener of this.listeners) listener(value)
  }
}

export class FakeManager implements ManagedIndex {
  readonly onProgressUpdate = new TestEmitter<EngineProgress>()
  readonly onTelemetry = new TestEmitter<IndexingTelemetryEvent>()
  status: EngineProgress = {
    systemStatus: "Standby",
    message: "Waiting",
    processedItems: 0,
    totalItems: 0,
    percent: 0,
  }
  disposed = false
  clearCount = 0
  startCount = 0
  results: VectorStoreSearchResult[] = [
    {
      id: "result-1",
      score: 0.91,
      payload: {
        filePath: "src/auth.ts",
        startLine: 4,
        endLine: 8,
        codeChunk: "export function authenticate() {}",
      },
    },
  ]

  constructor(
    readonly workspacePath: string,
    _cacheDirectory: string,
    readonly baselinePath?: string,
  ) {}

  async initialize(): Promise<{ requiresRestart: boolean }> {
    this.status = {
      systemStatus: "Indexed",
      message: "Index up-to-date.",
      processedItems: 1,
      totalItems: 1,
      percent: 100,
    }
    this.onProgressUpdate.fire(this.status)
    return { requiresRestart: true }
  }

  async startIndexing(): Promise<void> {
    this.startCount += 1
    this.status = { ...this.status, systemStatus: "Indexed", message: "Index up-to-date." }
    this.onProgressUpdate.fire(this.status)
  }

  async clearIndexData(): Promise<void> {
    this.clearCount += 1
  }

  async searchIndex(): Promise<VectorStoreSearchResult[]> {
    return this.results
  }

  getCurrentStatus(): EngineProgress {
    return this.status
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

export interface TestContext {
  root: string
  primary: string
  worktree: string
  config: ServiceConfig
  managers: Map<string, FakeManager>
  factory: ManagedIndexFactory
  cleanup(): Promise<void>
}

export async function createTestContext(): Promise<TestContext> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "paseo-semantic-index-"))
  const root = await realpath(temporaryRoot)
  const primary = join(root, "primary")
  const worktree = join(root, "worktree")
  const stateDirectory = join(root, "state")
  const cacheDirectory = join(root, "cache")
  await Promise.all([primary, worktree, stateDirectory, cacheDirectory].map((directory) => mkdir(directory)))
  const managers = new Map<string, FakeManager>()
  const factory: ManagedIndexFactory = (workspacePath, cache, baselinePath) => {
    const manager = new FakeManager(workspacePath, cache, baselinePath)
    managers.set(workspacePath, manager)
    return manager
  }
  const config: ServiceConfig = {
    stateDirectory,
    cacheDirectory,
    allowedRoots: [root],
    listen: { host: "127.0.0.1", port: 0 },
    controlToken: "control-token-for-tests",
    mcpToken: "mcp-token-for-tests-only",
    indexing: {
      enabled: true,
      provider: "openai-compatible",
      model: "test-model",
      dimension: 32,
      vectorStore: "qdrant",
      "openai-compatible": { baseUrl: "http://127.0.0.1:8001/v1" },
      qdrant: { url: "http://127.0.0.1:6333" },
    },
  }
  return {
    root,
    primary,
    worktree,
    config,
    managers,
    factory,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

export const quietLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}
