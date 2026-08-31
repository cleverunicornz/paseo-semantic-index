import { z } from "zod"

export const RegistrationId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
export type RegistrationId = z.infer<typeof RegistrationId>

export const RegistrationKind = z.enum(["primary", "worktree"])
export type RegistrationKind = z.infer<typeof RegistrationKind>

export const IndexState = z.enum(["Standby", "Indexing", "Indexed", "Error"])
export type IndexState = z.infer<typeof IndexState>

export const ServicePhase = z.enum(["starting", "ready", "degraded", "stopping", "stopped"])
export type ServicePhase = z.infer<typeof ServicePhase>

export const RegistrationRequest = z
  .object({
    path: z.string().min(1),
    baselinePath: z.string().min(1).optional(),
  })
  .strict()
export type RegistrationRequest = z.infer<typeof RegistrationRequest>

export const PersistedRegistration = z
  .object({
    id: RegistrationId,
    path: z.string().min(1),
    baselinePath: z.string().min(1).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict()
export type PersistedRegistration = z.infer<typeof PersistedRegistration>

export const RegistrationStatus = z
  .object({
    id: RegistrationId,
    kind: RegistrationKind,
    path: z.string(),
    baselinePath: z.string().optional(),
    state: IndexState,
    message: z.string(),
    processedItems: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
    references: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lastCompletedAt: z.iso.datetime().optional(),
    filesIndexed: z.number().int().nonnegative().optional(),
    filesDiscovered: z.number().int().nonnegative().optional(),
    totalChunks: z.number().int().nonnegative().optional(),
    lastError: z.string().optional(),
  })
  .strict()
export type RegistrationStatus = z.infer<typeof RegistrationStatus>

export const ServiceStatus = z
  .object({
    phase: ServicePhase,
    version: z.string(),
    startedAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime(),
    message: z.string(),
    registrations: z.array(RegistrationStatus),
    activeManagers: z.number().int().nonnegative(),
    mcpSessions: z.number().int().nonnegative(),
  })
  .strict()
export type ServiceStatus = z.infer<typeof ServiceStatus>

export const SearchRequest = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    path: z.string().trim().max(1_024).optional(),
    maxResults: z.number().int().min(1).max(50).default(20),
  })
  .strict()
export type SearchRequest = z.infer<typeof SearchRequest>

export const SearchResult = z
  .object({
    filePath: z.string(),
    score: z.number(),
    startLine: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    codeChunk: z.string(),
  })
  .strict()
export type SearchResult = z.infer<typeof SearchResult>

export const SearchResponse = z
  .object({
    workspace: z.string(),
    state: IndexState,
    results: z.array(SearchResult),
  })
  .strict()
export type SearchResponse = z.infer<typeof SearchResponse>

export const OperationKind = z.enum(["reindex", "purge"])
export const OperationState = z.enum(["running", "completed", "failed"])

export const OperationStatus = z
  .object({
    id: z.uuid(),
    registrationId: RegistrationId,
    kind: OperationKind,
    state: OperationState,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    error: z.string().optional(),
  })
  .strict()
export type OperationStatus = z.infer<typeof OperationStatus>
