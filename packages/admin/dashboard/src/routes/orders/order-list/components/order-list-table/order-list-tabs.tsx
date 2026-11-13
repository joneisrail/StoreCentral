import { Badge, Tabs } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"

import { useOrderViewCounts } from "../../../../../hooks/api/order-view-counts"
import { ORDER_VIEW_ORDER, type OrderListView } from "../../order-views"

export const VIEW_QUERY_PARAM = "view"

export type { OrderListView }

/**
 * Reads the order list's active tab from the `view` query param. Falls
 * back to `all` for anything unrecognized (including an absent param),
 * so a stale/typo'd `?view=` value degrades to the default tab rather
 * than rendering nothing.
 */
export const getOrderListView = (
  searchParams: URLSearchParams
): OrderListView => {
  const view = searchParams.get(VIEW_QUERY_PARAM)

  if (view && (ORDER_VIEW_ORDER as string[]).includes(view)) {
    return view as OrderListView
  }

  return "all"
}

/**
 * Builds the href for a tab link: the current search with `view` set to
 * the target tab (or removed entirely for `all`, so the default tab's
 * URL stays param-free). Every other query param (e.g. a tab's own
 * prefixed pagination offset) is preserved untouched - each tab's table
 * reads only its own namespaced params, so there's nothing to collide.
 */
const buildTabHref = (
  view: OrderListView,
  searchParams: URLSearchParams
): string => {
  const next = new URLSearchParams(searchParams)

  if (view === "all") {
    next.delete(VIEW_QUERY_PARAM)
  } else {
    next.set(VIEW_QUERY_PARAM, view)
  }

  const search = next.toString()

  return search ? `?${search}` : ""
}

const VIEW_LABEL_KEYS = {
  all: "orders.list.tabs.all",
  "ready-to-ship": "orders.list.tabs.readyToShip",
  shipped: "orders.list.tabs.shipped",
  "awaiting-payment": "orders.list.tabs.awaitingPayment",
  "on-hold": "orders.list.tabs.onHold",
  cancelled: "orders.list.tabs.cancelled",
} as const satisfies Record<OrderListView, string>

/**
 * The Orders page's tab bar - `All` / `Ready to Ship` / `Shipped` /
 * `Awaiting Payment` / `On Hold` / `Cancelled`, each with a count badge -
 * rendered above the table, matching Veeqo's layout (tabs are page
 * content, not sidebar navigation). Each tab is a real `Link` to a
 * distinct, bookmarkable URL via the `view` query param, not a
 * client-only toggle: switching tabs is a navigation, so the browser's
 * back/forward buttons and direct links to `?view=ready-to-ship` both
 * work.
 */
export const OrderListTabs = () => {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()

  const activeView = getOrderListView(searchParams)
  const { counts } = useOrderViewCounts()

  return (
    <Tabs value={activeView}>
      <Tabs.List>
        {ORDER_VIEW_ORDER.map((view) => {
          const count = counts[view]

          return (
            <Tabs.Trigger key={view} value={view} asChild>
              <Link to={buildTabHref(view, searchParams)}>
                {t(VIEW_LABEL_KEYS[view])}
                <Badge
                  size="2xsmall"
                  rounded="full"
                  data-testid={`order-tab-count-${view}`}
                >
                  {count ?? "–"}
                </Badge>
              </Link>
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>
    </Tabs>
  )
}
