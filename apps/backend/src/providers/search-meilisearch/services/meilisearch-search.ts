import type { Logger, SearchTypes } from "@medusajs/framework/types"
import {
  AbstractSearchProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import type {
  EnqueuedTask,
  Meilisearch,
  MultiSearchQuery,
  Task,
} from "meilisearch" with { "resolution-mode": "import" }

import { toMeiliFilter } from "../utils/filters"
import { toMeiliQuery } from "../utils/query"
import { fromMeiliResponse, MeiliResponse } from "../utils/result"
import { buildSettings } from "../utils/settings"
import { SYNONYMS } from "../utils/synonyms"

type InjectedDependencies = {
  logger: Logger
}

export type MeilisearchProviderOptions = {
  /** Meilisearch base URL, from MEILISEARCH_HOST. */
  host?: string
  /** Meilisearch API key (master key in dev), from MEILISEARCH_API_KEY. */
  apiKey?: string
  /** Per-request HTTP timeout in milliseconds. */
  timeout?: number
}

export const DEFAULT_TIMEOUT_MS = 3000
/** Documents per Meilisearch write request. */
export const DOCUMENT_BATCH_SIZE = 1000
/** How long a write may take to apply before waiting gives up. */
export const DEFAULT_TASK_TIMEOUT_MS = 60_000
const TASK_POLL_INTERVAL_MS = 100
const MAX_LOGGED_MESSAGE = 500

export const SEARCH_UNAVAILABLE = "Search is temporarily unavailable."
export const SEARCH_INDEX_UNAVAILABLE = "The search index is not available."
export const INVALID_SORT = "The requested sort is not available for this search."
export const INVALID_FILTER =
  "The requested filter is not available for this search."
export const INVALID_FACETS =
  "The requested facets are not available for this search."
export const INVALID_SEARCH = "The search request is not valid for this index."

/** The parts of a Meilisearch client error this provider reads. */
type ClientError = {
  name?: string
  message?: string
  cause?: { code?: string; message?: string }
}

function errorCode(error: unknown): string | undefined {
  const code = (error as ClientError)?.cause?.code
  return typeof code === "string" ? code : undefined
}

/**
 * Status of a Meilisearch task in the contract's terms. `canceled` is a
 * write that did not go through, so it reports as `failed`.
 */
function toStatus(status: string): SearchTypes.SearchTaskStatus {
  switch (status) {
    case "enqueued":
    case "processing":
    case "succeeded":
      return status
    default:
      return "failed"
  }
}

/**
 * Meilisearch search provider. Writes are asynchronous in Meilisearch, so the
 * write methods return `enqueued` tasks and `waitForTask` is implemented;
 * `upsertIndex` and `deleteIndex` wait themselves, since index setup must have
 * landed before anything is written to it.
 *
 * The `meilisearch` client is ESM-only and this backend compiles to CommonJS,
 * so the client is loaded with a dynamic import on first use; the constructor
 * only validates the options.
 */
export class MeilisearchSearchService extends AbstractSearchProviderService {
  static identifier = "meilisearch"

  protected readonly logger_: Logger
  protected readonly host_: string
  protected readonly apiKey_: string
  protected readonly timeout_: number
  protected client_?: Promise<Meilisearch>

  constructor(
    { logger }: InjectedDependencies,
    options: MeilisearchProviderOptions = {},
  ) {
    super()

    if (!options.host) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "The Meilisearch search provider needs a host: set MEILISEARCH_HOST.",
      )
    }

    if (!options.apiKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "The Meilisearch search provider needs an API key: set MEILISEARCH_API_KEY.",
      )
    }

    this.logger_ = logger
    this.host_ = options.host
    this.apiKey_ = options.apiKey
    this.timeout_ = options.timeout ?? DEFAULT_TIMEOUT_MS
  }

  protected async client(): Promise<Meilisearch> {
    if (!this.client_) {
      this.client_ = import("meilisearch").then(
        ({ Meilisearch: Client }) =>
          new Client({
            host: this.host_,
            apiKey: this.apiKey_,
            timeout: this.timeout_,
          }),
      )
      // A failed load is retried on the next call rather than cached.
      this.client_.catch(() => {
        this.client_ = undefined
      })
    }

    return await this.client_
  }

  /**
   * An error message fit for logs and admin-facing errors: whitespace
   * collapsed, capped in length, and never carrying the API key.
   */
  protected sanitize(message: unknown): string {
    const text = String(message ?? "unknown error")
      .split(this.apiKey_)
      .join("[redacted]")
      .replace(/\s+/g, " ")
      .trim()

    return text.length > MAX_LOGGED_MESSAGE
      ? `${text.slice(0, MAX_LOGGED_MESSAGE)}...`
      : text
  }

  /** Wraps a failed write or admin call; the engine message is kept, sanitized. */
  protected writeError(action: string, index: string, error: unknown): never {
    if (error instanceof MedusaError) {
      throw error
    }

    const message = this.sanitize((error as ClientError)?.message)

    if (errorCode(error) === "index_not_found") {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Meilisearch has no index "${index}" (${action}).`,
      )
    }

    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Meilisearch could not ${action} on index "${index}": ${message}`,
    )
  }

  /**
   * Turns a client error from a read into a MedusaError with fixed text. The
   * engine message only reaches the log. Requests Meilisearch rejected as
   * invalid (a non-sortable or non-filterable attribute, say) are the
   * caller's fault and map to INVALID_DATA (400); a missing index maps to
   * NOT_FOUND so the Search Module re-resolves the active version and retries;
   * everything else (unreachable, timed out, 5xx) is UNEXPECTED_STATE (500).
   */
  protected searchError(error: unknown): MedusaError {
    if (error instanceof MedusaError) {
      return error
    }

    const code = errorCode(error)
    // A request error wraps the real reason (a timeout, a refused connection)
    // as its cause. Only the cause's name and message are logged: the
    // timeout error's own cause holds the request init, headers included.
    const cause = (error as { cause?: unknown })?.cause
    const reason =
      cause instanceof Error
        ? ` (cause: ${cause.name}: ${this.sanitize(cause.message)})`
        : ""
    const detail = `${(error as ClientError)?.name ?? "Error"}${
      code ? ` (${code})` : ""
    }: ${this.sanitize((error as ClientError)?.message)}${reason}`

    if (code?.startsWith("invalid_search_")) {
      this.logger_.warn(`[Search] Meilisearch rejected a search: ${detail}`)

      const text =
        code === "invalid_search_sort"
          ? INVALID_SORT
          : code === "invalid_search_filter"
            ? INVALID_FILTER
            : code === "invalid_search_facets"
              ? INVALID_FACETS
              : INVALID_SEARCH

      return new MedusaError(MedusaError.Types.INVALID_DATA, text)
    }

    if (code === "index_not_found") {
      this.logger_.warn(`[Search] Meilisearch search failed: ${detail}`)
      return new MedusaError(
        MedusaError.Types.NOT_FOUND,
        SEARCH_INDEX_UNAVAILABLE,
      )
    }

    this.logger_.error(`[Search] Meilisearch search failed: ${detail}`)
    return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, SEARCH_UNAVAILABLE)
  }

  protected toTask(
    enqueued: EnqueuedTask[],
    index: string,
  ): SearchTypes.SearchTask {
    return {
      id: enqueued.map((task) => task.taskUid).join(","),
      index,
      status: "enqueued",
    }
  }

  /** Waits for one task and throws unless it succeeded. */
  protected async settle(
    client: Meilisearch,
    enqueued: EnqueuedTask,
    index: string,
    timeout = DEFAULT_TASK_TIMEOUT_MS,
  ): Promise<Task> {
    const task = await client.tasks.waitForTask(enqueued.taskUid, {
      timeout,
      interval: TASK_POLL_INTERVAL_MS,
    })

    if (task.status !== "succeeded") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Meilisearch task ${task.uid} (${task.type}) on index "${index}" ${
          task.status
        }: ${this.sanitize(task.error?.message ?? task.status)}${
          task.error?.code ? ` (${task.error.code})` : ""
        }`,
      )
    }

    return task
  }

  /**
   * Creates the index with its primary key if absent, then applies the
   * settings and synonyms and waits for all of it to land.
   *
   * An existing index with a different primary key is deleted and recreated:
   * Meilisearch only lets a primary key change while the index is empty, and
   * the module only calls this on an index it is about to seed. An existing
   * index with no primary key yet (never written to) is updated in place.
   */
  async upsertIndex({
    index,
  }: {
    index: SearchTypes.ResolvedSearchIndexDefinition
  }): Promise<SearchTypes.SearchTask> {
    // Throws for a definition Meilisearch cannot hold, before any request.
    const settings = buildSettings(index)
    const uid = index.physical_name
    const primaryKey = index.primary_key

    try {
      const client = await this.client()
      const existing = await client.getRawIndex(uid).catch((error) => {
        if (errorCode(error) === "index_not_found") {
          return null
        }
        throw error
      })

      if (existing && existing.primaryKey && existing.primaryKey !== primaryKey) {
        this.logger_.warn(
          `[Search] Recreating Meilisearch index "${uid}": its primary key is "${existing.primaryKey}", the definition's is "${primaryKey}".`,
        )
        await this.settle(client, await client.deleteIndex(uid), uid)
      }

      if (!existing || (existing.primaryKey && existing.primaryKey !== primaryKey)) {
        await this.settle(client, await client.createIndex(uid, { primaryKey }), uid)
      } else if (!existing.primaryKey) {
        await this.settle(client, await client.updateIndex(uid, { primaryKey }), uid)
      }

      const target = client.index(uid)
      await this.settle(client, await target.updateSettings(settings), uid)
      await this.settle(client, await target.updateSynonyms(SYNONYMS), uid)
    } catch (error) {
      this.writeError("set up the index", uid, error)
    }

    return { index: uid, status: "succeeded" }
  }

  /** Deletes the index and waits; an index that is already gone is fine. */
  async deleteIndex({
    index,
  }: {
    index: string
  }): Promise<SearchTypes.SearchTask> {
    try {
      const client = await this.client()
      const enqueued = await client.deleteIndex(index)
      const task = await client.tasks.waitForTask(enqueued.taskUid, {
        timeout: DEFAULT_TASK_TIMEOUT_MS,
        interval: TASK_POLL_INTERVAL_MS,
      })

      if (task.status !== "succeeded" && task.error?.code !== "index_not_found") {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Meilisearch could not delete index "${index}": ${this.sanitize(
            task.error?.message ?? task.status,
          )}`,
        )
      }
    } catch (error) {
      this.writeError("delete the index", index, error)
    }

    return { index, status: "succeeded" }
  }

  /** Every index on the server, with document counts from one stats call. */
  async listIndexes(): Promise<SearchTypes.SearchIndexInfo[]> {
    try {
      const client = await this.client()
      const stats = await client.getStats()

      return Object.entries(stats.indexes).map(([uid, info]) => ({
        name: uid,
        provider: MeilisearchSearchService.identifier,
        document_count: info.numberOfDocuments,
      }))
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Meilisearch could not list indexes: ${this.sanitize(
          (error as ClientError)?.message,
        )}`,
      )
    }
  }

  /**
   * Writes to `index` in batches of 1000 documents. The returned task's id
   * lists every batch's task uid ("12,13,14"), so `waitForTask` confirms all
   * of them, not just the last.
   *
   * Meilisearch creates a missing index on the first write, without settings
   * (every attribute searchable, nothing filterable). To never serve such an
   * index, a missing physical index is set up from `definition` first: this
   * happens when the engine lost its data and the module reseeds in place.
   */
  async upsertDocuments({
    index,
    definition,
    documents,
  }: {
    index: string
    definition: SearchTypes.ResolvedSearchIndexDefinition
    documents: SearchTypes.SearchDocument[]
  }): Promise<SearchTypes.SearchTask> {
    if (!documents.length) {
      return { index, status: "succeeded" }
    }

    let client: Meilisearch
    let exists: boolean

    try {
      client = await this.client()
      exists = await client.getRawIndex(index).then(
        () => true,
        (error) => {
          if (errorCode(error) === "index_not_found") {
            return false
          }
          throw error
        },
      )
    } catch (error) {
      this.writeError("write documents", index, error)
    }

    if (!exists) {
      this.logger_.warn(
        `[Search] Meilisearch index "${index}" is missing; recreating it before writing.`,
      )
      await this.upsertIndex({ index: { ...definition, physical_name: index } })
    }

    try {
      const target = client.index(index)
      const enqueued: EnqueuedTask[] = []

      for (let start = 0; start < documents.length; start += DOCUMENT_BATCH_SIZE) {
        enqueued.push(
          await target.addDocuments(
            documents.slice(start, start + DOCUMENT_BATCH_SIZE),
            { primaryKey: definition.primary_key },
          ),
        )
      }

      return this.toTask(enqueued, index)
    } catch (error) {
      this.writeError("write documents", index, error)
    }
  }

  /**
   * Deletes by ids when the filter is exactly `{ id: [...] }` or `{ id: "x" }`,
   * otherwise by the translated filter (which Meilisearch only accepts on
   * filterable attributes). A filter that translates to nothing would delete
   * every document, so it is refused: `clearIndex` is the way to empty an
   * index.
   */
  async deleteDocuments({
    index,
    filters,
  }: SearchTypes.SearchDeleteDocumentsInput): Promise<SearchTypes.SearchTask> {
    const keys = Object.keys(filters ?? {})
    const ids = keys.length === 1 && keys[0] === "id" ? filters.id : undefined
    const byIds = Array.isArray(ids)
      ? ids.every((id) => typeof id === "string" || typeof id === "number")
      : typeof ids === "string"

    let filter: string | undefined
    if (!byIds) {
      filter = toMeiliFilter(filters)
      if (filter === undefined) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Refusing to delete documents from "${index}" without a filter; use clearIndex to empty an index.`,
        )
      }
    }

    const idList = byIds ? (Array.isArray(ids) ? ids : [ids]).map(String) : []
    if (byIds && !idList.length) {
      return { index, status: "succeeded" }
    }

    try {
      const client = await this.client()
      const target = client.index(index)
      const enqueued = byIds
        ? await target.deleteDocuments(idList)
        : await target.deleteDocuments({ filter: filter! })

      return this.toTask([enqueued], index)
    } catch (error) {
      this.writeError("delete documents", index, error)
    }
  }

  async clearIndex({ index }: { index: string }): Promise<SearchTypes.SearchTask> {
    try {
      const client = await this.client()
      return this.toTask([await client.index(index).deleteAllDocuments()], index)
    } catch (error) {
      this.writeError("clear the index", index, error)
    }
  }

  async search(
    input: SearchTypes.ProviderSearchQuery,
  ): Promise<SearchTypes.SearchResult> {
    // Translation errors are already MedusaErrors about the request.
    const { indexUid, params } = toMeiliQuery(input)
    const { q, ...options } = params

    let response: MeiliResponse
    try {
      const client = await this.client()
      response = (await client.index(indexUid).search(q, options)) as MeiliResponse
    } catch (error) {
      throw this.searchError(error)
    }

    return fromMeiliResponse(response, input)
  }

  /** All queries in one multi-search request; results keep the input order. */
  async searchMany(
    inputs: SearchTypes.ProviderSearchQuery[],
  ): Promise<SearchTypes.SearchResult[]> {
    if (!inputs.length) {
      return []
    }

    const queries: MultiSearchQuery[] = inputs.map((input) => {
      const { indexUid, params } = toMeiliQuery(input)
      return { indexUid, ...params }
    })

    let results: MeiliResponse[]
    try {
      const client = await this.client()
      const response = await client.multiSearch({ queries })
      results = response.results as MeiliResponse[]
    } catch (error) {
      throw this.searchError(error)
    }

    if (results.length !== inputs.length) {
      this.logger_.error(
        `[Search] Meilisearch answered ${results.length} of ${inputs.length} queries.`,
      )
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, SEARCH_UNAVAILABLE)
    }

    return results.map((result, i) => fromMeiliResponse(result, inputs[i]))
  }

  /**
   * Waits for every task uid in `task.id` and returns the task as
   * `succeeded`; throws a MedusaError with the sanitized engine message if any
   * of them failed or was canceled. A deletion that failed only because the
   * index is gone counts as done: there was nothing to delete.
   */
  async waitForTask(
    task: SearchTypes.SearchTask,
    options?: { timeout_ms?: number },
  ): Promise<SearchTypes.SearchTask> {
    if (!task.id || task.status === "succeeded" || task.status === "failed") {
      return task
    }

    const uids = task.id.split(",").map((uid) => Number(uid))
    if (uids.some((uid) => !Number.isInteger(uid))) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `"${task.id}" is not a Meilisearch task id.`,
      )
    }

    const timeout = options?.timeout_ms ?? DEFAULT_TASK_TIMEOUT_MS
    const index = task.index ?? "?"

    let finished: Task[]
    try {
      const client = await this.client()
      finished = []
      for (const uid of uids) {
        finished.push(
          await client.tasks.waitForTask(uid, {
            timeout,
            interval: TASK_POLL_INTERVAL_MS,
          }),
        )
      }
    } catch (error) {
      this.writeError("wait for its write", index, error)
    }

    for (const result of finished) {
      const status = toStatus(result.status)
      const gone =
        result.error?.code === "index_not_found" &&
        (result.type === "documentDeletion" || result.type === "indexDeletion")

      if (status !== "succeeded" && !gone) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Meilisearch task ${result.uid} on index "${index}" ${
            result.status
          }: ${this.sanitize(result.error?.message ?? result.status)}${
            result.error?.code ? ` (${result.error.code})` : ""
          }`,
        )
      }
    }

    return { ...task, status: "succeeded" }
  }
}

export default MeilisearchSearchService
