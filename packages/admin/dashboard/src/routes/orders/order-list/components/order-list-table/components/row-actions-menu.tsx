import { HttpTypes } from "@medusajs/types"
import {
  ArrowUturnLeft,
  LockClosedSolid,
  LockOpenSolid,
  TruckFast,
  XCircle,
} from "@medusajs/icons"
import { toast, usePrompt } from "@medusajs/ui"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ActionMenu } from "../../../../../../components/common/action-menu"
import { useReleaseOrder } from "../../../../../../hooks/api/order-holds"
import { useCancelOrder } from "../../../../../../hooks/api/orders"
import { useVoidOrderLabel } from "../../../../../../hooks/api/order-shipping"
import { HoldOrderPrompt } from "./hold-order-prompt"
import { MarkShippedModal } from "./mark-shipped-modal"
import { hasVoidableLabel, RowActionsFulfillment } from "./void-label"

export type RowActionsMode = "active" | "held" | "shipped"

type RowActionsOrder = Pick<
  HttpTypes.AdminOrder,
  "id" | "display_id" | "fulfillment_status" | "status"
> & {
  payment_status?: string | null
  fulfillments?: RowActionsFulfillment[] | null
}

// Orders that are still waiting to be shipped; `canceled` is the aggregate
// status once every fulfillment (e.g. a voided label) was canceled.
const SHIPPABLE_FULFILLMENT = [
  "not_fulfilled",
  "partially_fulfilled",
  "canceled",
]
const PAID = ["captured", "partially_captured"]

// Allow-list mirroring the backend hold step: only orders that are not yet
// (fully) fulfilled can be held; unknown or missing statuses are not offered.
const HOLDABLE_FULFILLMENT = ["not_fulfilled", "partially_fulfilled"]

/**
 * Per-row actions: Put on hold / Release, Mark shipped, Void label and
 * Cancel order. Cancel is disabled while a non-canceled fulfillment exists
 * (void the label first). The Shipped tab only offers Void label.
 */
export const RowActionsMenu = ({
  order,
  mode,
}: {
  order: RowActionsOrder
  mode: RowActionsMode
}) => {
  const { t } = useTranslation()
  const prompt = usePrompt()
  const [holdOpen, setHoldOpen] = useState(false)
  const [shipOpen, setShipOpen] = useState(false)
  const { mutateAsync: voidLabel } = useVoidOrderLabel()
  const { mutateAsync: releaseOrder } = useReleaseOrder()
  const { mutateAsync: cancelOrder } = useCancelOrder(order.id)

  const id = `#${order.display_id}`
  const hasFulfillment = (order.fulfillments ?? []).some((f) => !f.canceled_at)
  const canVoid = hasVoidableLabel(order.fulfillments)
  const canMarkShipped =
    mode === "active" &&
    order.status !== "canceled" &&
    SHIPPABLE_FULFILLMENT.includes(order.fulfillment_status as string) &&
    (order.payment_status == null || PAID.includes(order.payment_status))
  const canHold =
    mode === "active" &&
    order.status !== "canceled" &&
    HOLDABLE_FULFILLMENT.includes(order.fulfillment_status as string)

  const handleRelease = async () => {
    const ok = await prompt({
      title: t("general.areYouSure"),
      description: t("orders.rowActions.releaseWarning", { id }),
      confirmText: t("actions.continue"),
      cancelText: t("actions.cancel"),
    })

    if (!ok) {
      return
    }

    try {
      await releaseOrder({ id: order.id })
      toast.success(t("orders.rowActions.releaseSuccess"))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleVoid = async () => {
    const ok = await prompt({
      title: t("general.areYouSure"),
      description: t("orders.shipping.voidWarning"),
      confirmText: t("actions.continue"),
      cancelText: t("actions.cancel"),
    })

    if (!ok) {
      return
    }

    try {
      await voidLabel({ id: order.id })
      toast.success(t("orders.shipping.voidSuccess"))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleCancel = async () => {
    if (hasFulfillment) {
      return
    }

    const ok = await prompt({
      title: t("general.areYouSure"),
      description: t("orders.cancelWarning", { id }),
      confirmText: t("actions.continue"),
      cancelText: t("actions.cancel"),
    })

    if (!ok) {
      return
    }

    try {
      await cancelOrder()
      toast.success(t("orders.orderCanceled"))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const voidAction = canVoid
    ? [
        {
          label: t("orders.shipping.voidLabel"),
          icon: <ArrowUturnLeft />,
          onClick: handleVoid,
        },
      ]
    : []

  if (mode === "shipped") {
    if (!canVoid) {
      return null
    }

    return (
      <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
        <ActionMenu groups={[{ actions: voidAction }]} />
      </div>
    )
  }

  const actions = [
    ...(canMarkShipped
      ? [
          {
            label: t("orders.shipping.markShipped"),
            icon: <TruckFast />,
            onClick: () => setShipOpen(true),
          },
        ]
      : []),
    ...voidAction,
    ...(canHold
      ? [
          {
            label: t("orders.rowActions.hold"),
            icon: <LockClosedSolid />,
            onClick: () => setHoldOpen(true),
          },
        ]
      : []),
    ...(mode === "held"
      ? [
          {
            label: t("orders.rowActions.release"),
            icon: <LockOpenSolid />,
            onClick: handleRelease,
          },
        ]
      : []),
    {
      label: t("orders.rowActions.cancel"),
      icon: <XCircle />,
      onClick: handleCancel,
      disabled: hasFulfillment,
      disabledTooltip: hasFulfillment
        ? t("orders.rowActions.cancelDisabled")
        : undefined,
    },
  ]

  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      <ActionMenu groups={[{ actions }]} />
      {canMarkShipped && (
        <MarkShippedModal
          order={order}
          open={shipOpen}
          onOpenChange={setShipOpen}
        />
      )}
      {canHold && (
        <HoldOrderPrompt
          order={order}
          open={holdOpen}
          onOpenChange={setHoldOpen}
        />
      )}
    </div>
  )
}

const columnHelper = createColumnHelper<HttpTypes.AdminOrder>()

const makeActionsColumn = (mode: RowActionsMode) =>
  columnHelper.display({
    id: `row_actions_${mode}`,
    cell: ({ row }) => (
      <RowActionsMenu order={row.original as any} mode={mode} />
    ),
  }) as ColumnDef<HttpTypes.AdminOrder, any>

/** Stable action columns for the small view tables. */
export const ACTIVE_ROW_ACTIONS_COLUMN = makeActionsColumn("active")
export const HELD_ROW_ACTIONS_COLUMN = makeActionsColumn("held")
export const SHIPPED_ROW_ACTIONS_COLUMN = makeActionsColumn("shipped")
