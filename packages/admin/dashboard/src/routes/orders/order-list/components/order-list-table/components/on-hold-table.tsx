import { HttpTypes } from "@medusajs/types"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { PlaceholderCell } from "../../../../../../components/table/table-cells/common/placeholder-cell"
import { useHoldTag } from "../../../../../../hooks/api/order-holds"
import { ROW_ACTION_FULFILLMENT_FIELDS } from "../../../const"
import { getViewQuery } from "../../../order-views"
import { getHoldReason } from "./hold-reason"
import { HELD_ROW_ACTIONS_COLUMN } from "./row-actions-menu"
import { ViewOrderTable } from "./view-order-table"

const columnHelper = createColumnHelper<HttpTypes.AdminOrder>()

const useReasonColumn = () => {
  const { t } = useTranslation()

  return useMemo(
    () =>
      columnHelper.display({
        id: "hold_reason",
        header: () => (
          <div className="flex h-full w-full items-center">
            <span className="truncate">{t("orders.holdTable.reason")}</span>
          </div>
        ),
        cell: ({ row }) => {
          const reason = getHoldReason(row.original.metadata)

          return reason ? (
            <div className="flex h-full w-full items-center overflow-hidden">
              <span className="truncate">{reason}</span>
            </div>
          ) : (
            <PlaceholderCell />
          )
        },
      }) as ColumnDef<HttpTypes.AdminOrder, any>,
    [t]
  )
}

/**
 * The "On Hold" view: orders carrying the hold tag. Only needs the hold tag
 * (not the held ids), so only a tag lookup failure errors this table.
 */
export const OnHoldTable = () => {
  const { t } = useTranslation()
  const { tagId, isLoading, isError } = useHoldTag()
  const reasonColumn = useReasonColumn()

  const extraColumns = useMemo(
    () => [reasonColumn, HELD_ROW_ACTIONS_COLUMN],
    [reasonColumn]
  )

  return (
    <ViewOrderTable
      query={getViewQuery("on-hold", { heldIds: [], holdTagId: tagId })}
      prefix="hld"
      noRecordsMessage={t("orders.holdTable.noRecordsMessage")}
      extraFields={`metadata,${ROW_ACTION_FULFILLMENT_FIELDS.join(",")}`}
      extraColumns={extraColumns}
      lookupLoading={isLoading}
      lookupError={isError}
    />
  )
}
