import { MedusaError } from "@medusajs/framework/utils"

import {
  DOCUMENT_BATCH_SIZE,
  INVALID_FACETS,
  INVALID_FILTER,
  INVALID_SORT,
  MeilisearchSearchService,
  SEARCH_INDEX_UNAVAILABLE,
  SEARCH_UNAVAILABLE,
} from "../../../providers/search-meilisearch/services/meilisearch-search"
import { toMeiliQuery } from "../../../providers/search-meilisearch/utils/query"
import { fromMeiliResponse } from "../../../providers/search-meilisearch/utils/result"
import { buildSettings } from "../../../providers/search-meilisearch/utils/settings"
import { SYNONYMS } from "../../../providers/search-meilisearch/utils/synonyms"

// The real client is ESM-only and never loaded here: every test talks to this
// fake through the provider's dynamic import.
const mockConfigs: unknown[] = []
const mockIndex = {
  updateSettings: jest.fn(),
  updateSynonyms: jest.fn(),
  addDocuments: jest.fn(),
  deleteDocuments: jest.fn(),
  deleteAllDocuments: jest.fn(),
  search: jest.fn(),
}
const mockClient = {
  getRawIndex: jest.fn(),
  createIndex: jest.fn(),
  updateIndex: jest.fn(),
  deleteIndex: jest.fn(),
  getStats: jest.fn(),
  multiSearch: jest.fn(),
  index: jest.fn(() => mockIndex),
  tasks: { waitForTask: jest.fn() },
}

jest.mock("meilisearch", () => ({
  Meilisearch: jest.fn((config: unknown) => {
    mockConfigs.push(config)
    return mockClient
  }),
}))

const SECRET = "super-secret-master-key"

function makeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}

function makeService(options: Record<string, unknown> = {}) {
  const logger = makeLogger()
  const service = new MeilisearchSearchService({ logger } as any, {
    host: "http://127.0.0.1:7700",
    apiKey: SECRET,
    ...options,
  })
  return { service, logger }
}

/** The error shape the client throws for a Meilisearch API error response. */
function apiError(code: string, message = `Meilisearch says ${code}`) {
  return Object.assign(new Error(message), {
    name: "MeilisearchApiError",
    cause: { code, message, type: "invalid_request", link: "" },
  })
}

let nextUid = 1
function enqueued() {
  return { taskUid: nextUid++, indexUid: "x", status: "enqueued", type: "x", enqueuedAt: "" }
}

function succeeded(uid: number, type = "documentAdditionOrUpdate") {
  return { uid, type, status: "succeeded", error: null }
}

const definition: any = {
  name: "product",
  physical_name: "product_v1",
  provider: "meilisearch",
  primary_key: "id",
  fields: {
    id: { type: "keyword", filterable: true },
    title: { type: "text", searchable: { weight: 3 }, sortable: true },
    brand: { type: "keyword", array: true, filterable: true, facetable: true },
  },
  settings: { typo_tolerance: { enabled: true } },
}

function query(overrides: Record<string, any> = {}): any {
  return {
    index: definition,
    attributes_to_retrieve: ["id", "title"],
    q: "lattafa",
    ...overrides,
  }
}

const response = {
  hits: [{ id: "prod_1", title: "Lattafa Asad" }],
  estimatedTotalHits: 1,
  processingTimeMs: 2,
  query: "lattafa",
}

beforeEach(() => {
  jest.clearAllMocks()
  mockConfigs.length = 0
  for (const fn of [
    mockClient.createIndex,
    mockClient.updateIndex,
    mockClient.deleteIndex,
    mockIndex.updateSettings,
    mockIndex.updateSynonyms,
    mockIndex.addDocuments,
    mockIndex.deleteDocuments,
    mockIndex.deleteAllDocuments,
  ]) {
    fn.mockImplementation(async () => enqueued())
  }
  mockClient.tasks.waitForTask.mockImplementation(async (uid: number) =>
    succeeded(uid),
  )
  mockClient.getRawIndex.mockResolvedValue({ uid: "product_v1", primaryKey: "id" })
})

