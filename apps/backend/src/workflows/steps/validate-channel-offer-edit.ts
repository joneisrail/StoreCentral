import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { readVariantStock } from "../../modules/channel-offers/available-stock"

export type ChannelOfferEditInput = {
  variant_id: string
  channel_id: string
  price?: number | null
  stock?: number
}

export type ChannelOfferEditKind = "stock" | "price" | "both"

export const NO_STOCK_TRACKING_MESSAGE =
  "This variant does not manage inventory, so channel stock cannot be edited"

// Read-only early answer. The over-allocation check needs the variant lock and
// runs again, authoritatively, in applyChannelOfferEditStep.
export const validateChannelOfferEditStep = createStep(
  "validate-channel-offer-edit",
  async (input: ChannelOfferEditInput, { container }) => {
    const hasPrice = input.price !== undefined
    const hasStock = input.stock !== undefined
    if (!hasPrice && !hasStock) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Provide a price or stock to update"
      )
    }
    if (hasStock && !(Number.isInteger(input.stock) && (input.stock as number) >= 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Stock must be a whole number of at least 0"
      )
    }
    if (input.price != null && !(Number(input.price) >= 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Price must be at least 0, or null to clear it"
      )
    }

    // Throws NOT_FOUND (404) for an unknown channel.
    await container
      .resolve(Modules.SALES_CHANNEL)
      .retrieveSalesChannel(input.channel_id)

    const variant = await readVariantStock(container, input.variant_id)
    if (!variant.exists) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Variant ${input.variant_id} was not found`
      )
    }
    if (hasStock && !variant.managed) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        NO_STOCK_TRACKING_MESSAGE
      )
    }

    const kind: ChannelOfferEditKind =
      hasPrice && hasStock ? "both" : hasStock ? "stock" : "price"
    return new StepResponse({ kind })
  }
)
