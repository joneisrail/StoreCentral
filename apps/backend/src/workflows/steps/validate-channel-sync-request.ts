import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { readVariantStock } from "../../modules/channel-offers/available-stock"
import { fetchConnectedChannelIds } from "../../api/admin/channel-offers/connections"
import { SellerHubError } from "../../api/admin/marketplace-connections/seller-hub-client"

export type ChannelSyncInput = { variant_id: string; channel_id: string }

export const NO_CONNECTION_MESSAGE =
  "This sales channel has no marketplace connection, so there is nothing to sync to"

// Read-only: 404 for an unknown channel or variant, 400 when the channel has no
// marketplace connection. A seller-hub outage is reported as such (not as "no
// connection").
export const validateChannelSyncRequestStep = createStep(
  "validate-channel-sync-request",
  async (input: ChannelSyncInput, { container }) => {
    // Throws NOT_FOUND (404) for an unknown channel.
    await container.resolve(Modules.SALES_CHANNEL).retrieveSalesChannel(input.channel_id)
    const variant = await readVariantStock(container, input.variant_id)
    if (!variant.exists) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Variant ${input.variant_id} was not found`)
    }
    let connected: Set<string>
    try {
      connected = await fetchConnectedChannelIds()
    } catch (e) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        e instanceof SellerHubError ? e.message : "Cannot reach seller-hub"
      )
    }
    if (!connected.has(input.channel_id)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, NO_CONNECTION_MESSAGE)
    }
    return new StepResponse({ ok: true })
  }
)
