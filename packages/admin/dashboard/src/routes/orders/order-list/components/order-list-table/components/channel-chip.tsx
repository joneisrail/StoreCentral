import { Badge } from "@medusajs/ui"

import { getChannelColor } from "../../channel-color"

/**
 * The order's sales channel as a colour-coded chip; the colour is a stable
 * hash of the channel name. A dash when the order has no channel.
 */
export const ChannelChip = ({ name }: { name?: string | null }) => {
  if (!name) {
    return <span className="text-ui-fg-muted">-</span>
  }

  return (
    <Badge color={getChannelColor(name)} size="2xsmall" className="w-fit">
      {name}
    </Badge>
  )
}
