import { readFile } from "node:fs/promises"
import {
  OperationStatus,
  RegistrationStatus,
  SearchResponse,
  ServiceStatus,
  type RegistrationRequest,
  type SearchRequest,
} from "@cleverunicornz/semantic-index-service/contracts"
import { z } from "zod"

const RegistrationList = z.object({ registrations: z.array(RegistrationStatus) })

export interface IndexClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof globalThis.fetch
}

export class IndexClient {
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: IndexClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetch(new URL(path, this.options.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    })
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    if (!response.ok) {
      const message = typeof body === "object" && body && "error" in body ? String(body.error) : `HTTP ${response.status}`
      throw new Error(message)
    }
    return body
  }

  async serviceStatus() {
    return ServiceStatus.parse(await this.request("/v1/status"))
  }

  async list() {
    return RegistrationList.parse(await this.request("/v1/registrations")).registrations
  }

  async register(id: string, request: RegistrationRequest) {
    return RegistrationStatus.parse(
      await this.request(`/v1/registrations/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(request),
      }),
    )
  }

  async status(id: string) {
    return RegistrationStatus.parse(await this.request(`/v1/registrations/${encodeURIComponent(id)}`))
  }

  async release(id: string, purge?: boolean) {
    const query = purge === undefined ? "" : `?purge=${purge}`
    return this.request(`/v1/registrations/${encodeURIComponent(id)}${query}`, { method: "DELETE" })
  }

  async startOperation(id: string, kind: "reindex" | "purge") {
    return OperationStatus.parse(
      await this.request(`/v1/registrations/${encodeURIComponent(id)}/${kind}`, { method: "POST" }),
    )
  }

  async operation(id: string) {
    return OperationStatus.parse(await this.request(`/v1/operations/${encodeURIComponent(id)}`))
  }

  async search(id: string, request: SearchRequest) {
    return SearchResponse.parse(
      await this.request("/v1/search", {
        method: "POST",
        body: JSON.stringify({ registrationId: id, ...request }),
      }),
    )
  }
}

export async function clientFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Promise<IndexClient> {
  const baseUrl = environment.SEMANTIC_INDEX_URL ?? "http://127.0.0.1:7790"
  const direct = environment.SEMANTIC_INDEX_CONTROL_TOKEN
  const tokenFile = environment.SEMANTIC_INDEX_CONTROL_TOKEN_FILE
  const token = direct ?? (tokenFile ? (await readFile(tokenFile, "utf8")).trim() : undefined)
  if (!token) throw new Error("SEMANTIC_INDEX_CONTROL_TOKEN or SEMANTIC_INDEX_CONTROL_TOKEN_FILE is required")
  return new IndexClient({ baseUrl, token })
}
