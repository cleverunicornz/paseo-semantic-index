#!/usr/bin/env node

import { parseArgs } from "node:util"
import { SearchRequest } from "@cleverunicornz/semantic-index-service/contracts"
import { clientFromEnvironment, type IndexClient } from "./client"

const HELP = `indexctl <command> [options]

Commands:
  register --id ID --path PATH [--baseline PATH] [--wait]
  status --id ID [--wait]
  list
  release --id ID [--purge]
  reindex --id ID [--wait]
  purge --id ID [--wait]
  search --id ID --query TEXT [--path PATH] [--max-results N]
  service-status

Options:
  --json               Print compact JSON
  --timeout DURATION   Wait timeout, for example 30s or 10m (default: 10m)
  --help               Show this help
`

interface CommonValues {
  id?: string
  path?: string
  baseline?: string
  query?: string
  "max-results"?: string
  timeout?: string
  wait?: boolean
  purge?: boolean
  json?: boolean
  help?: boolean
}

function duration(value: string | undefined): number {
  const input = value ?? "10m"
  const match = input.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) throw new Error(`Invalid duration: ${input}`)
  const amount = Number(match[1])
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2] as "ms" | "s" | "m" | "h"]
  return amount * factor
}

async function waitForRegistration(client: IndexClient, id: string, timeout: number) {
  const deadline = Date.now() + timeout
  while (true) {
    const status = await client.status(id)
    if (status.state === "Indexed") return status
    if (status.state === "Error") throw new Error(status.lastError ?? status.message)
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for registration ${id}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function waitForOperation(client: IndexClient, id: string, timeout: number) {
  const deadline = Date.now() + timeout
  while (true) {
    const operation = await client.operation(id)
    if (operation.state === "completed") return operation
    if (operation.state === "failed") throw new Error(operation.error ?? `Operation ${id} failed`)
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for operation ${id}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

function required(values: CommonValues, key: keyof CommonValues): string {
  const value = values[key]
  if (typeof value !== "string" || !value) throw new Error(`--${key} is required`)
  return value
}

function print(value: unknown, compact: boolean): void {
  process.stdout.write(`${JSON.stringify(value, null, compact ? undefined : 2)}\n`)
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0]
  const { values } = parseArgs({
    args: argv.slice(1),
    strict: true,
    options: {
      id: { type: "string" },
      path: { type: "string" },
      baseline: { type: "string" },
      query: { type: "string" },
      "max-results": { type: "string" },
      timeout: { type: "string" },
      wait: { type: "boolean" },
      purge: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  }) as { values: CommonValues }
  if (!command || values.help) {
    process.stdout.write(HELP)
    return
  }

  const client = await clientFromEnvironment()
  const timeout = duration(values.timeout)
  let result: unknown
  if (command === "register") {
    const id = required(values, "id")
    result = await client.register(id, {
      path: required(values, "path"),
      baselinePath: values.baseline,
    })
    if (values.wait) result = await waitForRegistration(client, id, timeout)
  } else if (command === "status") {
    const id = required(values, "id")
    result = values.wait ? await waitForRegistration(client, id, timeout) : await client.status(id)
  } else if (command === "list") {
    result = await client.list()
  } else if (command === "release") {
    result = await client.release(required(values, "id"), values.purge)
  } else if (command === "reindex" || command === "purge") {
    const operation = await client.startOperation(required(values, "id"), command)
    result = values.wait ? await waitForOperation(client, operation.id, timeout) : operation
  } else if (command === "search") {
    result = await client.search(
      required(values, "id"),
      SearchRequest.parse({
        query: required(values, "query"),
        path: values.path,
        maxResults: values["max-results"] ? Number(values["max-results"]) : undefined,
      }),
    )
  } else if (command === "service-status") {
    result = await client.serviceStatus()
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
  print(result, values.json ?? false)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
