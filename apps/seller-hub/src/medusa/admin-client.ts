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
   * modest order volume.
   */
  async findOrderByMetadata(
    key: string,
    value: string
  ): Promise<{ id: string } | null> {
    const response = await this.authedFetch(
      "/admin/orders?limit=100&fields=id,metadata"
    )
    const body = (await response.json()) as {
      orders: { id: string; metadata?: Record<string, unknown> | null }[]
    }
    const match = body.orders.find((order) => order.metadata?.[key] === value)
    return match ? { id: match.id } : null
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
