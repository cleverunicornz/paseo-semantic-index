import { readFile, writeFile } from "node:fs/promises"
import { afterEach, describe, expect, test } from "vitest"
import { IndexRegistry } from "../src/registry"
import { createTestContext, type TestContext, quietLogger } from "./helpers"

let context: TestContext | undefined

afterEach(async () => {
  await context?.cleanup()
  context = undefined
})

describe("IndexRegistry", () => {
  test("reference-counts registrations for one canonical workspace", async () => {
    context = await createTestContext()
    const registry = new IndexRegistry(context.config, { logger: quietLogger, createManager: context.factory })
    await registry.initialize()

    await registry.register("primary-a", { path: context.primary })
    await registry.register("primary-b", { path: context.primary })
    expect(registry.status("primary-a").references).toBe(2)
    expect(context.managers.size).toBe(1)

    await registry.release("primary-a")
    expect(context.managers.get(context.primary)?.disposed).toBe(false)
    expect(registry.status("primary-b").references).toBe(1)

    await registry.release("primary-b")
    expect(context.managers.get(context.primary)?.disposed).toBe(true)
    expect(registry.list()).toEqual([])
    await registry.dispose()
  })

  test("requires a registered baseline before a worktree", async () => {
    context = await createTestContext()
    const registry = new IndexRegistry(context.config, { logger: quietLogger, createManager: context.factory })
    await registry.initialize()

    await expect(
      registry.register("worktree", { path: context.worktree, baselinePath: context.primary }),
    ).rejects.toThrow("primary baseline")
    await registry.register("primary", { path: context.primary })
    const worktree = await registry.register("worktree", {
      path: context.worktree,
      baselinePath: context.primary,
    })
    expect(worktree.kind).toBe("worktree")
    expect(worktree.baselinePath).toBe(context.primary)
    await registry.dispose()
  })

  test("persists registrations and restores primary managers before worktrees", async () => {
    context = await createTestContext()
    const first = new IndexRegistry(context.config, { logger: quietLogger, createManager: context.factory })
    await first.initialize()
    await first.register("primary", { path: context.primary })
    await first.register("worktree", { path: context.worktree, baselinePath: context.primary })
    await first.dispose()

    const persisted = JSON.parse(await readFile(`${context.config.stateDirectory}/registrations.json`, "utf8"))
    expect(persisted.registrations.map((item: { id: string }) => item.id)).toEqual(["primary", "worktree"])

    const order: string[] = []
    const second = new IndexRegistry(context.config, {
      logger: quietLogger,
      createManager: (workspacePath, cache, baselinePath) => {
        order.push(workspacePath)
        return context!.factory(workspacePath, cache, baselinePath)
      },
    })
    await second.initialize()
    expect(order).toEqual([context.primary, context.worktree])
    await second.dispose()
  })

  test("maps search results and rejects escaping paths", async () => {
    context = await createTestContext()
    const registry = new IndexRegistry(context.config, { logger: quietLogger, createManager: context.factory })
    await registry.initialize()
    await registry.register("primary", { path: context.primary })

    const response = await registry.search(context.primary, "authentication", "src", 10)
    expect(response.workspace).toBe("primary")
    expect(response.results).toEqual([
      {
        filePath: "src/auth.ts",
        score: 0.91,
        startLine: 4,
        endLine: 8,
        codeChunk: "export function authenticate() {}",
      },
    ])
    await expect(registry.search(context.primary, "authentication", "../outside", 10)).rejects.toThrow("escapes")
    await registry.dispose()
  })

  test("tracks asynchronous reindex operations", async () => {
    context = await createTestContext()
    const registry = new IndexRegistry(context.config, { logger: quietLogger, createManager: context.factory })
    await registry.initialize()
    await registry.register("primary", { path: context.primary })

    const operation = registry.startOperation("primary", "reindex")
    await expect.poll(() => registry.operation(operation.id).state).toBe("completed")
    expect(context.managers.get(context.primary)?.clearCount).toBe(1)
    expect(context.managers.get(context.primary)?.startCount).toBe(1)
    await registry.dispose()
  })

  test("serializes persistence across independent workspace registrations", async () => {
    context = await createTestContext()
    const registry = new IndexRegistry(context.config, { logger: quietLogger, createManager: context.factory })
    await registry.initialize()

    await Promise.all([
      registry.register("primary", { path: context.primary }),
      registry.register("second-primary", { path: context.worktree }),
    ])
    const persisted = JSON.parse(await readFile(`${context.config.stateDirectory}/registrations.json`, "utf8"))
    expect(persisted.registrations.map((item: { id: string }) => item.id)).toEqual(["primary", "second-primary"])
    await registry.dispose()
  })

  test("fails closed instead of overwriting a corrupt registry", async () => {
    context = await createTestContext()
    const registryPath = `${context.config.stateDirectory}/registrations.json`
    await writeFile(registryPath, "not-json\n")
    const registry = new IndexRegistry(context.config, { logger: quietLogger, createManager: context.factory })

    await expect(registry.initialize()).rejects.toThrow("Failed to load semantic index registry")
    expect(await readFile(registryPath, "utf8")).toBe("not-json\n")
    await registry.dispose()
  })
})
