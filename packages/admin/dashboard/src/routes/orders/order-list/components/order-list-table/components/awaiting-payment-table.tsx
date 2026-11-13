import { useTranslation } from "react-i18next"

import {
  useHeldOrderIds,
  useHoldTag,
} from "../../../../../../hooks/api/order-holds"
import { getViewQuery } from "../../../order-views"
import { ViewOrderTable } from "./view-order-table"

/**
 * The "Awaiting Payment" view: unpaid, non-canceled orders, excluding held
 * orders. If the held-order lookup failed the exclusion would be
 * incomplete, so the table errors instead of listing held orders.
 */
export const AwaitingPaymentTable = () => {
  const { t } = useTranslation()
  const { tagId, isLoading: tagLoading, isError: tagError } = useHoldTag()
  const { ids, isLoading: heldLoading, isError: heldError } = useHeldOrderIds()

  return (
    <ViewOrderTable
      query={getViewQuery("awaiting-payment", {
        heldIds: ids,
        holdTagId: tagId,
      })}
      prefix="awp"
      noRecordsMessage={t("orders.awaitingPayment.noRecordsMessage")}
      lookupLoading={tagLoading || heldLoading}
      lookupError={tagError || heldError}
    />
  )
}
