import { Button, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import {
  orderHeldIdsQueryKeys,
  orderTagsQueryKeys,
} from "../../../../../../hooks/api/order-query-keys"
import { queryClient } from "../../../../../../lib/query-client"

/**
 * Inline replacement for a view's table when the hold tag / held-order ids
 * could not be resolved (so held orders can't be reliably excluded). Keeps
 * the surrounding tab bar usable instead of hitting the route error boundary.
 */
export const HoldLookupError = () => {
  const { t } = useTranslation()

  const retry = () => {
    queryClient.refetchQueries({ queryKey: orderTagsQueryKeys.all })
    queryClient.refetchQueries({ queryKey: orderHeldIdsQueryKeys.all })
  }

  return (
    <div
      role="alert"
      className="m-4 flex items-center justify-between gap-x-4 rounded-lg border p-4"
    >
      <Text size="small" className="text-ui-fg-subtle">
        {t("orders.list.holdLookupError")}
      </Text>
      <Button size="small" variant="secondary" onClick={retry}>
        {t("orders.list.holdLookupRetry")}
      </Button>
    </div>
  )
}
