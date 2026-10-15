export type DraftOrderLineItemInput = {
  variant_id: string
  quantity: number
  unit_price?: number
}

export type CreateDraftOrderInput = {
  sales_channel_id: string
  email: string
  items: DraftOrderLineItemInput[]
  shipping_address: Record<string, unknown>
  metadata: Record<string, unknown>
}

export type MedusaAdminClientConfig = {
  baseUrl: string
  email: string
  password: string
  /** Defaults to global fetch; tests inject a fake. */
  fetchImpl?: typeof fetch
}

export type VariantPricing = {
  amount: number
  currencyCode: string
}

export type VariantInventory = {
  quantity: number
}

type InventoryItemWithLevelsAndVariants = {
  id: string
  location_levels?: { id: string }[]
  variants?: { id: string }[]
}

// Caps `findVariantIdByInventoryLevelId`'s page scan (see its doc comment) so
// an inventory_level id that matches nothing can't page through the whole
// catalog forever. 10 pages of 200 covers 2,000 inventory items, comfortably
// above this single-tenant service's expected catalog size.
const INVENTORY_ITEM_PAGE_SIZE = 200
const MAX_INVENTORY_ITEM_PAGES = 10

/**
 * Thin HTTP wrapper around Medusa's Admin API, scoped to exactly what
 * seller-hub needs: logging in as the dedicated admin user, and
 * creating/converting/looking-up orders synced in from Amazon.
 */
export class MedusaAdminClient {
  private readonly config: MedusaAdminClientConfig
  private readonly fetchImpl: typeof fetch
  private token: string | null = null

