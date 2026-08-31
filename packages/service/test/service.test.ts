import { afterEach, describe, expect, test } from "vitest"
import { SemanticIndexService } from "../src/service"
import { createTestContext, type TestContext, quietLogger } from "./helpers"

let context: TestContext | undefined
let service: SemanticIndexService | undefined

afterEach(async () => {
  await service?.close()
  await context?.cleanup()
  service = undefined
  context = undefined
})

describe("SemanticIndexService", () => {
  test("serves authenticated control operations on an isolated loopback port", async () => {
    context = await createTestContext()
    service = new SemanticIndexService(context.config, {
      logger: quietLogger,
      registry: { createManager: context.factory },
    })
    await service.start()
    const address = service.http.listenAddress!
    const base = `http://${address.host}:${address.port}`

    expect(await fetch(`${base}/healthz`).then((response) => response.json())).toEqual({ status: "ready" })
    expect((await fetch(`${base}/v1/status`)).status).toBe(401)

    const headers = {
      authorization: `Bearer ${context.config.controlToken}`,
      "content-type": "application/json",
    }
    const registered = await fetch(`${base}/v1/registrations/primary`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ path: context.primary }),
    })
    expect(registered.status).toBe(200)
    expect((await registered.json()).state).toBe("Indexed")

    const status = await fetch(`${base}/v1/status`, { headers }).then((response) => response.json())
    expect(status.activeManagers).toBe(1)
    expect(status.registrations).toHaveLength(1)

    const search = await fetch(`${base}/v1/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ registrationId: "primary", query: "authentication", maxResults: 5 }),
    }).then((response) => response.json())
    expect(search.results[0].filePath).toBe("src/auth.ts")
  })
})
