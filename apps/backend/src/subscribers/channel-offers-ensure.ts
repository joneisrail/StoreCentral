import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ensureChannelOffersWorkflow } from "../workflows/ensure-channel-offers"

// Keeps a channel offer row for every variant and channel. Best-effort:
// never throws, logs only the id. ensureOffers is idempotent.
export default async function channelOffersEnsure({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const id = event?.data?.id
  const isChannel = event?.name === "sales-channel.created"
  try {
    await ensureChannelOffersWorkflow(container).run({
      input: isChannel ? { sales_channel_id: id } : { variant_id: id },
    })
  } catch {
    try {
      container
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(`Failed to ensure channel offers for ${isChannel ? "channel" : "variant"} ${id}`)
    } catch {
      // No logger available.
    }
  }
}

export const config: SubscriberConfig = {
  event: ["product-variant.created", "sales-channel.created"],
}
