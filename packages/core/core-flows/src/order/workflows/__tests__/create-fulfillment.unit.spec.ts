import { OrderDTO } from "@medusajs/framework/types"
import { prepareFulfillmentData } from "../create-fulfillment"

describe("prepareFulfillmentData", () => {
  const order = {
    id: "order_1",
    items: [
      {
        id: "item_1",
        quantity: 1,
        requires_shipping: true,
        variant_title: "Variant 1",
        title: "Product 1",
        variant_sku: "SKU1",
        variant_barcode: "BARCODE1",
        variant: {
          product: {
            shipping_profile: { id: "sp_1" },
          },
          inventory_items: [],
        },
      },
    ],
    shipping_address: { id: "addr_1", address_1: "123 Main St" },
  } as unknown as OrderDTO

  const shippingOption = {
    id: "so_1",
    provider_id: "provider_1",
    service_zone: { fulfillment_set: { location: { id: "loc_1" } } },
    shipping_profile_id: "sp_1",
  }

  const baseInput = {
    order_id: "order_1",
    items: [{ id: "item_1", quantity: 1 }],
  } as any

  it("uses provider_data_override for the fulfillment data when present", () => {
    const result = prepareFulfillmentData({
      order,
      input: {
        ...baseInput,
        provider_data_override: { easypost_shipment_id: "shp_fresh" },
      },
      shippingOption,
      shippingMethod: { data: { easypost_shipment_id: "shp_checkout" } },
      reservations: [],
    })
    expect(result.input.data).toEqual({ easypost_shipment_id: "shp_fresh" })
  })

  it("falls back to the shipping method's data when no override is given (regression)", () => {
    const result = prepareFulfillmentData({
      order,
      input: baseInput,
      shippingOption,
      shippingMethod: { data: { easypost_shipment_id: "shp_checkout" } },
      reservations: [],
    })
    expect(result.input.data).toEqual({ easypost_shipment_id: "shp_checkout" })
  })
})
