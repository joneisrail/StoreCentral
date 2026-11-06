import { compareInvoice } from "../compare-invoice"

type Input = Parameters<typeof compareInvoice>[0]

const purchaseItem = (over: Partial<Input["purchase_items"][number]> = {}) => ({
  id: "pi_1",
  variant_id: "var_1",
  title: "Blue Shirt",
  quantity: 10,
  quantity_received: 10,
  unit_cost: 2,
  ...over,
})

const line = (over: Partial<Input["lines"][number]> = {}) => ({
  purchase_item_id: "pi_1" as string | null,
  variant_id: "var_1",
  description: "Blue Shirt",
  quantity: 10,
  unit_cost: 2,
  ...over,
})

const run = (over: Partial<Input> = {}) =>
  compareInvoice({
    purchase_items: [purchaseItem()],
    lines: [line()],
    other_invoiced: [],
    purchase_total: 20,
    invoice_total: 20,
    ...over,
  })

const noFlags = {
  price_difference: false,
  over_received: false,
  over_ordered: false,
  not_on_purchase: false,
}

describe("compareInvoice", () => {
  it("reports a matching line with no flags", () => {
    const result = run()
    expect(result.items).toEqual([
      {
        purchase_item_id: "pi_1",
        variant_id: "var_1",
        title: "Blue Shirt",
        ordered_quantity: 10,
        received_quantity: 10,
        invoiced_quantity: 10,
        invoiced_quantity_total: 10,
        ordered_unit_cost: 2,
        invoiced_unit_cost: 2,
        flags: noFlags,
      },
    ])
    expect(result.difference).toBe(0)
  })

  it("flags a price difference", () => {
    const result = run({ lines: [line({ unit_cost: 2.5 })] })
    expect(result.items[0].flags).toEqual({ ...noFlags, price_difference: true })
  })

  it("flags over_received when invoiced exceeds received but not ordered", () => {
    const result = run({
      purchase_items: [purchaseItem({ quantity_received: 6 })],
      lines: [line({ quantity: 8 })],
    })
    expect(result.items[0].flags).toEqual({ ...noFlags, over_received: true })
  })

  it("flags over_ordered when invoiced exceeds ordered", () => {
    const result = run({
      purchase_items: [purchaseItem({ quantity_received: 12 })],
      lines: [line({ quantity: 11 })],
    })
    expect(result.items[0].flags).toEqual({ ...noFlags, over_ordered: true })
  })

  it("flags every difference together", () => {
    const result = run({
      purchase_items: [purchaseItem({ quantity_received: 3 })],
      lines: [line({ quantity: 12, unit_cost: 3 })],
    })
    expect(result.items[0].flags).toEqual({
      price_difference: true,
      over_received: true,
      over_ordered: true,
      not_on_purchase: false,
    })
  })

  it("includes a purchase item with no line, with no price flag", () => {
    const result = run({
      purchase_items: [
        purchaseItem(),
        purchaseItem({ id: "pi_2", variant_id: "var_2", title: "Red", unit_cost: 5 }),
      ],
    })
    expect(result.items[1]).toEqual({
      purchase_item_id: "pi_2",
      variant_id: "var_2",
      title: "Red",
      ordered_quantity: 10,
      received_quantity: 10,
      invoiced_quantity: 0,
      invoiced_quantity_total: 0,
      ordered_unit_cost: 5,
      invoiced_unit_cost: null,
      flags: noFlags,
    })
  })

  it("flags a line with no purchase item as not_on_purchase", () => {
    const result = run({
      lines: [
        line(),
        line({ purchase_item_id: null, variant_id: "var_9", description: "Extra", quantity: 2, unit_cost: 4 }),
      ],
    })
    expect(result.items).toHaveLength(2)
    expect(result.items[1]).toEqual({
      purchase_item_id: null,
      variant_id: "var_9",
      title: "Extra",
      ordered_quantity: 0,
      received_quantity: 0,
      invoiced_quantity: 2,
      invoiced_quantity_total: 2,
      ordered_unit_cost: null,
      invoiced_unit_cost: 4,
      flags: { ...noFlags, not_on_purchase: true },
    })
  })

  it("counts other posted invoices toward over_ordered", () => {
    const result = run({
      lines: [line({ quantity: 4 })],
      other_invoiced: [
        { purchase_item_id: "pi_1", quantity: 5 },
        { purchase_item_id: "pi_1", quantity: 3 },
        { purchase_item_id: "pi_other", quantity: 99 },
      ],
    })
    expect(result.items[0].invoiced_quantity).toBe(4)
    expect(result.items[0].invoiced_quantity_total).toBe(12)
    expect(result.items[0].flags.over_ordered).toBe(true)
  })

  it("counts other posted invoices toward over_received", () => {
    const result = run({
      purchase_items: [purchaseItem({ quantity: 20, quantity_received: 8 })],
      lines: [line({ quantity: 5 })],
      other_invoiced: [{ purchase_item_id: "pi_1", quantity: 4 }],
    })
    expect(result.items[0].flags).toEqual({ ...noFlags, over_received: true })
  })

  it("does not flag when the total equals received or ordered", () => {
    const received = run({
      purchase_items: [purchaseItem({ quantity: 20, quantity_received: 9 })],
      lines: [line({ quantity: 5 })],
      other_invoiced: [{ purchase_item_id: "pi_1", quantity: 4 }],
    })
    expect(received.items[0].invoiced_quantity_total).toBe(9)
    expect(received.items[0].flags).toEqual(noFlags)

    const ordered = run({
      purchase_items: [purchaseItem({ quantity: 9, quantity_received: 9 })],
      lines: [line({ quantity: 5 })],
      other_invoiced: [{ purchase_item_id: "pi_1", quantity: 4 }],
    })
    expect(ordered.items[0].flags).toEqual(noFlags)
  })

  it("averages differing costs weighted by quantity", () => {
    const result = run({
      lines: [line({ quantity: 4, unit_cost: 2 }), line({ quantity: 6, unit_cost: 3 })],
    })
    expect(result.items[0].invoiced_unit_cost).toBe(2.6)
  })

  it("compares prices at two decimals", () => {
    const result = run({
      purchase_items: [purchaseItem({ unit_cost: 0.3 })],
      lines: [line({ unit_cost: 0.1 + 0.2 })],
    })
    expect(result.items[0].flags.price_difference).toBe(false)
  })

  it("sums several lines for one purchase item", () => {
    const result = run({
      lines: [line({ quantity: 4 }), line({ quantity: 6, unit_cost: 3 })],
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].invoiced_quantity).toBe(10)
    expect(result.items[0].flags.price_difference).toBe(true)
  })

  it("reports the header difference rounded", () => {
    const result = run({ purchase_total: 20.1, invoice_total: 20.4 })
    expect(result.purchase_total).toBe(20.1)
    expect(result.invoice_total).toBe(20.4)
    expect(result.difference).toBe(0.3)
  })
})
