import { useTranslation } from "react-i18next"

import { getViewQuery } from "../../../order-views"
import { ViewOrderTable } from "./view-order-table"

/** The "Cancelled" view: canceled orders. Independent of the hold lookups. */
export const CancelledTable = () => {
  const { t } = useTranslation()

  return (
    <ViewOrderTable
      query={getViewQuery("cancelled", { heldIds: [], holdTagId: null })}
      prefix="cxl"
      noRecordsMessage={t("orders.cancelled.noRecordsMessage")}
    />
  )
}
