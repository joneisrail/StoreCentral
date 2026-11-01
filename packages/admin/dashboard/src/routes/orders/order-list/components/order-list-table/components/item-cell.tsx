import { HttpTypes } from "@medusajs/types"

import { Thumbnail } from "../../../../../../components/common/thumbnail"
import { TruncatedText } from "../../../../../../components/common/truncated-text"
import { getFulfillableQuantity } from "../../../../../../lib/order-item"

type ItemCellProps = {
  items: HttpTypes.AdminOrderLineItem[]
}

/**
 * Renders every line item's thumbnail, title, and remaining (unfulfilled)
 * quantity, stacked one row per item - the same `getFulfillableQuantity`
 * formula `FulfillConfirmPopover` uses, so the "to ship" quantity shown
 * here can never drift from what a Fulfill click actually submits.
 *
 * Thumbnail fallback (no `item.thumbnail`) and truncation conventions match
 * `ProductCell`/`PackageCell` elsewhere in this table.
 */
export const ItemCell = ({ items }: ItemCellProps) => {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-y-1 overflow-hidden py-1">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-x-2 overflow-hidden">
          <div className="flex-shrink-0">
            <Thumbnail src={item.thumbnail} size="small" />
          </div>
          <TruncatedText text={item.title} />
          <span className="flex-shrink-0 text-ui-fg-subtle">
            {getFulfillableQuantity(item)}x
          </span>
        </div>
      ))}
    </div>
  )
}
