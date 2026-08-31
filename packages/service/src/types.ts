import type {
  IndexingConfigInput,
  IndexingTelemetryEvent,
  VectorStoreSearchResult,
} from "@cleverunicornz/semantic-index-engine"
import type { RegistrationStatus } from "./contracts"

export interface Logger {
  debug(message: string, attributes?: Record<string, unknown>): void
  info(message: string, attributes?: Record<string, unknown>): void
  warn(message: string, attributes?: Record<string, unknown>): void
  error(message: string, attributes?: Record<string, unknown>): void
}

export const consoleLogger: Logger = {
  debug: (message, attributes) => console.debug(message, attributes ?? ""),
  info: (message, attributes) => console.info(message, attributes ?? ""),
  warn: (message, attributes) => console.warn(message, attributes ?? ""),
  error: (message, attributes) => console.error(message, attributes ?? ""),
}

export interface ProgressEmitter {
  on(listener: (status: EngineProgress) => void): { dispose(): void }
}

export interface EngineProgress {
  systemStatus: RegistrationStatus["state"]
  message?: string
  processedItems: number
  totalItems: number
  percent?: number
}

export interface ManagedIndex {
  readonly workspacePath: string
  readonly baselinePath?: string
  readonly onProgressUpdate: ProgressEmitter
  readonly onTelemetry: {
    on(listener: (event: IndexingTelemetryEvent) => void): { dispose(): void }
  }
  initialize(config: IndexingConfigInput): Promise<{ requiresRestart: boolean }>
  startIndexing(): Promise<void>
  clearIndexData(): Promise<void>
  searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
  getCurrentStatus(): EngineProgress
  dispose(): Promise<void>
}

export type ManagedIndexFactory = (
  workspacePath: string,
  cacheDirectory: string,
  baselinePath?: string,
) => ManagedIndex
