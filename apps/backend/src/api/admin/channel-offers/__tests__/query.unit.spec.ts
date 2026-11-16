import { availableFromItems, availableFromVariantRow } from "../../../../modules/channel-offers/available-stock"
import { clearStockMemo, loadGrid, type GridDeps } from "../query"

type V = { id: string; manage_inventory: boolean; items: { item: string; required: number }[] }
type Level = { item: string; stocked: number; reserved: number }

function fakeDeps(variants: V[], levels: Level[], offerRows: any[] = []): GridDeps & { calls: string[] } {
  const calls: string[] = []
  const page = (rows: any[], p: any) => ({
    data: rows.slice(p?.skip ?? 0, (p?.skip ?? 0) + (p?.take ?? rows.length)),
    metadata: { count: rows.length },
  })
  return {
    calls,
    connectedChannelIds: async () => new Set(),
    offers: {
      listChannelOffers: async (_f: any, c: any = {}) => {
        const skip = c.skip ?? 0
        return offerRows.slice(skip, c.take == null ? undefined : skip + c.take)
      },
    },
    query: {
      graph: async (a: any) => {
        calls.push(a.entity)
        switch (a.entity) {
          case "sales_channel":
            return { data: [{ id: "sc_1", name: "A", metadata: null }] }
          case "store":
            return { data: [{ id: "st", default_sales_channel_id: null, supported_currencies: [] }] }
          case "product":
            return page([{ id: "p", title: "P" }], a.pagination)
          case "product_variant":
            return page(
              variants.map((v) => ({
                id: v.id,
                sku: v.id,
                title: v.id,
                manage_inventory: v.manage_inventory,
                product_id: "p",
              })),
              a.pagination
            )
          case "product_variant_inventory_item":
            return page(
              variants.flatMap((v) =>
                v.items.map((i) => ({ id: v.id + i.item, variant_id: v.id, inventory_item_id: i.item, required_quantity: i.required }))
              ),
              a.pagination
            )
          case "inventory_level":
            return page(
              levels.map((l, n) => ({ id: String(n), inventory_item_id: l.item, stocked_quantity: l.stocked, reserved_quantity: l.reserved })),
              a.pagination
            )
        }
        return { data: [] }
      },
    },
  }
}

const params = { order: "total", limit: 100, offset: 0 }

describe("bulk stock equals availableFromVariantRow", () => {
  beforeEach(() => clearStockMemo())

  it("matches for several shapes", async () => {
    const variants: V[] = [
      { id: "multi", manage_inventory: true, items: [{ item: "i1", required: 1 }] },
      { id: "req2", manage_inventory: true, items: [{ item: "i2", required: 2 }] },
      { id: "unmanaged", manage_inventory: false, items: [{ item: "i3", required: 1 }] },
      { id: "noitem", manage_inventory: true, items: [] },
      { id: "kit", manage_inventory: true, items: [{ item: "i1", required: 1 }, { item: "i2", required: 3 }] },
      { id: "over", manage_inventory: true, items: [{ item: "i4", required: 1 }] },
    ]
    const levels: Level[] = [
      { item: "i1", stocked: 10, reserved: 2 },
      { item: "i1", stocked: 5, reserved: 0 },
      { item: "i2", stocked: 9, reserved: 0 },
      { item: "i3", stocked: 50, reserved: 0 },
      { item: "i4", stocked: 2, reserved: 6 },
    ]
    const deps = fakeDeps(variants, levels)
    const res = await loadGrid(deps, params, { stockMemoTtlMs: 0 })
    const byId = Object.fromEntries(res.rows.map((r) => [r.variant_id, r.available]))
    for (const v of variants) {
      const row = availableFromVariantRow({
        id: v.id,
        manage_inventory: v.manage_inventory,
        inventory_items: v.items.map((i) => ({
          required_quantity: i.required,
          inventory: {
            location_levels: levels
              .filter((l) => l.item === i.item)
              .map((l) => ({ stocked_quantity: l.stocked, reserved_quantity: l.reserved })),
          },
        })),
      })
      expect(byId[v.id]).toBe(row)
    }
    expect(byId).toMatchObject({ multi: 13, req2: 4, unmanaged: 0, noitem: 0, kit: 3, over: 0 })
    expect(availableFromItems(true, [{ net: 7, required_quantity: 2 }])).toBe(3)
  })

  it("memoizes the stock read for the ttl", async () => {
    const deps = fakeDeps([{ id: "a", manage_inventory: true, items: [{ item: "i1", required: 1 }] }], [
      { item: "i1", stocked: 4, reserved: 0 },
    ])
    await loadGrid(deps, params, { stockMemoTtlMs: 10_000 })
    const before = deps.calls.filter((c) => c === "inventory_level").length
    await loadGrid(deps, params, { stockMemoTtlMs: 10_000 })
    expect(deps.calls.filter((c) => c === "inventory_level").length).toBe(before)
  })
})

describe("truncated flag", () => {
  beforeEach(() => clearStockMemo())
  const mk = (n: number): V[] =>
    Array.from({ length: n }, (_, i) => ({ id: `v${String(i).padStart(3, "0")}`, manage_inventory: false, items: [] }))

  it("flags the variant cap only when more than the cap match", async () => {
    const exact = await loadGrid(fakeDeps(mk(5), []), params, { variantCap: 5, stockMemoTtlMs: 0 })
    expect(exact.truncated).toBe(false)
    expect(exact.count).toBe(5)
    const over = await loadGrid(fakeDeps(mk(6), []), params, { variantCap: 5, stockMemoTtlMs: 0 })
    expect(over.truncated).toBe(true)
    expect(over.count).toBe(5)
  })

  it("flags the offer cap only when it is actually reached", async () => {
    const offers = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(4, "0"), variant_id: "v000", sales_channel_id: "sc_" + i, stock: 1, price: null, sync_state: "pending" }))
    const ord = { ...params, order: "unallocated" }
    const exact = await loadGrid(fakeDeps(mk(1001), [], offers(4)), ord, { offerCap: 4, stockMemoTtlMs: 0 })
    expect(exact.truncated).toBe(false)
    const over = await loadGrid(fakeDeps(mk(1001), [], offers(5)), ord, { offerCap: 4, stockMemoTtlMs: 0 })
    expect(over.truncated).toBe(true)
  })
})
