import { ShopifyClient } from "../shopify/client.js"
import type { ShopifyConfig } from "../shopify/config.js"
import { WooCommerceClient } from "../woocommerce/client.js"
import type { WooCommerceConfig } from "../woocommerce/config.js"

export type TestResult = { ok: true; detail: string } | { ok: false; message: string }

type TestOpts = { fetchImpl?: typeof fetch; timeoutMs?: number }

const DEFAULT_TIMEOUT_MS = 10_000

class TimeoutError extends Error {}

/**
 * Runs `work` with a fetch that carries an AbortSignal. On timeout the signal
 * is aborted (cancelling the hung request) and the timer is always cleared.
 */
const withTimeout = async <T>(
  fetchImpl: typeof fetch | undefined,
  timeoutMs: number,
  work: (wrapped: typeof fetch) => Promise<T>
): Promise<T> => {
  const controller = new AbortController()
  const base = fetchImpl ?? fetch
  const wrapped = ((url: Parameters<typeof fetch>[0], init?: RequestInit) =>
    base(url, { ...init, signal: controller.signal })) as typeof fetch
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new TimeoutError("timed out"))
    }, timeoutMs)
  })
  const run = work(wrapped)
  run.catch(() => {}) // avoid an unhandled rejection if the timeout wins
  try {
    return await Promise.race([run, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Maps any failure to a short, credential-free message. Only the HTTP status
 * is ever extracted from the underlying error text.
 */
const describeFailure = (err: unknown): string => {
  if (err instanceof TimeoutError) return "connection timed out"
  const text = err instanceof Error ? err.message : ""
  const status = /status (\d{3})/.exec(text)?.[1]
  if (status) {
    const code = Number(status)
    if (code === 401 || code === 403) return "credentials rejected"
    if (code === 404) return "not found (check the store address)"
    return `request failed (${code})`
  }
  if (/still throttled/i.test(text)) return "store is rate limiting requests, try again shortly"
  if (/GraphQL error/i.test(text)) return "request invalid (check access scopes and location ID)"
  return "could not reach the store"
}

const noopSleep = async (): Promise<void> => {}

const toLocationGid = (raw: string | undefined): string | null => {
  const id = (raw ?? "").trim()
  if (/^\d+$/.test(id)) return `gid://shopify/Location/${id}`
  if (/^gid:\/\/shopify\/Location\/\d+$/.test(id)) return id
  return null
}

export const testShopifyConnection = async (
  config: ShopifyConfig,
  opts: TestOpts = {}
): Promise<TestResult> => {
  try {
    const locationGid = toLocationGid(config.locationId)
    if (!locationGid) return { ok: false, message: "location ID is invalid" }
    const data = await withTimeout(
      opts.fetchImpl,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      (fetchImpl) => {
        const client = new ShopifyClient({
          shopDomain: config.shopDomain,
          accessToken: config.accessToken,
          fetchImpl,
          sleep: noopSleep,
        })
        return client.graphql<{
          shop?: { name?: string } | null
          location?: { id?: string } | null
        }>(`query ConnectionTest($id: ID!) { shop { name } location(id: $id) { id } }`, {
          id: locationGid,
        })
      }
    )
    if (!data?.location) return { ok: false, message: "location not found" }
    return { ok: true, detail: `Connected to ${data.shop?.name ?? config.shopDomain}` }
  } catch (err) {
    return { ok: false, message: describeFailure(err) }
  }
}

export const testWooCommerceConnection = async (
  config: WooCommerceConfig,
  opts: TestOpts = {}
): Promise<TestResult> => {
  try {
    const siteUrl = (config.siteUrl ?? "").trim()
    if (!siteUrl.toLowerCase().startsWith("https://")) {
      return { ok: false, message: "site URL must start with https://" }
    }
    await withTimeout(opts.fetchImpl, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, (fetchImpl) => {
      const client = new WooCommerceClient({
        siteUrl,
        consumerKey: config.consumerKey,
        consumerSecret: config.consumerSecret,
        fetchImpl,
        sleep: noopSleep,
      })
      return client.request("GET", "/products", { query: { per_page: 1 } })
    })
    return { ok: true, detail: "Connected to WooCommerce store" }
  } catch (err) {
    return { ok: false, message: describeFailure(err) }
  }
}
