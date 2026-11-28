import { createServer, Server } from "http"
import type { AddressInfo, Socket } from "net"

import { MedusaError } from "@medusajs/framework/utils"

import {
  INVALID_SORT,
  MeilisearchSearchService,
  SEARCH_UNAVAILABLE,
} from "../../../providers/search-meilisearch/services/meilisearch-search"

/**
 * Exercises the provider against real HTTP. Not matched by any TEST_TYPE; run
 * it from apps/backend WITHOUT --experimental-vm-modules (that flag makes Jest
 * refuse to require the ESM-only `meilisearch` client, which jest.config.js
 * otherwise compiles to CommonJS):
 *
 *   npx jest --runInBand --forceExit src/__tests__/providers/search-meilisearch/service.integration.spec.ts
 *
 * The timeout suite needs nothing running. The Meilisearch suite needs a server
 * at MEILISEARCH_HOST with MEILISEARCH_API_KEY (jest.config.js loads
 * apps/backend/.env); without both it is skipped with a logged message.
 */

function makeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}

describe("MeilisearchSearchService request timeout", () => {
  let server: Server
  const sockets = new Set<Socket>()
  let host: string

  beforeAll(async () => {
    // Accepts connections and never answers.
    server = createServer(() => undefined)
    server.on("connection", (socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    for (const socket of sockets) {
      socket.destroy()
    }
    await new Promise((resolve) => server.close(resolve))
  })

  it("gives up after the default 3000 ms with fixed text", async () => {
    const logger = makeLogger()
    const service = new MeilisearchSearchService({ logger } as any, {
      host,
      apiKey: "integration-timeout-key",
    })

    const started = Date.now()
    const error = await service
      .search({
        index: {
          name: "product",
          physical_name: "never_answers",
          primary_key: "id",
          fields: {},
        },
        attributes_to_retrieve: ["id"],
        q: "lattafa",
      } as any)
      .catch((e) => e)
    const elapsed = Date.now() - started

    expect(error).toBeInstanceOf(MedusaError)
    expect(error.message).toBe(SEARCH_UNAVAILABLE)
    expect(elapsed).toBeGreaterThanOrEqual(2900)
    expect(elapsed).toBeLessThan(4500)
    expect(logger.error.mock.calls[0][0]).toMatch(/timeout|timed out/i)
    expect(logger.error.mock.calls[0][0]).not.toContain("integration-timeout-key")
  }, 10_000)
})

const HOST = process.env.MEILISEARCH_HOST
const API_KEY = process.env.MEILISEARCH_API_KEY
const live = HOST && API_KEY ? describe : describe.skip

if (!HOST || !API_KEY) {
  console.log(
    "Skipping the Meilisearch integration suite: set MEILISEARCH_HOST and MEILISEARCH_API_KEY to run it.",
  )
}

live("MeilisearchSearchService against Meilisearch", () => {
  const uid = `sc_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const logger = makeLogger()
  let service: MeilisearchSearchService

  const definition: any = {
    name: "product",
    physical_name: uid,
    provider: "meilisearch",
    primary_key: "id",
    fields: {
      id: { type: "keyword", filterable: true },
      title: { type: "text", searchable: { weight: 3 }, sortable: true },
      brand: {
        type: "keyword",
        array: true,
        searchable: { weight: 2 },
        filterable: true,
        facetable: true,
      },
      price: { type: "number", filterable: true, sortable: true, facetable: true },
    },
    settings: { typo_tolerance: { enabled: true } },
  }

  const documents = [
    { id: "p1", title: "Lattafa Asad", brand: ["Lattafa"], price: 30 },
    { id: "p2", title: "Yves Saint Laurent Libre", brand: ["Yves Saint Laurent"], price: 120 },
    { id: "p3", title: "Dior Sauvage", brand: ["Dior"], price: 95 },
  ]

  function query(overrides: Record<string, any> = {}): any {
    return {
      index: definition,
      attributes_to_retrieve: ["id", "title", "brand", "price"],
      ...overrides,
    }
  }

  async function ids(overrides: Record<string, any>) {
    const result = await service.search(query(overrides))
    return result.hits.map((hit) => hit.id).sort()
  }

  async function count() {
    const indexes = await service.listIndexes()
    return indexes.find((index) => index.name === uid)?.document_count
  }

  beforeAll(async () => {
    service = new MeilisearchSearchService({ logger } as any, {
      host: HOST,
      apiKey: API_KEY,
    })

    await service.upsertIndex({ index: definition })
    const task = await service.upsertDocuments({ index: uid, definition, documents })
    expect(task.status).toBe("enqueued")
    await expect(service.waitForTask(task)).resolves.toMatchObject({ status: "succeeded" })
  }, 60_000)

  afterAll(async () => {
    await service?.deleteIndex({ index: uid })
  }, 60_000)

  it("tolerates a typo: latafa finds Lattafa", async () => {
    expect(await ids({ q: "latafa" })).toEqual(["p1"])
  })

  it("matches a prefix: lat finds Lattafa", async () => {
    expect(await ids({ q: "lat" })).toEqual(["p1"])
  })

  it("applies synonyms: ysl finds Yves Saint Laurent", async () => {
    expect(await ids({ q: "ysl" })).toEqual(["p2"])
  })

  it("returns everything for an empty query", async () => {
    expect(await ids({ q: "" })).toEqual(["p1", "p2", "p3"])
  })

  it("counts facet values", async () => {
    const result = await service.search(query({ q: "", search_options: { facets: ["brand"] } }))
    expect(result.facets?.brand).toEqual({
      type: "value",
      values: expect.arrayContaining([
        { value: "Lattafa", count: 1 },
        { value: "Yves Saint Laurent", count: 1 },
        { value: "Dior", count: 1 },
      ]),
    })
  })

  it("returns stats for a numeric facet", async () => {
    const result = await service.search(
      query({ q: "", search_options: { facets: [{ field: "price", type: "stats" }] } }),
    )
    expect(result.facets?.price).toMatchObject({ type: "stats", min: 30, max: 120 })
  })

  it("filters, and an injected quote in a filter value matches nothing extra", async () => {
    expect(await ids({ q: "", filters: { brand: "Lattafa" } })).toEqual(["p1"])
    expect(await ids({ q: "", filters: { brand: 'Lattafa" OR id != "' } })).toEqual([])
    expect(await ids({ q: "", filters: { brand: "x\\\" OR brand = \"Dior" } })).toEqual([])
  })

  it("rejects a sort on a non-sortable attribute as invalid data", async () => {
    const error = await service
      .search(query({ q: "", pagination: { order: { brand: "ASC" } } }))
      .catch((e) => e)
    expect(error).toBeInstanceOf(MedusaError)
    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toBe(INVALID_SORT)
  })

  it("runs several queries in one request, in order", async () => {
    const results = await service.searchMany([
      query({ q: "dior" }),
      query({ q: "lattafa" }),
      query({ q: "libre" }),
    ])
    expect(results.map((result) => result.hits.map((hit) => hit.id))).toEqual([
      ["p3"],
      ["p1"],
      ["p2"],
    ])
  })

  it("lists the index with its document count", async () => {
    await expect(service.listIndexes()).resolves.toEqual(
      expect.arrayContaining([{ name: uid, provider: "meilisearch", document_count: 3 }]),
    )
  })

  it("deletes by id", async () => {
    const task = await service.deleteDocuments({ index: uid, filters: { id: ["p3"] } })
    await service.waitForTask(task)
    expect(await ids({ q: "dior" })).toEqual([])
    expect(await count()).toBe(2)
  })

  it("deletes by filter", async () => {
    const task = await service.deleteDocuments({ index: uid, filters: { brand: "Lattafa" } })
    await service.waitForTask(task)
    expect(await ids({ q: "" })).toEqual(["p2"])
  })

  it("clears the index without deleting it", async () => {
    const task = await service.clearIndex({ index: uid })
    await service.waitForTask(task)
    expect(await count()).toBe(0)
    expect(await ids({ q: "" })).toEqual([])
  })
})
