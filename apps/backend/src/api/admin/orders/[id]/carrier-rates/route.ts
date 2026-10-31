import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { toEasyPostAddress } from "@dtc/fulfillment-easypost"

type CarrierRatesRequestBody = {
  location_id: string
  parcel: {
    predefined_package?: string
    weight: number
    length?: number
    width?: number
    height?: number
  }
}

type QuotedRate = {
  carrier: string
  service: string
  name: string
  rateId: string
  amount: string
  currency: string
}

// A narrow local type for the two things this route needs off the EasyPost
// provider service, mirroring the same pattern (and the same
// "fp_easypost_easypost" container key -- see that file's top comment for
// why it's not "fp_easypost") used by bulkFulfillOrdersStep
// (packages/core/core-flows/src/order/steps/bulk-fulfill-orders.ts). The
// provider's own `EasyPostAddressInput`/`EasyPostParcelInput` types aren't
// exported from @dtc/fulfillment-easypost, so `toEasyPostAddress`'s return
// type stands in for the address shape instead of re-declaring it.
type EasyPostProviderService = {
  quoteAllRates: (
    parcel: {
      weight: number
      length?: number
      width?: number
      height?: number
      predefinedPackage?: string
    },
    fromAddress: ReturnType<typeof toEasyPostAddress>,
    toAddress: ReturnType<typeof toEasyPostAddress>
  ) => Promise<{ shipmentId: string; rates: QuotedRate[] }>
}

/**
 * Quotes every carrier rate EasyPost can offer for one order's parcel,
 * shipped from the given stock location, sorted cheapest first. Used by the
 * admin "Ready to Ship" bulk-fulfillment tool to let a merchant rate-shop a
 * single order's shipment live before fulfilling it.
 */
export const POST = async (
  req: MedusaRequest<CarrierRatesRequestBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const { location_id, parcel } = req.body

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    filters: { id },
    fields: ["id", "shipping_address.*"],
  })

  const {
    data: [stockLocation],
  } = await query.graph({
    entity: "stock_location",
    filters: { id: location_id },
    fields: ["id", "address.*"],
  })

  let fromAddress: ReturnType<typeof toEasyPostAddress>
  let toAddress: ReturnType<typeof toEasyPostAddress>
  try {
    fromAddress = toEasyPostAddress(stockLocation?.address, "origin")
    toAddress = toEasyPostAddress(order?.shipping_address, "destination")
  } catch (error) {
    if (error instanceof MedusaError) {
      res.status(400).json({ message: error.message })
      return
    }
    throw error
  }

  const provider = req.scope.resolve(
    "fp_easypost_easypost"
  ) as EasyPostProviderService

  const result = await provider.quoteAllRates(
    {
      weight: parcel.weight,
      length: parcel.length,
      width: parcel.width,
      height: parcel.height,
      predefinedPackage: parcel.predefined_package,
    },
    fromAddress,
    toAddress
  )

  res.json({
    shipment_id: result.shipmentId,
    rates: result.rates.map((rate) => ({
      carrier: rate.carrier,
      service: rate.service,
      name: rate.name,
      rate_id: rate.rateId,
      amount: rate.amount,
      currency: rate.currency,
    })),
  })
}