describe("MeilisearchSearchService construction", () => {
  it("has the identifier index definitions select it by", () => {
    expect(MeilisearchSearchService.identifier).toBe("meilisearch")
    expect(makeService().service.identifier).toBe("meilisearch")
  })

  it("throws naming MEILISEARCH_API_KEY when the key is missing, without leaking anything", () => {
    const create = () =>
      new MeilisearchSearchService({ logger: makeLogger() } as any, {
        host: "http://127.0.0.1:7700",
      })
    expect(create).toThrow(MedusaError)
    expect(create).toThrow(/MEILISEARCH_API_KEY/)
  })

  it("throws naming MEILISEARCH_HOST when the host is missing, never printing the key", () => {
    let error: Error | undefined
    try {
      new MeilisearchSearchService({ logger: makeLogger() } as any, { apiKey: SECRET })
    } catch (e) {
      error = e as Error
    }
    expect(error).toBeInstanceOf(MedusaError)
    expect(error!.message).toMatch(/MEILISEARCH_HOST/)
    expect(error!.message).not.toContain(SECRET)
  })

  it("creates the client lazily with a 3000 ms request timeout by default", async () => {
    const { service } = makeService()
    expect(mockConfigs).toHaveLength(0)

    mockClient.getStats.mockResolvedValue({ indexes: {} })
    await service.listIndexes()
    await service.listIndexes()

    expect(mockConfigs).toEqual([
      { host: "http://127.0.0.1:7700", apiKey: SECRET, timeout: 3000 },
    ])
  })

  it("passes a configured timeout through", async () => {
    const { service } = makeService({ timeout: 1234 })
    mockClient.getStats.mockResolvedValue({ indexes: {} })
    await service.listIndexes()
    expect(mockConfigs[0]).toMatchObject({ timeout: 1234 })
  })
})

describe("upsertIndex", () => {
  it("creates a missing index with its primary key, applies settings and synonyms, and waits", async () => {
    mockClient.getRawIndex.mockRejectedValue(apiError("index_not_found"))
    const { service } = makeService()

    const task = await service.upsertIndex({ index: definition })

    expect(mockClient.createIndex).toHaveBeenCalledWith("product_v1", { primaryKey: "id" })
    expect(mockClient.index).toHaveBeenCalledWith("product_v1")
    expect(mockIndex.updateSettings).toHaveBeenCalledWith(buildSettings(definition))
    expect(mockIndex.updateSynonyms).toHaveBeenCalledWith(SYNONYMS)
    // create, settings, synonyms
    expect(mockClient.tasks.waitForTask).toHaveBeenCalledTimes(3)
    expect(task).toEqual({ index: "product_v1", status: "succeeded" })
  })

  it("leaves an existing index with the same primary key in place", async () => {
    const { service } = makeService()
    await service.upsertIndex({ index: definition })
    expect(mockClient.createIndex).not.toHaveBeenCalled()
    expect(mockClient.deleteIndex).not.toHaveBeenCalled()
    expect(mockIndex.updateSettings).toHaveBeenCalled()
  })

  it("sets the primary key on an existing index that has none yet", async () => {
    mockClient.getRawIndex.mockResolvedValue({ uid: "product_v1" })
    const { service } = makeService()
    await service.upsertIndex({ index: definition })
    expect(mockClient.updateIndex).toHaveBeenCalledWith("product_v1", { primaryKey: "id" })
    expect(mockClient.createIndex).not.toHaveBeenCalled()
  })

  it("recreates an index whose primary key differs", async () => {
    mockClient.getRawIndex.mockResolvedValue({ uid: "product_v1", primaryKey: "sku" })
    const { service, logger } = makeService()
    await service.upsertIndex({ index: definition })
    expect(mockClient.deleteIndex).toHaveBeenCalledWith("product_v1")
    expect(mockClient.createIndex).toHaveBeenCalledWith("product_v1", { primaryKey: "id" })
    expect(logger.warn).toHaveBeenCalled()
  })

  it("throws when a settings task fails", async () => {
    mockClient.tasks.waitForTask.mockImplementation(async (uid: number) => ({
      uid,
      type: "settingsUpdate",
      status: "failed",
      error: { code: "invalid_settings_filterable_attributes", message: "bad settings" },
    }))
    const { service } = makeService()
    await expect(service.upsertIndex({ index: definition })).rejects.toThrow(/bad settings/)
  })

  it("throws before any request for a definition with no searchable fields", async () => {
    const { service } = makeService()
    const unsearchable = {
      ...definition,
      fields: { id: { type: "keyword", filterable: true } },
    }
    await expect(service.upsertIndex({ index: unsearchable })).rejects.toThrow(MedusaError)
    expect(mockClient.getRawIndex).not.toHaveBeenCalled()
  })
})

