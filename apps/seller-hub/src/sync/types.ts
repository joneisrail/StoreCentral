/**
 * An Amazon order, already normalized into the shape seller-hub's own
 * import flow expects. Producing this from Amazon's own SP-API order shape
 * is Task 10's job — this type is the stable boundary between that
 * normalization step and `importAmazonOrder`.
 */
export type NormalizedAmazonOrder = {
  amazonOrderId: string
  buyerEmail: string
  items: { sku: string; quantity: number }[]
  shippingAddress: {
    first_name: string
    last_name: string
    address_1: string
    city: string
    country_code: string
    postal_code: string
  }
}
