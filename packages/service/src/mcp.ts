import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import { RegistrationStatus, SearchRequest, SearchResponse } from "./contracts"
import type { IndexRegistry } from "./registry"
import type { Logger } from "./types"

interface Session {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  }
}

export class McpSessionManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly registry: IndexRegistry,
    private readonly logger: Logger,
  ) {}

  get size(): number {
    return this.sessions.size
  }

  private createSession(): Session {
    let session: Session
    const server = new McpServer(
      { name: "paseo-semantic-index", version: "0.1.0" },
      { capabilities: { logging: {} } },
    )
    let root: string | undefined
    const resolveRoot = async (): Promise<string> => {
      if (root) return root
      const response = await server.server.listRoots()
      const candidates: string[] = []
      for (const item of response.roots) {
        if (!item.uri.startsWith("file:")) continue
        try {
          candidates.push(await this.registry.resolveRegisteredPath(fileURLToPath(item.uri)))
        } catch {
          // A client may advertise additional roots; only registered roots are eligible.
        }
      }
      const matches = [...new Set(candidates)]
      if (matches.length !== 1) {
        throw new Error("Exactly one registered MCP workspace root is required")
      }
      root = matches[0]
      return root
    }

    server.registerTool(
      "semantic_search",
      {
        title: "Semantic code search",
        description: "Search the current workspace's continuously updated semantic code index.",
        inputSchema: SearchRequest,
        outputSchema: SearchResponse,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const request = SearchRequest.parse(input)
          const response = await this.registry.search(
            await resolveRoot(),
            request.query,
            request.path,
            request.maxResults,
          )
          return {
            content: [{ type: "text" as const, text: JSON.stringify(response) }],
            structuredContent: response,
          }
        } catch (error) {
          return errorResult(error)
        }
      },
    )

    const AgentStatus = RegistrationStatus.pick({
      kind: true,
      state: true,
      message: true,
      processedItems: true,
      totalItems: true,
      percent: true,
      updatedAt: true,
      lastCompletedAt: true,
      filesIndexed: true,
      filesDiscovered: true,
      totalChunks: true,
      lastError: true,
    }).strip()
    server.registerTool(
      "index_status",
      {
        title: "Semantic index status",
        description: "Return indexing readiness and progress for the current workspace.",
        outputSchema: AgentStatus,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        try {
          const status = this.registry.statusForPath(await resolveRoot())
          const response = AgentStatus.parse(status)
          return {
            content: [{ type: "text" as const, text: JSON.stringify(response) }],
            structuredContent: response,
          }
        } catch (error) {
          return errorResult(error)
        }
      },
    )

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, session)
      },
      onsessionclosed: (sessionId) => {
        const closed = this.sessions.get(sessionId)
        this.sessions.delete(sessionId)
        if (closed) queueMicrotask(() => void closed.server.close().catch(() => undefined))
      },
    })
    transport.onerror = (error) => this.logger.warn("MCP transport error", { error: error.message })
    session = { server, transport }
    return session
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = typeof req.headers["mcp-session-id"] === "string" ? req.headers["mcp-session-id"] : undefined
    let session = sessionId ? this.sessions.get(sessionId) : undefined

    if (sessionId && !session) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown MCP session" }, id: null }))
      return
    }
    if (!session) {
      if (req.method !== "POST") {
        res.writeHead(400, { "content-type": "application/json" })
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "MCP session required" }, id: null }))
        return
      }
      session = this.createSession()
      await session.server.connect(session.transport)
    }

    try {
      await session.transport.handleRequest(req, res)
    } catch (error) {
      this.logger.warn("MCP request failed", { error: error instanceof Error ? error.message : String(error) })
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal MCP error" }, id: null }))
      }
    } finally {
      if (!session.transport.sessionId) await session.server.close().catch(() => undefined)
    }
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map(({ server }) => server.close().catch(() => undefined)))
  }
}
