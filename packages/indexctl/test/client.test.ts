import { describe, expect, test, vi } from "vitest"
import { IndexClient } from "../src/client"

describe("IndexClient", () => {
  test("keeps the control token in the authorization header", async () => {
    const fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          phase: "ready",
          version: "0.1.0",
          updatedAt: new Date(0).toISOString(),
          message: "ready",
          registrations: [],
          activeManagers: 0,
          mcpSessions: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const client = new IndexClient({ baseUrl: "http://127.0.0.1:7790", token: "secret-token-value", fetch })
    await client.serviceStatus()

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer secret-token-value" })
  })
})
