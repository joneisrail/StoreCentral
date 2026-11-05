import { mapPurchaseForAdmin } from "../map-purchase"

const buildPurchase = (overrides: Record<string, unknown> = {}) => ({
  id: "pur_1",
  display_id: 7,
  status: "draft",
  currency_code: "usd",
  shipping_cost: "5",
  tax: "2.5",
  other_cost: 0,
  notes: null,
  ordered_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  items: [
    {
      id: "puri_1",
      variant_id: "variant_1",
      sku: "SKU-1",
      title: "Widget",
      quantity: 10,
      quantity_received: 4,
      unit_cost: "2.5",
    },
    {
      id: "puri_2",
      variant_id: "variant_2",
      sku: "SKU-2",
      title: "Gadget",
      quantity: 3,
      quantity_received: 0,
      unit_cost: 10,
    },
  ],
  receipts: [
    {
      id: "purr_1",
      stock_location_id: "sloc_1",
      received_at: "2026-01-02T00:00:00.000Z",
      note: "first",
      items: [{ purchase_item_id: "puri_1", quantity: 4 }],
    },
  ],
  ...overrides,
})

describe("mapPurchaseForAdmin", () => {
  it("formats the reference from display_id", () => {
    const result = mapPurchaseForAdmin(buildPurchase() as any, null)
    expect(result.reference).toBe("PO-0007")
  })

  it("computes subtotal and total and converts money with Number", () => {
    const result = mapPurchaseForAdmin(buildPurchase() as any, null)

    expect(result.subtotal).toBe(55)
    expect(result.total).toBe(62.5)
    expect(result.shipping_cost).toBe(5)
    expect(result.tax).toBe(2.5)
    expect(result.other_cost).toBe(0)
    expect(result.items[0].unit_cost).toBe(2.5)
  })

  it("computes remaining per item", () => {
    const result = mapPurchaseForAdmin(buildPurchase() as any, null)

    expect(result.items.map((i) => i.remaining)).toEqual([6, 3])
  })

  it("passes a null supplier through and a given supplier unchanged", () => {
    expect(mapPurchaseForAdmin(buildPurchase() as any, null).supplier).toBeNull()
    expect(
      mapPurchaseForAdmin(buildPurchase() as any, { id: "sup_1", name: "Acme" })
        .supplier
    ).toEqual({ id: "sup_1", name: "Acme" })
  })

  it("maps receipts with their items", () => {
    const result = mapPurchaseForAdmin(buildPurchase() as any, null)

    expect(result.receipts).toEqual([
      {
        id: "purr_1",
        stock_location_id: "sloc_1",
        received_at: "2026-01-02T00:00:00.000Z",
        note: "first",
        items: [{ purchase_item_id: "puri_1", quantity: 4 }],
      },
    ])
  })
})
