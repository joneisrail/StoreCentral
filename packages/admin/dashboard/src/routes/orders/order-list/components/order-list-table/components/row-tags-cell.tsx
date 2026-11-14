import { Plus } from "@medusajs/icons"
import { Badge, IconButton } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { BulkTagOrdersModal } from "./bulk-tag-orders-modal"
import { RowLinkGuard } from "./row-link-guard"

const TAG_COLORS = ["blue", "green", "orange", "purple", "red", "grey"] as const

const tagColor = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return TAG_COLORS[hash % TAG_COLORS.length]
}

type RowTagsCellProps = {
  orderId: string
  tags?: { id: string; value: string }[] | null
}

/**
 * The order's tags as coloured chips plus a "+" that opens the existing
 * bulk-tag modal scoped to just this order.
 */
export const RowTagsCell = ({ orderId, tags }: RowTagsCellProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-full w-full flex-wrap items-center gap-1 py-1">
      {(tags ?? []).map((tag) => (
        <Badge
          key={tag.id}
          color={tagColor(tag.value)}
          size="2xsmall"
          className="w-fit"
        >
          {tag.value}
        </Badge>
      ))}
      <RowLinkGuard>
        <IconButton
          size="2xsmall"
          variant="transparent"
          type="button"
          aria-label={t("orders.tags.addToOrder")}
          onClick={() => setOpen(true)}
        >
          <Plus />
        </IconButton>
      </RowLinkGuard>
      {open && (
        <RowLinkGuard>
          <BulkTagOrdersModal
            action={{ mode: "add", orderIds: [orderId] }}
            onClose={() => setOpen(false)}
          />
        </RowLinkGuard>
      )}
    </div>
  )
}
