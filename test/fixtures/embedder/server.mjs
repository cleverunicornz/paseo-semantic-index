import { createServer } from "node:http"

const dimension = Number(process.env.EMBEDDING_DIMENSION ?? 32)
const port = Number(process.env.PORT ?? 8001)
const stopwords = new Set([
  "a",
  "an",
  "and",
  "as",
  "const",
  "export",
  "for",
  "from",
  "function",
  "in",
  "is",
  "of",
  "return",
  "the",
  "to",
])

function hash(value) {
  let output = 2166136261
  for (const character of value) {
    output ^= character.codePointAt(0)
    output = Math.imul(output, 16777619)
  }
  return output >>> 0
}

function embed(text) {
  const expanded = String(text).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  const tokens = expanded.match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !stopwords.has(token)) ?? []
  const vector = new Float32Array(dimension)
  for (const token of tokens) {
    vector[hash(token) % dimension] += 1
    vector[hash(`pair:${token}`) % dimension] += 0.35
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  for (let index = 0; index < vector.length; index += 1) vector[index] /= magnitude
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64")
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function json(response, status, value) {
  const payload = JSON.stringify(value)
  response.writeHead(status, {
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json",
  })
  response.end(payload)
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    json(response, 200, { status: "ok", dimension })
    return
  }
  if (request.method !== "POST" || request.url !== "/v1/embeddings") {
    json(response, 404, { error: "Not found" })
    return
  }
  try {
    const input = await body(request)
    const texts = Array.isArray(input.input) ? input.input : [input.input]
    json(response, 200, {
      object: "list",
      model: input.model,
      data: texts.map((text, index) => ({ object: "embedding", index, embedding: embed(text) })),
      usage: {
        prompt_tokens: texts.reduce((sum, text) => sum + Math.ceil(String(text).length / 4), 0),
        total_tokens: texts.reduce((sum, text) => sum + Math.ceil(String(text).length / 4), 0),
      },
    })
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`deterministic embedder listening on ${port}`)
})
