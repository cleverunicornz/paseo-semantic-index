import { pathToFileURL } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const endpoint = new URL(process.env.SEMANTIC_INDEX_MCP_URL ?? "http://127.0.0.1:7790/mcp")
const workspace = process.argv[2]
const marker = process.argv[3]
if (!workspace || !marker) throw new Error("Usage: mcp-smoke.mjs WORKSPACE MARKER")

const client = new Client(
  { name: "semantic-index-e2e", version: "0.1.0" },
  { capabilities: { roots: { listChanged: false } } },
)
client.setRequestHandler(ListRootsRequestSchema, async () => ({
  roots: [{ uri: pathToFileURL(workspace).href, name: "qualification workspace" }],
}))
const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: { authorization: `Bearer ${process.env.SEMANTIC_INDEX_MCP_TOKEN}` },
  },
})

try {
  await client.connect(transport)
  const tools = await client.listTools()
  if (!tools.tools.some((tool) => tool.name === "semantic_search")) throw new Error("semantic_search tool missing")
  if (!tools.tools.some((tool) => tool.name === "index_status")) throw new Error("index_status tool missing")
  const result = await client.callTool({
    name: "semantic_search",
    arguments: { query: marker, maxResults: 10 },
  })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  if (!JSON.stringify(result.structuredContent).includes(marker)) {
    throw new Error(`MCP search did not return marker ${marker}: ${JSON.stringify(result)}`)
  }
  const status = await client.callTool({ name: "index_status", arguments: {} })
  if (status.isError || !JSON.stringify(status.structuredContent).includes("Indexed")) {
    throw new Error(`MCP index status was not ready: ${JSON.stringify(status)}`)
  }
} finally {
  await client.close()
}
