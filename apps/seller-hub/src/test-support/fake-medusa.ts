import http from "node:http"
import type { AddressInfo } from "node:net"

export type FakeVariant = {
  id: string
  product_id: string
  sku: string | null
  /** Price in the store's default currency. */
  price: number
  currency_code: string
  /** Other-currency prices, emitted before the default one in `prices`. */
  extra_prices?: { amount: number; currency_code: string }[]
  inventory_quantity: number
  inventory_item_id: string
  inventory_level_id: string
  /** Defaults to true; a false variant has no linked inventory item. */
  manage_inventory?: boolean
}

export type FakeOrder = {
  id: string
  metadata: Record<string, unknown>
  /** Orders are served newest-first when the client asks for `-created_at`. */
  created_at: number
}

export type FakeMedusaState = {
  salesChannels: { id: string; name: string }[]
  regions: { id: string; countries: string[] }[]
  defaultCurrency: string
  variants: FakeVariant[]
  /** Draft orders (`is_draft_order: true`); converting one moves it to `orders`. */
  draftOrders: FakeOrder[]
  /** Real (converted) orders, the only ones `GET /admin/orders` lists. */
  orders: FakeOrder[]
  /** `GET .../push-values` answers, keyed `${variantId}/${salesChannelId}`. */
  pushValues: Record<
    string,
    { price: number | null; effective_price: number; stock: number }
  >
  /** Bodies received by `POST .../sync-result`. */
  syncResults: { variantId: string; salesChannelId: string; body: unknown }[]
  /** The next N authenticated requests answer 401 (forces a client re-login). */
  unauthorizedResponses: number
  /** Bodies received by `POST /admin/products`. */
  createdProducts: any[]
  /** Served by `GET /admin/stock-locations`, in order. */
  stockLocations: { id: string; name: string }[]
  /** Bodies received by `POST /admin/inventory-items/:id/location-levels`. */
  locationLevels: { inventoryItemId: string; body: any }[]
  /** When set, `POST /admin/products` answers 400 with this body. */
  productCreateError: unknown
}

export type FakeMedusa = {
  baseUrl: string
  close: () => Promise<void>
  state: FakeMedusaState
  /** Every request received; `path` includes the query string. */
  requests: { method: string; path: string }[]
}

const defaultState = (): FakeMedusaState => ({
  salesChannels: [],
  regions: [{ id: "reg_us", countries: ["us"] }],
  defaultCurrency: "usd",
  variants: [],
  draftOrders: [],
  orders: [],
  pushValues: {},
  syncResults: [],
  unauthorizedResponses: 0,
  createdProducts: [],
  stockLocations: [{ id: "sloc_default", name: "Default warehouse" }],
  locationLevels: [],
  productCreateError: undefined,
})

const readJson = async (req: http.IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : {}
}

/**
 * A tiny in-process stand-in for the Medusa Admin API: just the routes
 * `MedusaAdminClient` calls, with the response shapes it parses. Listens on
 * 127.0.0.1 with an OS-assigned port. `seed` overrides parts of the default
 * (mostly empty) state.
 */