  constructor(config: MedusaAdminClientConfig) {
    this.config = config
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  /**
   * POSTs to `/auth/user/emailpass` and caches the returned bearer token for
   * use by subsequent authenticated requests.
   */
  async login(): Promise<void> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl}/auth/user/emailpass`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.config.email,
          password: this.config.password,
        }),
      }
    )

    if (!response.ok) {
      const body = await readBodySafely(response)
      throw new Error(
        `Medusa admin login failed with status ${response.status}: ${body}`
      )
    }

    const data = (await response.json()) as { token: string }
    this.token = data.token
  }

  async createDraftOrder(
    input: CreateDraftOrderInput
  ): Promise<{ id: string }> {
    const regionId = await this.resolveRegionId(input.shipping_address)
    const response = await this.authedFetch("/admin/draft-orders", {
      method: "POST",
      body: JSON.stringify({ ...input, region_id: regionId }),
    })
    const body = (await response.json()) as { draft_order: { id: string } }
    return { id: body.draft_order.id }
  }

  /**
   * `POST /admin/draft-orders` requires a `region_id` (see
   * `CreateDraftOrder` in Medusa core's draft-order validators — it's a
   * required `z.string()`, not optional), even though this class's public
   * `createDraftOrder` input (per this task's interface) doesn't take one.
   * Resolved here instead of surfacing it as a caller-supplied param: looks
   * up the region whose country list contains the shipping address's
   * `country_code`, falling back to the first region if none matches or no
   * country code is given.
   */
  private async resolveRegionId(
    shippingAddress: Record<string, unknown>
  ): Promise<string> {
    const countryCode =
      typeof shippingAddress.country_code === "string"
        ? shippingAddress.country_code.toLowerCase()
        : undefined

    const response = await this.authedFetch(
      "/admin/regions?limit=100&fields=id,*countries.iso_2"
    )
    const body = (await response.json()) as {
      regions: { id: string; countries?: { iso_2: string }[] }[]
    }

    const match = countryCode
      ? body.regions.find((region) =>
          region.countries?.some((country) => country.iso_2 === countryCode)
        )
      : undefined

    const region = match ?? body.regions[0]
    if (!region) {
      throw new Error(
        "No Medusa region found to create a draft order against."
      )
    }
    if (!match) {
      // Region selection feeds the order's currency_code server-side, so a
      // silent fallback here could miscategorize a real order into the
      // wrong region/currency. Make it loud instead of indistinguishable
      // from the correct-match path.
      console.warn(
        `[MedusaAdminClient] No region found covering shipping country ` +
          `"${countryCode ?? "<none given>"}" — falling back to region ` +
          `${region.id} (first available). Order may be placed in the ` +
          `wrong region/currency.`
      )
    }
    return region.id
  }

  async convertDraftOrderToOrder(
    draftOrderId: string
  ): Promise<{ id: string }> {
    const response = await this.authedFetch(
      `/admin/draft-orders/${draftOrderId}/convert-to-order`,
      { method: "POST" }
    )
    const body = (await response.json()) as { order: { id: string } }
    return { id: body.order.id }
  }

  /**
   * `/admin/orders` doesn't support filtering by `metadata[...]` query
   * params (see `AdminGetOrdersParamsBase` in Medusa core, which doesn't
   * allowlist a `metadata` field) — so this fetches a bounded page of
   * orders and filters client-side. Fine for seller-hub's single-tenant,
   * modest order volume. Sorted by `-created_at` so that, once order
   * volume exceeds the `limit`, the most recently created orders (the
   * ones most likely to be the target of a just-synced-in lookup) are
   * the ones guaranteed to land on this first page, instead of depending
   * on the DB's unspecified default order.
   */
  async findOrderByMetadata(
    key: string,
    value: string
  ): Promise<{ id: string } | null> {
    const response = await this.authedFetch(
      "/admin/orders?limit=100&order=-created_at&fields=id,metadata"
    )
    const body = (await response.json()) as {
      orders: { id: string; metadata?: Record<string, unknown> | null }[]
    }
    const match = body.orders.find((order) => order.metadata?.[key] === value)
    return match ? { id: match.id } : null
  }

  /**
   * Reads a variant's current price via Medusa's Admin API, in the store's
   * default currency.
   *
   * Uses `GET /admin/product-variants?id[]={id}&fields=id,*prices` — the
   * top-level `/admin/product-variants` list route (not the nested
   * `/admin/products/:id/variants/:variant_id`, which needs a `product_id`
   * we don't have on hand here). Confirmed against the real running backend
   * (not assumed): `fields=id,*prices` returns each variant's full `prices`
   * array, one entry per currency the store supports
   * (`{ amount, currency_code, ... }`), not a single "the" price — a variant
   * can simultaneously have e.g. a `eur` price and a `usd` price. Since
   * "current price" is otherwise ambiguous, this picks the price in the
   * store's configured default currency (falling back to the first price
   * present if that currency has none), rather than an arbitrary array
   * index.
   */
  async getVariantPricing(variantId: string): Promise<VariantPricing> {
    const currencyCode = await this.resolveDefaultCurrencyCode()

    const response = await this.authedFetch(
      `/admin/product-variants?id[]=${encodeURIComponent(variantId)}&fields=id,*prices`
    )
    const body = (await response.json()) as {
      variants: {
        id: string
        prices?: { amount: number; currency_code: string }[]
      }[]
    }

    const variant = body.variants[0]
    if (!variant) {
      throw new Error(`Variant with id: ${variantId} was not found`)
    }

    const price =
      variant.prices?.find((p) => p.currency_code === currencyCode) ??
      variant.prices?.[0]
    if (!price) {
      throw new Error(`Variant with id: ${variantId} has no price set`)
    }

    return { amount: price.amount, currencyCode: price.currency_code }
  }

  /**
   * Reads a variant's current available stock via Medusa's Admin API.
   *
   * Uses the same `/admin/product-variants` route as `getVariantPricing`,
   * requesting the computed `inventory_quantity` field. Confirmed against
   * the real running backend and against this version's source
   * (`packages/medusa/src/api/utils/middlewares/products/variant-inventory-quantity.ts`
   * in the Medusa core checkout): requesting `fields=...,inventory_quantity`
   * triggers `wrapVariantsWithTotalInventoryQuantity`, which resolves the
   * variant's total availability across all of its linked inventory items
   * server-side — this one query config to a dedicated
   * `/admin/inventory-items` lookup (the other approach the brief
   * sketched), and it already matches the "current stock" the admin
   * dashboard displays for a variant.
   *
   * A variant with `manage_inventory: false` never gets an
   * `inventory_quantity` back (Medusa core's own wrapper skips it), so that
   * case returns `{ quantity: 0 }` rather than `undefined`/`NaN`.
   */
  async getVariantInventory(variantId: string): Promise<VariantInventory> {
    const response = await this.authedFetch(
      `/admin/product-variants?id[]=${encodeURIComponent(variantId)}&fields=id,manage_inventory,inventory_quantity`
    )
    const body = (await response.json()) as {
      variants: { id: string; inventory_quantity?: number | null }[]
    }

    const variant = body.variants[0]
    if (!variant) {
      throw new Error(`Variant with id: ${variantId} was not found`)
    }

    return { quantity: variant.inventory_quantity ?? 0 }
  }

  /**
   * Resolves a Medusa `inventory_level` id -- the id Medusa's
   * "inventory-level.updated" event carries, and the only thing the
   * seller-hub webhook receiver gets to enqueue an inventory-sync job with
   * (see `webhook/server.ts`) -- back to the id of the Medusa product
   * variant that inventory level belongs to.
   *
   * There's no Admin API route or filter that goes directly from a
   * location-level's own id to its owning variant: `/admin/inventory-items`
   * (confirmed against this version's `AdminGetInventoryItemsParamsFields`)
   * only supports filtering its nested `location_levels` by `location_id`,
   * not by the level's own `id`, and the dedicated location-levels routes
   * are all nested under a specific `:id` (inventory item) path segment we
   * don't have. So, like `findOrderByMetadata` above (which hits the same
   * kind of gap for order lookup-by-metadata), this pages through inventory
   * items -- each with its `location_levels` and linked `variants`, both
   * valid relation projections per this version's joiner config -- until it
   * finds the one owning `inventoryLevelId`, capped at
   * `MAX_INVENTORY_ITEM_PAGES` pages so a never-matching id can't page
   * forever.
   *
   * Returns `null` if no inventory item owning this level id is found
   * within that cap, or if the matching item has no linked variant.
   */
  async findVariantIdByInventoryLevelId(
    inventoryLevelId: string
  ): Promise<string | null> {
    for (let page = 0; page < MAX_INVENTORY_ITEM_PAGES; page++) {
      const offset = page * INVENTORY_ITEM_PAGE_SIZE
      const response = await this.authedFetch(
        `/admin/inventory-items?limit=${INVENTORY_ITEM_PAGE_SIZE}&offset=${offset}` +
          `&fields=id,*location_levels.id,*variants.id`
      )
      const body = (await response.json()) as {
        inventory_items: InventoryItemWithLevelsAndVariants[]
        count: number
      }

      const match = body.inventory_items.find((item) =>
        item.location_levels?.some((level) => level.id === inventoryLevelId)
      )
      if (match) {
        return match.variants?.[0]?.id ?? null
      }

      const itemsSeenSoFar = offset + body.inventory_items.length
      if (
        body.inventory_items.length < INVENTORY_ITEM_PAGE_SIZE ||
        itemsSeenSoFar >= body.count
      ) {
        break
      }
    }
    return null
  }

  /**
   * Resolves the store's default currency code (e.g. `"usd"`), used by
   * `getVariantPricing` to pick which of a variant's several per-currency
   * prices is "the" current price.
   */
  private async resolveDefaultCurrencyCode(): Promise<string> {
    const response = await this.authedFetch(
      "/admin/stores?fields=id,*supported_currencies"
    )
    const body = (await response.json()) as {
      stores: {
        supported_currencies?: { currency_code: string; is_default: boolean }[]
      }[]
    }
    const defaultCurrency = body.stores[0]?.supported_currencies?.find(
      (c) => c.is_default
    )
    return defaultCurrency?.currency_code ?? "usd"
  }

  /**
   * Attaches the cached bearer token, logging in first if there isn't one
   * yet. On a 401 (expired/invalid token), logs in again once and retries
   * the request a single time.
   */
  private async authedFetch(
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    if (!this.token) {
      await this.login()
    }

    let response = await this.doFetch(path, init)

    if (response.status === 401) {
      await this.login()
      response = await this.doFetch(path, init)
    }

    if (!response.ok) {
      const body = await readBodySafely(response)
      throw new Error(
        `Medusa admin request ${init.method ?? "GET"} ${path} failed with status ${response.status}: ${body}`
      )
    }

    return response
  }

  private doFetch(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
        Authorization: `Bearer ${this.token}`,
      },
    })
  }
}

const readBodySafely = async (response: Response): Promise<string> => {
  try {
    const body = await response.json()
    return JSON.stringify(body)
  } catch {
    return ""
  }
}