describe("deleteIndex and listIndexes", () => {
  it("deletes and waits, treating an index that is already gone as deleted", async () => {
    mockClient.tasks.waitForTask.mockImplementation(async (uid: number) => ({
      uid,
      type: "indexDeletion",
      status: "failed",
      error: { code: "index_not_found", message: "Index `x` not found." },
    }))
    const { service } = makeService()
    await expect(service.deleteIndex({ index: "product_v0" })).resolves.toEqual({
      index: "product_v0",
      status: "succeeded",
    })
    expect(mockClient.deleteIndex).toHaveBeenCalledWith("product_v0")
  })

  it("lists every index with its document count from the stats", async () => {
    mockClient.getStats.mockResolvedValue({
      indexes: {
        product_v1: { numberOfDocuments: 42 },
        product_v2: { numberOfDocuments: 0 },
      },
    })
    const { service } = makeService()
    await expect(service.listIndexes()).resolves.toEqual([
      { name: "product_v1", provider: "meilisearch", document_count: 42 },
      { name: "product_v2", provider: "meilisearch", document_count: 0 },
    ])
  })
})

describe("upsertDocuments", () => {
  const docs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `prod_${i}`, title: `P${i}` }))

  it("writes to the given physical index and returns an enqueued task with an id", async () => {
    const { service } = makeService()
    const task = await service.upsertDocuments({
      index: "product_v2",
      definition,
      documents: docs(3),
    })

    expect(mockClient.index).toHaveBeenCalledWith("product_v2")
    expect(mockIndex.addDocuments).toHaveBeenCalledWith(docs(3), { primaryKey: "id" })
    expect(task.status).toBe("enqueued")
    expect(task.index).toBe("product_v2")
    expect(task.id).toMatch(/^\d+$/)
  })

  it("chunks large writes and lists every batch's task in the id", async () => {
    const { service } = makeService()
    const task = await service.upsertDocuments({
      index: "product_v1",
      definition,
      documents: docs(DOCUMENT_BATCH_SIZE * 2 + 1),
    })

    expect(mockIndex.addDocuments).toHaveBeenCalledTimes(3)
    expect(mockIndex.addDocuments.mock.calls[2][0]).toHaveLength(1)
    expect(task.id!.split(",")).toHaveLength(3)
  })

  it("does nothing for an empty batch", async () => {
    const { service } = makeService()
    await expect(
      service.upsertDocuments({ index: "product_v1", definition, documents: [] }),
    ).resolves.toEqual({ index: "product_v1", status: "succeeded" })
    expect(mockIndex.addDocuments).not.toHaveBeenCalled()
  })

  it("sets up a missing index from the definition before writing to it", async () => {
    mockClient.getRawIndex.mockRejectedValueOnce(apiError("index_not_found"))
    mockClient.getRawIndex.mockRejectedValueOnce(apiError("index_not_found"))
    const { service } = makeService()

    await service.upsertDocuments({ index: "product_v3", definition, documents: docs(1) })

    expect(mockClient.createIndex).toHaveBeenCalledWith("product_v3", { primaryKey: "id" })
    expect(mockIndex.updateSettings).toHaveBeenCalledWith(
      buildSettings({ ...definition, physical_name: "product_v3" }),
    )
    expect(mockIndex.addDocuments).toHaveBeenCalled()
  })
})

