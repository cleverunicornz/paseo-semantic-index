import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { CodeIndexManager } from "@cleverunicornz/semantic-index-engine"
import { toIndexingConfigInput } from "@cleverunicornz/semantic-index-engine/config"
import { Mutex } from "async-mutex"
import { z } from "zod"
import {
  OperationStatus,
  PersistedRegistration,
  RegistrationId,
  type RegistrationRequest,
  type RegistrationStatus,
  type SearchResponse,
  type SearchResult,
} from "./contracts"
import type { ServiceConfig } from "./config"
import type { Logger, ManagedIndex, ManagedIndexFactory } from "./types"

const RegistryFile = z
  .object({
    version: z.literal(1),
    registrations: z.array(PersistedRegistration),
  })
  .strict()

interface RegistrationRecord extends z.infer<typeof PersistedRegistration> {}

interface ManagerEntry {
  manager: ManagedIndex
  records: Map<string, RegistrationRecord>
  status: Omit<RegistrationStatus, "id" | "createdAt">
  progressSubscription: { dispose(): void }
  telemetrySubscription: { dispose(): void }
}

export interface RegistryOptions {
  createManager?: ManagedIndexFactory
  logger: Logger
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class IndexRegistry {
  private readonly entries = new Map<string, ManagerEntry>()
  private readonly registrations = new Map<string, { path: string; record: RegistrationRecord }>()
  private readonly locks = new Map<string, Mutex>()
  private readonly persistLock = new Mutex()
  private readonly operations = new Map<string, OperationStatus>()
  private readonly listeners = new Set<() => void>()
  private readonly registryPath: string
  private allowedRoots: string[] = []
  private disposed = false

  private readonly createManager: ManagedIndexFactory

  constructor(
    private readonly config: ServiceConfig,
    private readonly options: RegistryOptions,
  ) {
    this.registryPath = path.join(config.stateDirectory, "registrations.json")
    this.createManager =
      options.createManager ??
      ((workspacePath, cacheDirectory, baselinePath) =>
        new CodeIndexManager(workspacePath, cacheDirectory, baselinePath))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  async initialize(): Promise<void> {
    await Promise.all([mkdir(this.config.stateDirectory, { recursive: true }), mkdir(this.config.cacheDirectory, { recursive: true })])
    this.allowedRoots = await Promise.all(this.config.allowedRoots.map((root) => this.canonicalDirectory(root)))

    let persisted: z.infer<typeof RegistryFile>
    try {
      persisted = RegistryFile.parse(JSON.parse(await readFile(this.registryPath, "utf8")))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Failed to load semantic index registry: ${describeError(error)}`)
      }
      persisted = { version: 1, registrations: [] }
    }

    const ordered = [...persisted.registrations].sort((left, right) => {
      if (!!left.baselinePath === !!right.baselinePath) return left.createdAt.localeCompare(right.createdAt)
      return left.baselinePath ? 1 : -1
    })
    for (const record of ordered) {
      try {
        await this.register(record.id, { path: record.path, baselinePath: record.baselinePath }, record.createdAt, false)
      } catch (error) {
        this.options.logger.warn("Failed to restore semantic index registration", {
          registrationId: record.id,
          error: describeError(error),
        })
      }
    }
    await this.persist()
  }

  private lockFor(workspacePath: string): Mutex {
    let lock = this.locks.get(workspacePath)
    if (!lock) {
      lock = new Mutex()
      this.locks.set(workspacePath, lock)
    }
    return lock
  }

  private async canonicalDirectory(value: string): Promise<string> {
    const canonical = await realpath(value)
    const info = await stat(canonical)
    if (!info.isDirectory()) throw new Error(`Not a directory: ${value}`)
    return canonical
  }

  private assertAllowed(workspacePath: string): void {
    if (!this.allowedRoots.some((root) => isWithin(root, workspacePath))) {
      throw new Error("Workspace is outside the configured indexing roots")
    }
  }

  private async normalizeRequest(request: RegistrationRequest): Promise<{ path: string; baselinePath?: string }> {
    const workspacePath = await this.canonicalDirectory(request.path)
    this.assertAllowed(workspacePath)
    if (!request.baselinePath) return { path: workspacePath }

    const baselinePath = await this.canonicalDirectory(request.baselinePath)
    this.assertAllowed(baselinePath)
    if (workspacePath === baselinePath) throw new Error("A worktree baseline must differ from its workspace path")
    return { path: workspacePath, baselinePath }
  }

  async register(
    requestedId: string,
    request: RegistrationRequest,
    createdAt = new Date().toISOString(),
    persist = true,
  ): Promise<RegistrationStatus> {
    if (this.disposed) throw new Error("Index registry is disposed")
    const id = RegistrationId.parse(requestedId)
    const normalized = await this.normalizeRequest(request)
    const existing = this.registrations.get(id)
    if (existing) {
      if (existing.path !== normalized.path || existing.record.baselinePath !== normalized.baselinePath) {
        throw new Error(`Registration ID already belongs to another workspace: ${id}`)
      }
      return this.status(id)
    }

    if (normalized.baselinePath) {
      const baseline = this.entries.get(normalized.baselinePath)
      if (!baseline || ![...baseline.records.values()].some((record) => !record.baselinePath)) {
        throw new Error("The primary baseline must be registered before its worktree")
      }
    }

    return this.lockFor(normalized.path).runExclusive(async () => {
      const raced = this.registrations.get(id)
      if (raced) return this.status(id)

      const record: RegistrationRecord = {
        id,
        path: normalized.path,
        baselinePath: normalized.baselinePath,
        createdAt,
      }
      let entry = this.entries.get(normalized.path)
      if (entry) {
        if (entry.manager.baselinePath !== normalized.baselinePath) {
          throw new Error("Workspace is already registered with a different baseline")
        }
        entry.records.set(id, record)
      } else {
        entry = await this.createEntry(record)
        this.entries.set(normalized.path, entry)
      }
      this.registrations.set(id, { path: normalized.path, record })
      if (persist) await this.persist()
      this.changed()
      return this.status(id)
    })
  }

  private async createEntry(record: RegistrationRecord): Promise<ManagerEntry> {
    const manager = this.createManager(record.path, this.config.cacheDirectory, record.baselinePath)
    const now = new Date().toISOString()
    const entry: ManagerEntry = {
      manager,
      records: new Map([[record.id, record]]),
      status: {
        kind: record.baselinePath ? "worktree" : "primary",
        path: record.path,
        baselinePath: record.baselinePath,
        state: "Standby",
        message: "Initializing semantic index.",
        processedItems: 0,
        totalItems: 0,
        percent: 0,
        references: 1,
        updatedAt: now,
      },
      progressSubscription: { dispose() {} },
      telemetrySubscription: { dispose() {} },
    }

    entry.progressSubscription = manager.onProgressUpdate.on((progress) => {
      entry.status.state = progress.systemStatus
      entry.status.message = progress.message ?? ""
      entry.status.processedItems = progress.processedItems
      entry.status.totalItems = progress.totalItems
      entry.status.percent = progress.percent ?? (progress.totalItems > 0 ? Math.round((progress.processedItems / progress.totalItems) * 100) : 0)
      entry.status.updatedAt = new Date().toISOString()
      if (progress.systemStatus === "Error") entry.status.lastError = progress.message
      if (progress.systemStatus === "Indexed" && !record.baselinePath) this.startWaitingWorktrees(record.path)
      this.changed()
    })
    entry.telemetrySubscription = manager.onTelemetry.on((event) => {
      entry.status.updatedAt = new Date().toISOString()
      if (event.type === "completed") {
        entry.status.lastCompletedAt = entry.status.updatedAt
        entry.status.filesIndexed = event.filesIndexed
        entry.status.filesDiscovered = event.filesDiscovered
        entry.status.totalChunks = event.totalBlocks
        entry.status.lastError = undefined
      } else if (event.type === "error") {
        entry.status.lastError = event.error
      }
      this.changed()
    })

    try {
      await manager.initialize(toIndexingConfigInput(this.config.indexing))
      const status = manager.getCurrentStatus()
      entry.status.state = status.systemStatus
      entry.status.message = status.message ?? ""
      entry.status.processedItems = status.processedItems
      entry.status.totalItems = status.totalItems
      entry.status.percent = status.percent ?? 0
      entry.status.updatedAt = new Date().toISOString()
      return entry
    } catch (error) {
      entry.progressSubscription.dispose()
      entry.telemetrySubscription.dispose()
      await manager.dispose().catch(() => undefined)
      throw error
    }
  }

  private startWaitingWorktrees(baselinePath: string): void {
    for (const entry of this.entries.values()) {
      if (entry.manager.baselinePath !== baselinePath || entry.status.state !== "Standby") continue
      void entry.manager.startIndexing().catch((error) => {
        entry.status.state = "Error"
        entry.status.lastError = describeError(error)
        entry.status.message = entry.status.lastError
        entry.status.updatedAt = new Date().toISOString()
        this.changed()
      })
    }
  }

  async release(idValue: string, purge?: boolean): Promise<void> {
    const id = RegistrationId.parse(idValue)
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`Unknown registration: ${id}`)
    await this.lockFor(registration.path).runExclusive(async () => {
      const entry = this.entries.get(registration.path)
      if (!entry) throw new Error(`Registration manager is unavailable: ${id}`)
      entry.records.delete(id)
      this.registrations.delete(id)
      if (entry.records.size === 0) {
        const shouldPurge = purge ?? !!entry.manager.baselinePath
        if (shouldPurge) await entry.manager.clearIndexData()
        entry.progressSubscription.dispose()
        entry.telemetrySubscription.dispose()
        await entry.manager.dispose()
        this.entries.delete(registration.path)
        this.locks.delete(registration.path)
      }
      await this.persist()
      this.changed()
    })
  }

  status(idValue: string): RegistrationStatus {
    const id = RegistrationId.parse(idValue)
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`Unknown registration: ${id}`)
    const entry = this.entries.get(registration.path)
    if (!entry) throw new Error(`Registration manager is unavailable: ${id}`)
    return {
      id,
      ...entry.status,
      references: entry.records.size,
      createdAt: registration.record.createdAt,
    }
  }

  list(): RegistrationStatus[] {
    return [...this.registrations.keys()].map((id) => this.status(id)).sort((left, right) => left.id.localeCompare(right.id))
  }

  statusForPath(workspacePath: string): RegistrationStatus {
    const entry = this.entries.get(workspacePath)
    const first = entry?.records.keys().next().value as string | undefined
    if (!first) throw new Error("The workspace root is not registered for semantic indexing")
    return this.status(first)
  }

  hasPath(workspacePath: string): boolean {
    return this.entries.has(workspacePath)
  }

  async resolveRegisteredPath(workspacePath: string): Promise<string> {
    const canonical = await this.canonicalDirectory(workspacePath)
    if (!this.entries.has(canonical)) throw new Error("The MCP workspace root is not registered for semantic indexing")
    return canonical
  }

  private relativePrefix(value: string | undefined): string | undefined {
    if (!value || value === ".") return undefined
    if (path.isAbsolute(value)) throw new Error("Search paths must be relative to the workspace root")
    const normalized = path.normalize(value)
    if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
      throw new Error("Search path escapes the workspace root")
    }
    return normalized
  }

  async search(workspacePath: string, query: string, searchPath?: string, maxResults = 20): Promise<SearchResponse> {
    const canonical = await this.resolveRegisteredPath(workspacePath)
    const entry = this.entries.get(canonical)!
    const results = await entry.manager.searchIndex(query, this.relativePrefix(searchPath))
    const mapped: SearchResult[] = []
    for (const result of results.slice(0, maxResults)) {
      const payload = result.payload
      if (!payload || typeof payload.filePath !== "string" || typeof payload.codeChunk !== "string") continue
      const filePath = path.isAbsolute(payload.filePath) ? path.relative(canonical, payload.filePath) : payload.filePath
      if (!filePath || filePath === ".." || filePath.startsWith(`..${path.sep}`) || path.isAbsolute(filePath)) continue
      mapped.push({
        filePath: filePath.replaceAll("\\", "/"),
        score: result.score,
        startLine: Number(payload.startLine) || 0,
        endLine: Number(payload.endLine) || 0,
        codeChunk: payload.codeChunk,
      })
    }
    return { workspace: path.basename(canonical), state: entry.status.state, results: mapped }
  }

  startOperation(idValue: string, kind: "reindex" | "purge"): OperationStatus {
    const id = RegistrationId.parse(idValue)
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`Unknown registration: ${id}`)
    const operation: OperationStatus = {
      id: randomUUID(),
      registrationId: id,
      kind,
      state: "running",
      startedAt: new Date().toISOString(),
    }
    this.operations.set(operation.id, operation)
    this.trimOperations()
    this.changed()
    void this.lockFor(registration.path)
      .runExclusive(async () => {
        const entry = this.entries.get(registration.path)
        if (!entry) throw new Error(`Registration manager is unavailable: ${id}`)
        await entry.manager.clearIndexData()
        if (kind === "reindex") await entry.manager.startIndexing()
      })
      .then(
        () => {
          operation.state = "completed"
          operation.completedAt = new Date().toISOString()
          this.changed()
        },
        (error) => {
          operation.state = "failed"
          operation.completedAt = new Date().toISOString()
          operation.error = describeError(error)
          this.changed()
        },
      )
    return { ...operation }
  }

  operation(id: string): OperationStatus {
    const operation = this.operations.get(id)
    if (!operation) throw new Error(`Unknown operation: ${id}`)
    return { ...operation }
  }

  private trimOperations(): void {
    while (this.operations.size > 100) {
      const oldest = this.operations.keys().next().value as string | undefined
      if (!oldest) break
      this.operations.delete(oldest)
    }
  }

  private async persist(): Promise<void> {
    await this.persistLock.runExclusive(async () => {
      const registrations = [...this.registrations.values()]
        .map(({ record }) => record)
        .sort((left, right) => left.id.localeCompare(right.id))
      const temporary = `${this.registryPath}.${process.pid}.${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 8)}.tmp`
      await writeFile(temporary, `${JSON.stringify({ version: 1, registrations }, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.registryPath)
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    this.registrations.clear()
    this.listeners.clear()
    await Promise.all(
      entries.map(async (entry) => {
        entry.progressSubscription.dispose()
        entry.telemetrySubscription.dispose()
        await entry.manager.dispose()
      }),
    )
  }
}