export const startFakeMedusa = async (
  seed: Partial<FakeMedusaState> = {}
): Promise<FakeMedusa> => {
  const state: FakeMedusaState = { ...defaultState(), ...seed }
  const requests: FakeMedusa["requests"] = []
  const tokens = new Set<string>()
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}_fake${++sequence}`

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }

  const page = <T>(items: T[], params: URLSearchParams): T[] => {
    const limit = Number(params.get("limit") ?? 50)
    const offset = Number(params.get("offset") ?? 0)
    return items.slice(offset, offset + limit)
  }

  const variantJson = (v: FakeVariant) => ({
    id: v.id,
    product_id: v.product_id,
    sku: v.sku,
    manage_inventory: v.manage_inventory ?? true,
    inventory_quantity: v.inventory_quantity,
    inventory_items:
      v.manage_inventory === false
        ? []
        : [{ inventory_item_id: v.inventory_item_id, required_quantity: 1 }],
    prices: [
      ...(v.extra_prices ?? []),
      { amount: v.price, currency_code: v.currency_code },
    ],
  })

  const route = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    const method = req.method ?? "GET"
    const url = new URL(req.url ?? "/", "http://fake")
    const { pathname, searchParams } = url
    requests.push({ method, path: `${pathname}${url.search}` })

    if (method === "POST" && pathname === "/auth/user/emailpass") {
      const token = nextId("token")
      tokens.add(token)
      return send(res, 200, { token })
    }

    const bearer = req.headers.authorization?.replace(/^Bearer /, "")
    if (!bearer || !tokens.has(bearer)) return send(res, 401, {})
    if (state.unauthorizedResponses > 0) {
      state.unauthorizedResponses--
      tokens.delete(bearer)
      return send(res, 401, {})
    }

    if (method === "GET" && pathname === "/admin/sales-channels") {
      return send(res, 200, { sales_channels: state.salesChannels })
    }

    if (method === "GET" && pathname === "/admin/regions") {
      return send(res, 200, {
        regions: state.regions.map((r) => ({
          id: r.id,
          countries: r.countries.map((iso_2) => ({ iso_2 })),
        })),
      })
    }

    if (method === "GET" && pathname === "/admin/stores") {
      return send(res, 200, {
        stores: [
          {
            supported_currencies: [
              { currency_code: state.defaultCurrency, is_default: true },
            ],
          },
        ],
      })
    }

    if (method === "POST" && pathname === "/admin/draft-orders") {
      const body = await readJson(req)
      const draft: FakeOrder = {
        id: nextId("order"),
        metadata: body.metadata ?? {},
        created_at: ++sequence,
      }
      state.draftOrders.push(draft)
      return send(res, 200, { draft_order: { id: draft.id } })
    }

    const convert = pathname.match(
      /^\/admin\/draft-orders\/([^/]+)\/convert-to-order$/
    )
    if (method === "POST" && convert) {
      const index = state.draftOrders.findIndex((d) => d.id === convert[1])
      if (index < 0) return send(res, 404, {})
      const [draft] = state.draftOrders.splice(index, 1)
      state.orders.push(draft!)
      return send(res, 200, { order: { id: draft!.id } })
    }

    if (method === "GET" && pathname === "/admin/orders") {
      const sorted =
        searchParams.get("order") === "-created_at"
          ? [...state.orders].sort((a, b) => b.created_at - a.created_at)
          : state.orders
      return send(res, 200, {
        orders: page(sorted, searchParams).map((o) => ({
          id: o.id,
          metadata: o.metadata,
        })),
      })
    }

    const orderById = pathname.match(/^\/admin\/orders\/([^/]+)$/)
    if (method === "GET" && orderById) {
      const id = decodeURIComponent(orderById[1]!)
      const isDraft = state.draftOrders.some((o) => o.id === id)
      if (!isDraft && !state.orders.some((o) => o.id === id)) {
        return send(res, 404, {})
      }
      return send(res, 200, { order: { id, is_draft_order: isDraft } })
    }

    if (method === "GET" && pathname === "/admin/product-variants") {
      const ids = searchParams.getAll("id[]")
      const matching = ids.length
        ? state.variants.filter((v) => ids.includes(v.id))
        : state.variants
      return send(res, 200, {
        variants: page(matching, searchParams).map(variantJson),
        count: matching.length,
      })
    }

    if (method === "GET" && pathname === "/admin/inventory-items") {
      const items = state.variants.map((v) => ({
        id: v.inventory_item_id,
        location_levels: [{ id: v.inventory_level_id }],
        variants: [{ id: v.id }],
      }))
      return send(res, 200, {
        inventory_items: page(items, searchParams),
        count: items.length,
      })
    }

    if (method === "POST" && pathname === "/admin/products") {
      const body = await readJson(req)
      state.createdProducts.push(body)
      if (state.productCreateError !== undefined) {
        return send(res, 400, state.productCreateError)
      }
      const productId = nextId("prod")
      const variants = ((body.variants ?? []) as any[]).map((v) => {
        const prices = (v.prices ?? []) as {
          amount: number
          currency_code: string
        }[]
        const fakeVariant: FakeVariant = {
          id: nextId("variant"),
          product_id: productId,
          sku: v.sku ?? null,
          price: prices[0]?.amount ?? 0,
          currency_code: prices[0]?.currency_code ?? state.defaultCurrency,
          inventory_quantity: 0,
          inventory_item_id: nextId("iitem"),
          inventory_level_id: nextId("ilev"),
          // Medusa defaults `manage_inventory` to true when omitted.
          manage_inventory: v.manage_inventory ?? true,
        }
        state.variants.push(fakeVariant)
        return { id: fakeVariant.id }
      })
      return send(res, 200, { product: { id: productId, variants } })
    }

    if (method === "GET" && pathname === "/admin/stock-locations") {
      return send(res, 200, {
        stock_locations: page(state.stockLocations, searchParams),
        count: state.stockLocations.length,
      })
    }

    const levels = pathname.match(
      /^\/admin\/inventory-items\/([^/]+)\/location-levels$/
    )
    if (method === "POST" && levels) {
      const inventoryItemId = decodeURIComponent(levels[1]!)
      const owner = state.variants.find(
        (v) => v.inventory_item_id === inventoryItemId
      )
      if (!owner) return send(res, 404, {})
      const body = await readJson(req)
      state.locationLevels.push({ inventoryItemId, body })
      owner.inventory_quantity = body.stocked_quantity ?? 0
      return send(res, 200, { inventory_item: { id: inventoryItemId } })
    }

    const offer = pathname.match(
      /^\/admin\/channel-offers\/([^/]+)\/([^/]+)\/(push-values|sync-result)$/
    )
    if (offer) {
      const variantId = decodeURIComponent(offer[1]!)
      const salesChannelId = decodeURIComponent(offer[2]!)
      if (method === "GET" && offer[3] === "push-values") {
        const values = state.pushValues[`${variantId}/${salesChannelId}`]
        return values ? send(res, 200, values) : send(res, 404, {})
      }
      if (method === "POST" && offer[3] === "sync-result") {
        state.syncResults.push({
          variantId,
          salesChannelId,
          body: await readJson(req),
        })
        return send(res, 200, {})
      }
    }

    return send(res, 404, { message: `No fake route for ${method} ${pathname}` })
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => send(res, 500, { message: String(error) }))
  })
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  )
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
