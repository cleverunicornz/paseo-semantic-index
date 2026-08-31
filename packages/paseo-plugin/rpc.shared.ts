import {
  OperationStatus,
  RegistrationId,
  RegistrationStatus,
  ServiceStatus,
} from "@cleverunicornz/semantic-index-service/contracts"
import { defineRpc } from "@getpaseo/plugin/server"
import { z } from "zod"

export const serviceStatusRpc = defineRpc({
  name: "semantic-index.status",
  input: z.object({}).strict(),
  output: ServiceStatus,
})

export const workspaceStatusRpc = defineRpc({
  name: "semantic-index.workspace-status",
  input: z.object({ path: z.string().min(1) }).strict(),
  output: RegistrationStatus.nullable(),
})

export const registerWorkspaceRpc = defineRpc({
  name: "semantic-index.register",
  input: z
    .object({
      id: RegistrationId,
      path: z.string().min(1),
      baselinePath: z.string().min(1).optional(),
    })
    .strict(),
  output: RegistrationStatus,
})

export const releaseWorkspaceRpc = defineRpc({
  name: "semantic-index.release",
  input: z.object({ id: RegistrationId, purge: z.boolean().optional() }).strict(),
  output: z.object({ released: RegistrationId }).strict(),
})

export const reindexWorkspaceRpc = defineRpc({
  name: "semantic-index.reindex",
  input: z.object({ id: RegistrationId }).strict(),
  output: OperationStatus,
})