describe("waitForTask", () => {
  it("waits for every uid in the id and reports success", async () => {
    const { service } = makeService()
    await expect(
      service.waitForTask({ id: "7,8", index: "product_v1", status: "enqueued" }),
    ).resolves.toEqual({ id: "7,8", index: "product_v1", status: "succeeded" })
    expect(mockClient.tasks.waitForTask.mock.calls.map((call) => call[0])).toEqual([7, 8])
  })

  it("throws on a failed task with the engine message, never the key", async () => {
    mockClient.tasks.waitForTask.mockImplementation(async (uid: number) => ({
      uid,
      type: "documentAdditionOrUpdate",
      status: "failed",
      error: {
        code: "invalid_document_id",
        message: `Document identifier "a b" is invalid. ${SECRET}`,
      },
    }))
    const { service } = makeService()

    const error = await service
      .waitForTask({ id: "9", index: "product_v1", status: "enqueued" })
      .catch((e) => e)

    expect(error).toBeInstanceOf(MedusaError)
    expect(error.message).toMatch(/Document identifier/)
    expect(error.message).toMatch(/invalid_document_id/)
    expect(error.message).not.toContain(SECRET)
  })

  it("treats a deletion from an index that is gone as done", async () => {
    mockClient.tasks.waitForTask.mockImplementation(async (uid: number) => ({
      uid,
      type: "documentDeletion",
      status: "failed",
      error: { code: "index_not_found", message: "Index not found." },
    }))
    const { service } = makeService()
    await expect(
      service.waitForTask({ id: "3", index: "gone", status: "enqueued" }),
    ).resolves.toMatchObject({ status: "succeeded" })
  })

  it("returns a task without an id unchanged", async () => {
    const { service } = makeService()
    const task = { index: "x", status: "succeeded" as const }
    await expect(service.waitForTask(task)).resolves.toBe(task)
    expect(mockClient.tasks.waitForTask).not.toHaveBeenCalled()
  })
})

describe("deleteDocuments and clearIndex", () => {
  it("deletes by ids for a plain id list or a single id", async () => {
    const { service } = makeService()
    await service.deleteDocuments({ index: "product_v1", filters: { id: ["a", "b"] } })
    await service.deleteDocuments({ index: "product_v1", filters: { id: "c" } })
    expect(mockIndex.deleteDocuments.mock.calls).toEqual([[["a", "b"]], [["c"]]])
  })

  it("deletes by the translated filter otherwise", async () => {
    const { service } = makeService()
    const task = await service.deleteDocuments({
      index: "product_v1",
      filters: { brand: 'x" OR id != "' },
    })
    expect(mockIndex.deleteDocuments).toHaveBeenCalledWith({
      filter: 'brand = "x\\" OR id != \\""',
    })
    expect(task.status).toBe("enqueued")
  })

  it("refuses a filter that would delete everything", async () => {
    const { service } = makeService()
    await expect(
      service.deleteDocuments({ index: "product_v1", filters: {} }),
    ).rejects.toThrow(MedusaError)
    await expect(
      service.deleteDocuments({ index: "product_v1", filters: { brand: undefined } }),
    ).rejects.toThrow(MedusaError)
    expect(mockIndex.deleteDocuments).not.toHaveBeenCalled()
  })

  it("does nothing for an empty id list", async () => {
    const { service } = makeService()
    await expect(
      service.deleteDocuments({ index: "product_v1", filters: { id: [] } }),
    ).resolves.toMatchObject({ status: "succeeded" })
    expect(mockIndex.deleteDocuments).not.toHaveBeenCalled()
  })

  it("clears through deleteAllDocuments", async () => {
    const { service } = makeService()
    const task = await service.clearIndex({ index: "product_v1" })
    expect(mockIndex.deleteAllDocuments).toHaveBeenCalled()
    expect(task).toMatchObject({ index: "product_v1", status: "enqueued" })
  })
})

