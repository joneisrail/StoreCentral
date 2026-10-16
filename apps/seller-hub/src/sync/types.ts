/**
 * An Amazon order, already normalized into the shape seller-hub's own
 * import flow expects. Producing this from Amazon's own SP-API order shape
 * is Task 10's job — this type is the stable boundary between that
 * normalization step and `importAmazonOrder`.
 */
export type NormalizedAmazonOrder = {
  amazonOrderId: string
  /**
   * Amazon's `OrderStatus` for this order (e.g. `"Pending"`, `"Unshipped"`,
   * `"Canceled"`). Optional so callers that don't need order-status
   * filtering (existing tests, fixtures) can omit it -- `importAmazonOrder`
   * treats a missing status as safe to import, since withholding import on
   * an unrecognized/absent status would be a worse failure mode than
   * importing an order whose exact state we can't tell.
   */
  orderStatus?: string
  buyerEmail: string
  items: { sku: string; quantity: number; unitPrice?: number }[]
  shippingAddress: {
    first_name: string
    last_name: string
    address_1: string
    city: string
    country_code: string
    postal_code: string
  }
}
