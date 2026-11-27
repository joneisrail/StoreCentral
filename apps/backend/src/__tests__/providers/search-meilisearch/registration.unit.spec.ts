import { asValue } from "@medusajs/framework/awilix"
import { createMedusaContainer, Modules } from "@medusajs/framework/utils"

import { MeilisearchSearchService } from "../../../providers/search-meilisearch/services/meilisearch-search"

/**
 * Registers the Search Module's providers exactly as the module does at boot
 * (its own provider loader and registry), from the real medusa-config, without
 * a database or a running server. The Postgres provider gets a stub manager:
 * it is only constructed here, never queried.
 */

const providersLoader = require("@medusajs/search/dist/loaders/providers").default
const { SearchProviderService } = require("@medusajs/search/dist/services/search-provider")

/**
 * medusa-config with the given env. medusa-config's loadEnv fills unset vars
 * from apps/backend/.env but never overrides a set one, so "" stands for
 * "unset or empty" here.
 */
function loadConfig(env: Record<string, string>) {
  const saved = { ...process.env }
  Object.assign(process.env, env)

  try {
    let config: any
    jest.isolateModules(() => {
      config = require("../../../../medusa-config")
    })
    return config
  } finally {
    process.env = saved
  }
}

async function register(config: any) {
  const declaration = config.modules[Modules.SEARCH]
  const container = createMedusaContainer()
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  container.register({
    logger: asValue(logger),
    manager: asValue({ execute: jest.fn(async () => []) }),
  })

  await providersLoader({ container, options: declaration.options })

  return { container, declaration }
}

describe("Search Module registration", () => {
  it("registers @medusajs/medusa/search, which exists", () => {
    expect(() => require.resolve("@medusajs/medusa/search")).not.toThrow()
    const config = loadConfig({ MEILISEARCH_API_KEY: "test-key" })
    expect(config.modules[Modules.SEARCH].resolve).toBe("@medusajs/medusa/search")
  })

  it("registers meilisearch as srh_meilisearch_meilisearch and makes it the default", async () => {
    const config = loadConfig({
      MEILISEARCH_API_KEY: "test-key",
      MEILISEARCH_HOST: "",
    })
    const { container, declaration } = await register(config)

    const keys = Object.keys(container.registrations)
    expect(keys).toEqual(
      expect.arrayContaining(["srh_meilisearch_meilisearch", "srh_search-postgres_postgres"]),
    )

    const registry = new SearchProviderService(container.cradle)
    const provider = registry.retrieve("meilisearch")

    expect(provider).toBeInstanceOf(MeilisearchSearchService)
    expect(registry.getDefaultIdentifier(declaration.options.default_provider)).toBe(
      "meilisearch",
    )
    // Definitions that name `provider: "meilisearch"` bind to the same instance.
    expect(registry.retrieve(provider.identifier)).toBe(provider)
    expect(provider).toMatchObject({
      host_: "http://127.0.0.1:7700",
      apiKey_: "test-key",
      timeout_: 3000,
    })
    // Kept so the old Postgres-built versions can still be dropped.
    expect(registry.retrieve("search-postgres")).toBeDefined()
    expect(declaration.options.index_prefix).toBeUndefined()
  })

  it("reads MEILISEARCH_HOST", async () => {
    const config = loadConfig({
      MEILISEARCH_API_KEY: "test-key",
      MEILISEARCH_HOST: "http://meilisearch:7700",
    })
    const { container } = await register(config)
    const registry = new SearchProviderService(container.cradle)
    expect(registry.retrieve("meilisearch")).toMatchObject({
      host_: "http://meilisearch:7700",
    })
  })

  it("fails at construction, naming MEILISEARCH_API_KEY, when the key is empty", async () => {
    const config = loadConfig({ MEILISEARCH_API_KEY: "" })
    const { container } = await register(config)
    expect(() => new SearchProviderService(container.cradle)).toThrow(/MEILISEARCH_API_KEY/)
  })
})
