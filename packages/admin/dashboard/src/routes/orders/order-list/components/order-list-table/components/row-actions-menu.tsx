import { HttpTypes } from "@medusajs/types"
import { LockClosedSolid, LockOpenSolid, XCircle } from "@medusajs/icons"
import { toast, usePrompt } from "@medusajs/ui"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ActionMenu } from "../../../../../../components/common/action-menu"
import { useReleaseOrder } from "../../../../../../hooks/api/order-holds"
import { useCancelOrder } from "../../../../../../hooks/api/orders"
import { HoldOrderPrompt } from "./hold-order-prompt"

export type RowActionsMode = "active" | "held"

type RowActionsOrder = Pick<
  HttpTypes.AdminOrder,
  "id" | "display_id" | "fulfillment_status" | "status"
> & { fulfillments?: { id: string }[] | null }

// Allow-list mirroring the backend hold step: only orders that are not yet
// (fully) fulfilled can be held; unknown or missing statuses are not offered.
const HOLDABLE_FULFILLMENT = ["not_fulfilled", "partially_fulfilled"]

/**
 * Per-row actions: Put on hold / Release and Cancel order. Cancel is
 * disabled once a label was bought (any fulfillment), until voiding exists.
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
  const { mutateAsync: releaseOrder } = useReleaseOrder()
  const { mutateAsync: cancelOrder } = useCancelOrder(order.id)

  const id = `#${order.display_id}`
  const hasFulfillment = (order.fulfillments?.length ?? 0) > 0
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

  const actions = [
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
