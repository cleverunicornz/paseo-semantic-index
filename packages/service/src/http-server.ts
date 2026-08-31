import { timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { z } from "zod"
import { RegistrationRequest, SearchRequest } from "./contracts"
import type { ServiceConfig } from "./config"
import type { McpSessionManager } from "./mcp"
import type { IndexRegistry } from "./registry"
import type { Logger } from "./types"

const ControlSearch = SearchRequest.extend({ registrationId: z.string().min(1) }).strict()
const MAX_BODY_BYTES = 64 * 1024

function authorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false
  const supplied = Buffer.from(header.slice(7))
  const target = Buffer.from(expected)
  return supplied.length === target.length && timingSafeEqual(supplied, target)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds 64 KiB")
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  })
  res.end(payload)
}

function routeId(pathname: string, suffix = ""): string | undefined {
  const pattern = suffix
    ? new RegExp(`^/v1/registrations/([^/]+)/${suffix}$`)
    : /^\/v1\/registrations\/([^/]+)$/
  const match = pathname.match(pattern)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

export interface HttpServerOptions {
  config: ServiceConfig
  registry: IndexRegistry
  mcp: McpSessionManager
  logger: Logger
  serviceStatus: () => unknown
}

export class SemanticIndexHttpServer {
  private server: Server | undefined
  private address: { host: string; port: number } | undefined

  constructor(private readonly options: HttpServerOptions) {}

  get listenAddress(): { host: string; port: number } | undefined {
    return this.address
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) return this.address!
    const server = createServer((req, res) => {
      void this.route(req, res).catch((error) => {
        this.options.logger.warn("Semantic index HTTP request failed", {
          method: req.method,
          path: req.url?.split("?", 1)[0],
          error: error instanceof Error ? error.message : String(error),
        })
        if (!res.headersSent) send(res, 400, { error: error instanceof Error ? error.message : String(error) })
        else res.end()
      })
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error)
      server.once("error", fail)
      server.listen(this.options.config.listen.port, this.options.config.listen.host, () => {
        server.off("error", fail)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Semantic index server did not bind a TCP address")
    this.address = { host: this.options.config.listen.host, port: address.port }
    return this.address
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/healthz" && req.method === "GET") {
      const status = this.options.serviceStatus() as { phase?: string }
      send(res, status.phase === "degraded" ? 503 : 200, { status: status.phase ?? "starting" })
      return
    }

    if (url.pathname === "/mcp") {
      if (!authorized(req.headers.authorization, this.options.config.mcpToken)) {
        send(res, 401, { error: "Unauthorized" })
        return
      }
      await this.options.mcp.handle(req, res)
      return
    }

    if (!url.pathname.startsWith("/v1/")) {
      send(res, 404, { error: "Not found" })
      return
    }
    if (!authorized(req.headers.authorization, this.options.config.controlToken)) {
      send(res, 401, { error: "Unauthorized" })
      return
    }

    if (url.pathname === "/v1/status" && req.method === "GET") {
      send(res, 200, this.options.serviceStatus())
      return
    }
    if (url.pathname === "/v1/registrations" && req.method === "GET") {
      send(res, 200, { registrations: this.options.registry.list() })
      return
    }
    if (url.pathname === "/v1/search" && req.method === "POST") {
      const request = ControlSearch.parse(await readJson(req))
      const status = this.options.registry.status(request.registrationId)
      send(
        res,
        200,
        await this.options.registry.search(status.path, request.query, request.path, request.maxResults),
      )
      return
    }

    const reindexId = routeId(url.pathname, "reindex")
    if (reindexId && req.method === "POST") {
      send(res, 202, this.options.registry.startOperation(reindexId, "reindex"))
      return
    }
    const purgeId = routeId(url.pathname, "purge")
    if (purgeId && req.method === "POST") {
      send(res, 202, this.options.registry.startOperation(purgeId, "purge"))
      return
    }
    const registrationId = routeId(url.pathname)
    if (registrationId && req.method === "PUT") {
      send(res, 200, await this.options.registry.register(registrationId, RegistrationRequest.parse(await readJson(req))))
      return
    }
    if (registrationId && req.method === "GET") {
      send(res, 200, this.options.registry.status(registrationId))
      return
    }
    if (registrationId && req.method === "DELETE") {
      const purge = url.searchParams.has("purge") ? url.searchParams.get("purge") !== "false" : undefined
      await this.options.registry.release(registrationId, purge)
      send(res, 200, { released: registrationId })
      return
    }

    const operationMatch = url.pathname.match(/^\/v1\/operations\/([^/]+)$/)
    if (operationMatch?.[1] && req.method === "GET") {
      send(res, 200, this.options.registry.operation(decodeURIComponent(operationMatch[1])))
      return
    }
    send(res, 404, { error: "Not found" })
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.address = undefined
    if (!server) return
    server.closeIdleConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}
