import { expect, test, vi } from "vitest"
import type { SpApiClient } from "./client.js"
import { getOrder } from "./orders.js"

test("getOrder maps a raw SP-API order response into NormalizedAmazonOrder", async () => {
  const fakeSpApiClient = {
    request: vi.fn().mockResolvedValue({
      AmazonOrderId: "ORDER-ABC",
      OrderStatus: "Unshipped",
      BuyerInfo: { BuyerEmail: "buyer@example.com" },
      ShippingAddress: {
        Name: "Jane Doe",
        AddressLine1: "1 Test St",
        City: "Seattle",
        CountryCode: "US",
        PostalCode: "98101",
      },
      OrderItems: [
        {
          SellerSKU: "TEST-SKU-1",
          QuantityOrdered: 2,
          ItemPrice: { Amount: "59.98" },
        },
      ],
    }),
  } as unknown as SpApiClient

  const result = await getOrder(fakeSpApiClient, "ORDER-ABC")

  expect(result).toEqual({
    amazonOrderId: "ORDER-ABC",
    orderStatus: "Unshipped",
    buyerEmail: "buyer@example.com",
    items: [{ sku: "TEST-SKU-1", quantity: 2, unitPrice: 29.99 }],
    shippingAddress: {
      first_name: "Jane",
      last_name: "Doe",
      address_1: "1 Test St",
      city: "Seattle",
      country_code: "us",
      postal_code: "98101",
    },
  })
})

test("getOrder omits unitPrice and orderStatus when the raw response lacks ItemPrice/OrderStatus", async () => {
  const fakeSpApiClient = {
    request: vi.fn().mockResolvedValue({
      AmazonOrderId: "ORDER-NOPRICE",
      BuyerInfo: { BuyerEmail: "buyer@example.com" },
      ShippingAddress: {
        Name: "Jane Doe",
        AddressLine1: "1 Test St",
        City: "Seattle",
        CountryCode: "US",
        PostalCode: "98101",
      },
      OrderItems: [{ SellerSKU: "TEST-SKU-1", QuantityOrdered: 2 }],
    }),
  } as unknown as SpApiClient

  const result = await getOrder(fakeSpApiClient, "ORDER-NOPRICE")

  expect(result.orderStatus).toBeUndefined()
  expect(result.items).toEqual([{ sku: "TEST-SKU-1", quantity: 2 }])
})

test("getOrder divides ItemPrice (the line total) by quantity and rounds to 2 decimals", async () => {
  const fakeSpApiClient = {
    request: vi.fn().mockResolvedValue({
      AmazonOrderId: "ORDER-ROUNDING",
      OrderStatus: "Shipped",
      BuyerInfo: { BuyerEmail: "buyer@example.com" },
      ShippingAddress: {
        Name: "Jane Doe",
        AddressLine1: "1 Test St",
        City: "Seattle",
        CountryCode: "US",
        PostalCode: "98101",
      },
      OrderItems: [
        {
          SellerSKU: "TEST-SKU-1",
          QuantityOrdered: 3,
          ItemPrice: { Amount: "10.00" },
        },
      ],
    }),
  } as unknown as SpApiClient

  const result = await getOrder(fakeSpApiClient, "ORDER-ROUNDING")

  expect(result.items[0]!.unitPrice).toBe(3.33)
})

test("getOrder calls the SP-API client with the getOrder operation and amazonOrderId in the path", async () => {
  const fakeSpApiClient = {
    request: vi.fn().mockResolvedValue({
      AmazonOrderId: "ORDER-XYZ",
      BuyerInfo: { BuyerEmail: "someone@example.com" },
      ShippingAddress: {
        Name: "John Q Public",
        AddressLine1: "2 Test Ave",
        City: "Portland",
        CountryCode: "US",
        PostalCode: "97201",
      },
      OrderItems: [{ SellerSKU: "SKU-A", QuantityOrdered: 1 }],
    }),
  } as unknown as SpApiClient

  await getOrder(fakeSpApiClient, "ORDER-XYZ")

  expect(fakeSpApiClient.request).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "getOrder",
      method: "GET",
      path: "/orders/v0/orders/ORDER-XYZ",
    })
  )
})

test("getOrder maps multiple order items and a multi-word last name", async () => {
  const fakeSpApiClient = {
    request: vi.fn().mockResolvedValue({
      AmazonOrderId: "ORDER-MULTI",
      OrderStatus: "PartiallyShipped",
      BuyerInfo: { BuyerEmail: "multi@example.com" },
      ShippingAddress: {
        Name: "Mary Anne Smith Jones",
        AddressLine1: "3 Test Blvd",
        City: "Austin",
        CountryCode: "US",
        PostalCode: "73301",
      },
      OrderItems: [
        {
          SellerSKU: "SKU-1",
          QuantityOrdered: 1,
          ItemPrice: { Amount: "9.99" },
        },
        {
          SellerSKU: "SKU-2",
          QuantityOrdered: 3,
          ItemPrice: { Amount: "30.00" },
        },
      ],
    }),
  } as unknown as SpApiClient

  const result = await getOrder(fakeSpApiClient, "ORDER-MULTI")

  expect(result.orderStatus).toBe("PartiallyShipped")
  expect(result.items).toEqual([
    { sku: "SKU-1", quantity: 1, unitPrice: 9.99 },
    { sku: "SKU-2", quantity: 3, unitPrice: 10 },
  ])
  // "First word is first name, remainder is last name" per the brief's own
  // "Jane Doe" -> { first_name: "Jane", last_name: "Doe" } example.
  expect(result.shippingAddress.first_name).toBe("Mary")
  expect(result.shippingAddress.last_name).toBe("Anne Smith Jones")
})
