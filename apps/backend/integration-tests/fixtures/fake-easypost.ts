import { resolveEasyPostFulfillmentProvider } from "@medusajs/core-flows"
import { MedusaContainer } from "@medusajs/types"

/**
 * A shipment as the fake EasyPost "account" below holds it.
 */
export type FakeShipment = {
  id: string
  rates: {
    id: string
    carrier: string
    service: string
    rate: string
    currency: string
    deliveryDays: number | null
  }[]
  purchased: boolean
  selectedRateId?: string
  trackingCode?: string
  labelUrl?: string
  trackerId?: string
  trackingUrl?: string
  toAddress?: Record<string, unknown>
  fromAddress?: Record<string, unknown>
  parcel?: Record<string, unknown>
}

/**
 * An in-memory stand-in for `EasyPostClient` (the thin wrapper around the
 * `@easypost/api` SDK) that behaves like EasyPost does for the calls the
 * admin quote/bulk-fulfill flows make - most importantly, a second `buy` of
 * an already-purchased shipment is rejected, exactly like the real API's
 * HTTP 422 `SHIPMENT.POSTAGE.EXISTS`, and batches/labels report the states
 * the real API reports.
 *
 * Everything above the client - the real EasyPost provider service, the
 * real Fulfillment Module and the real workflows - runs for real.
 */
export const buildFakeEasyPost = () => {
  const shipments = new Map<string, FakeShipment>()
  const batches = new Map<string, { id: string; shipmentIds: string[] }>()
  let counter = 0

  /**
   * Registers a quotable (unbought) shipment, as a carrier-rates quote
   * would have created it.
   */
  const quote = (id: string): FakeShipment => {
    const shipment: FakeShipment = {
      id,
      rates: [
        {
          id: `${id}_rate_usps`,
          carrier: "USPS",
          service: "GroundAdvantage",
          rate: "5.49",
          currency: "USD",
          deliveryDays: 3,
        },
      ],
      purchased: false,
      toAddress: {
        street1: "test address 1",
        city: "ny",
        state: "ny",
        zip: "94016",
        country: "US",
      },
      fromAddress: {
        street1: "1 Warehouse Way",
        city: "Portland",
        state: "OR",
        zip: "97201",
        country: "US",
      },
      parcel: { weight: 99, length: 1, width: 1, height: 1 },
    }
    shipments.set(id, shipment)
    return shipment
  }

  const publicShape = (shipment: FakeShipment) => ({
    id: shipment.id,
    rates: shipment.rates,
    trackingCode: shipment.trackingCode,
    labelUrl: shipment.labelUrl,
    trackerId: shipment.trackerId,
    trackingUrl: shipment.trackingUrl,
  })

  const getShipment = (shipmentId: string) => {
    const shipment = shipments.get(shipmentId)
    if (!shipment) {
      throw new Error(`fake EasyPost: no shipment ${shipmentId}`)
    }
    return shipment
  }

  const client = {
    createShipment: jest.fn(async () => publicShape(quote(`shp_fresh_${++counter}`))),
    retrieveShipment: jest.fn(async (shipmentId: string) => {
      const shipment = getShipment(shipmentId)
      return { ...publicShape(shipment), ...shipment }
    }),
    buyShipment: jest.fn(async (shipmentId: string, rateId: string) => {
      const shipment = getShipment(shipmentId)
      if (shipment.purchased) {
        throw Object.assign(
          new Error("Postage already exists for this shipment."),
          { code: "SHIPMENT.POSTAGE.EXISTS" }
        )
      }
      shipment.purchased = true
      shipment.selectedRateId = rateId
      shipment.trackingCode = `EZ_TRACK_${shipmentId}`
      shipment.labelUrl = `https://easypost.test/label/${shipmentId}.png`
      shipment.trackerId = `trk_${shipmentId}`
      shipment.trackingUrl = `https://track.easypost.test/${shipmentId}`
      return publicShape(shipment)
    }),
    refundShipment: jest.fn(async (shipmentId: string) => ({
      ...publicShape(getShipment(shipmentId)),
      refundStatus: "submitted",
    })),
    createBatch: jest.fn(async (shipmentIds: string[]) => {
      const id = `batch_${++counter}`
      batches.set(id, { id, shipmentIds })
      return { id, state: "creating" }
    }),
    retrieveBatch: jest.fn(async (batchId: string) => ({
      id: batchId,
      state: "purchased",
      labelUrl: undefined as string | undefined,
    })),
    generateBatchLabel: jest.fn(async (batchId: string) => ({
      id: batchId,
      state: "label_generated",
      labelUrl: `https://easypost.test/batch/${batchId}.pdf`,
    })),
  }

  return { client, shipments, batches, quote }
}

/**
 * Swaps the live EasyPost provider service's client for a fresh fake and
 * returns it. The provider instance is a singleton inside the Fulfillment
 * Module, so this affects every call made through it until replaced again.
 */
export const installFakeEasyPost = (container: MedusaContainer) => {
  const fake = buildFakeEasyPost()
  const provider = resolveEasyPostFulfillmentProvider<any>(container)
  provider.client_ = fake.client
  // Keep batch polling instant in tests.
  provider.options_ = {
    ...provider.options_,
    batchPolling: { intervalMs: 0, timeoutMs: 1_000 },
  }
  return fake
}
