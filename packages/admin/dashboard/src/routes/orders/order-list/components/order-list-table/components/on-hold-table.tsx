import { HttpTypes } from "@medusajs/types"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { PlaceholderCell } from "../../../../../../components/table/table-cells/common/placeholder-cell"
import { useHoldTag } from "../../../../../../hooks/api/order-holds"
import { getViewQuery } from "../../../order-views"
import { getHoldReason } from "./hold-reason"
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
 * Columns appended after the Reason column. The Release row action is added
 * here by the release task; kept as a named, empty list until then.
 */
const ON_HOLD_ACTION_COLUMNS: ColumnDef<HttpTypes.AdminOrder, any>[] = []

/**
 * The "On Hold" view: orders carrying the hold tag. Only needs the hold tag
 * (not the held ids), so only a tag lookup failure errors this table.
 */
export const OnHoldTable = () => {
  const { t } = useTranslation()
  const { tagId, isLoading, isError } = useHoldTag()
  const reasonColumn = useReasonColumn()

  const extraColumns = useMemo(
    () => [reasonColumn, ...ON_HOLD_ACTION_COLUMNS],
    [reasonColumn]
  )

  return (
    <ViewOrderTable
      query={getViewQuery("on-hold", { heldIds: [], holdTagId: tagId })}
      prefix="hld"
      noRecordsMessage={t("orders.holdTable.noRecordsMessage")}
      extraFields="metadata"
      extraColumns={extraColumns}
      lookupLoading={isLoading}
      lookupError={isError}
    />
  )
}