describe("search", () => {
  it("sends the toMeiliQuery translation and returns the fromMeiliResponse result", async () => {
    mockIndex.search.mockResolvedValue(response)
    const { service } = makeService()
    const input = query({ filters: { brand: "Lattafa" } })

    const result = await service.search(input)

    const { indexUid, params } = toMeiliQuery(input)
    const { q, ...options } = params
    expect(mockClient.index).toHaveBeenCalledWith(indexUid)
    expect(mockIndex.search).toHaveBeenCalledWith(q, options)
    expect(result).toEqual(fromMeiliResponse(response, input))
  })

  it("lets translation errors through as they are", async () => {
    const { service } = makeService()
    await expect(
      service.search(query({ pagination: { cursor: "abc" } })),
    ).rejects.toThrow(/cursor/)
    expect(mockIndex.search).not.toHaveBeenCalled()
  })

  it("turns a client error into fixed text and only logs the original", async () => {
    mockIndex.search.mockRejectedValue(
      Object.assign(new Error(`request to http://127.0.0.1:7700 failed ${SECRET}`), {
        name: "MeilisearchRequestError",
      }),
    )
    const { service, logger } = makeService()

    const error = await service.search(query()).catch((e) => e)

    expect(error).toBeInstanceOf(MedusaError)
    expect(error.type).toBe(MedusaError.Types.UNEXPECTED_STATE)
    expect(error.message).toBe(SEARCH_UNAVAILABLE)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toMatch(/request to http:\/\/127\.0\.0\.1:7700 failed/)
    expect(logger.error.mock.calls[0][0]).not.toContain(SECRET)
  })

  it("turns a request timeout into the same fixed text", async () => {
    mockIndex.search.mockRejectedValue(
      Object.assign(new Error("request timed out after 3000ms"), {
        name: "MeilisearchRequestTimeOutError",
      }),
    )
    const { service, logger } = makeService()

    const error = await service.search(query()).catch((e) => e)

    expect(error).toBeInstanceOf(MedusaError)
    expect(error.message).toBe(SEARCH_UNAVAILABLE)
    expect(logger.error.mock.calls[0][0]).toMatch(/3000ms/)
  })

  it.each([
    ["invalid_search_sort", INVALID_SORT],
    ["invalid_search_filter", INVALID_FILTER],
    ["invalid_search_facets", INVALID_FACETS],
  ])("maps %s to INVALID_DATA with fixed text", async (code, text) => {
    mockIndex.search.mockRejectedValue(apiError(code, "Attribute `x` is not sortable."))
    const { service, logger } = makeService()

    const error = await service.search(query()).catch((e) => e)

    expect(error).toBeInstanceOf(MedusaError)
    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toBe(text)
    expect(error.message).not.toMatch(/Attribute/)
    expect(logger.warn.mock.calls[0][0]).toMatch(/Attribute `x` is not sortable/)
  })

  it("maps a missing index to NOT_FOUND so the module retries on a fresh version", async () => {
    mockIndex.search.mockRejectedValue(apiError("index_not_found"))
    const { service } = makeService()
    const error = await service.search(query()).catch((e) => e)
    expect(error.type).toBe(MedusaError.Types.NOT_FOUND)
    expect(error.message).toBe(SEARCH_INDEX_UNAVAILABLE)
  })
})

describe("searchMany", () => {
  it("issues one multi-search request and keeps the input order", async () => {
    const inputs = [query({ q: "first" }), query({ q: "second" }), query({ q: "third" })]
    const results = inputs.map((input, i) => ({
      ...response,
      indexUid: "product_v1",
      query: input.q,
      hits: [{ id: `prod_${i}`, title: input.q }],
    }))
    mockClient.multiSearch.mockResolvedValue({ results })
    const { service } = makeService()

    const out = await service.searchMany(inputs)

    expect(mockClient.multiSearch).toHaveBeenCalledTimes(1)
    expect(mockClient.multiSearch.mock.calls[0][0]).toEqual({
      queries: inputs.map((input) => {
        const { indexUid, params } = toMeiliQuery(input)
        return { indexUid, ...params }
      }),
    })
    expect(mockIndex.search).not.toHaveBeenCalled()
    expect(out.map((result) => result.hits[0].id)).toEqual(["prod_0", "prod_1", "prod_2"])
    expect(out[1]).toEqual(fromMeiliResponse(results[1], inputs[1]))
  })

  it("returns nothing without a request for no queries", async () => {
    const { service } = makeService()
    await expect(service.searchMany([])).resolves.toEqual([])
    expect(mockClient.multiSearch).not.toHaveBeenCalled()
  })

  it("wraps client errors like search", async () => {
    mockClient.multiSearch.mockRejectedValue(apiError("invalid_search_filter"))
    const { service } = makeService()
    const error = await service.searchMany([query()]).catch((e) => e)
    expect(error.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(error.message).toBe(INVALID_FILTER)
  })

  it("fails closed when the engine answers fewer queries than asked", async () => {
    mockClient.multiSearch.mockResolvedValue({ results: [response] })
    const { service } = makeService()
    const error = await service.searchMany([query(), query()]).catch((e) => e)
    expect(error.message).toBe(SEARCH_UNAVAILABLE)
  })
})
