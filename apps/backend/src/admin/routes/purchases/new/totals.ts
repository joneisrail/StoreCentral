// Mirrors the purchase module's totals rule on the client. The backend module
// code (src/modules/purchase/utils) must not be imported into the admin
// bundle, so the three-line sum is duplicated here. Amounts are plain dollar
// values, never cents.
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export type TotalsItem = { quantity: number; unit_cost: number }

export type TotalsExtras = {
  shipping_cost: number
  tax: number
  other_cost: number
}

export function calculateTotals(items: TotalsItem[], extras: TotalsExtras) {
  const subtotal = round2(
    items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)
  )
  const total = round2(
    subtotal + extras.shipping_cost + extras.tax + extras.other_cost
  )
  return { subtotal, total }
}
