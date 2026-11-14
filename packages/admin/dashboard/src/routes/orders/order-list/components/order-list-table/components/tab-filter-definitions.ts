import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import type { Filter } from "../../../../../../components/table/data-table"
import { useOrderTags } from "../../../../../../hooks/api/order-tags"
import { useRegions } from "../../../../../../hooks/api/regions"
import { useSalesChannels } from "../../../../../../hooks/api/sales-channels"
import { useStockLocations } from "../../../../../../hooks/api/stock-locations"

/** URL param of a filter key is `${prefix}_f_<key>` (see useTabTableQuery). */
export const FILTER_KEY_PREFIX = "f_"

const COUNTRY_CODES = ["US", "CA", "GB", "AU", "DE", "FR"]
const CARRIERS = ["UPS", "FedEx", "USPS", "DHL"]

/**
 * Filter definitions for the tab tables. Keys are `f_<name>` so the existing
 * filter components store them under `${prefix}_f_<name>`, which is what
 * `useTabTableQuery` reads. `exclude` drops filters a tab already fixes
 * (e.g. the On Hold tab is defined by its tag).
 */
export const useTabFilters = (exclude: string[] = []): Filter[] => {
  const { t } = useTranslation()

  const { regions } = useRegions({ limit: 1000, fields: "id,name" })
  const { sales_channels } = useSalesChannels({
    limit: 1000,
    fields: "id,name",
  })
  const { order_tags: tags } = useOrderTags({ limit: 1000, fields: "id,value" })
  const { stock_locations } = useStockLocations({
    limit: 1000,
    fields: "id,name",
  })

  const excludeKey = exclude.join(",")

  return useMemo(() => {
    const filters: Filter[] = [
      {
        key: "f_created_at",
        label: t("orders.list.filters.orderDate"),
        type: "date",
      },
      {
        key: "f_payment_status",
        label: t("orders.list.filters.paymentStatus"),
        type: "select",
        multiple: true,
        options: [
          { label: t("orders.payment.status.notPaid"), value: "not_paid" },
          { label: t("orders.payment.status.awaiting"), value: "awaiting" },
          { label: t("orders.payment.status.authorized"), value: "authorized" },
          {
            label: t("orders.payment.status.partiallyAuthorized"),
            value: "partially_authorized",
          },
          { label: t("orders.payment.status.captured"), value: "captured" },
          {
            label: t("orders.payment.status.partiallyCaptured"),
            value: "partially_captured",
          },
          {
            label: t("orders.payment.status.partiallyRefunded"),
            value: "partially_refunded",
          },
          { label: t("orders.payment.status.refunded"), value: "refunded" },
          { label: t("orders.payment.status.canceled"), value: "canceled" },
          {
            label: t("orders.payment.status.requiresAction"),
            value: "requires_action",
          },
        ],
      },
      {
        key: "f_fulfillment_status",
        label: t("orders.list.filters.fulfillmentStatus"),
        type: "select",
        multiple: true,
        options: [
          {
            label: t("orders.fulfillment.status.notFulfilled"),
            value: "not_fulfilled",
          },
          {
            label: t("orders.fulfillment.status.partiallyFulfilled"),
            value: "partially_fulfilled",
          },
          {
            label: t("orders.fulfillment.status.fulfilled"),
            value: "fulfilled",
          },
          {
            label: t("orders.fulfillment.status.partiallyShipped"),
            value: "partially_shipped",
          },
          { label: t("orders.fulfillment.status.shipped"), value: "shipped" },
          {
            label: t("orders.fulfillment.status.partiallyDelivered"),
            value: "partially_delivered",
          },
          {
            label: t("orders.fulfillment.status.delivered"),
            value: "delivered",
          },
          {
            label: t("orders.fulfillment.status.partiallyReturned"),
            value: "partially_returned",
          },
          { label: t("orders.fulfillment.status.returned"), value: "returned" },
          { label: t("orders.fulfillment.status.canceled"), value: "canceled" },
        ],
      },
      {
        key: "f_sales_channel_id",
        label: t("fields.salesChannel"),
        type: "select",
        multiple: true,
        searchable: true,
        options: (sales_channels ?? []).map((s) => ({
          label: s.name,
          value: s.id,
        })),
      },
      {
        key: "f_tag_id",
        label: t("fields.tags"),
        type: "select",
        multiple: true,
        searchable: true,
        options: (tags ?? []).map((tag) => ({
          label: tag.value,
          value: tag.id,
        })),
      },
      {
        key: "f_region_id",
        label: t("fields.region"),
        type: "select",
        multiple: true,
        searchable: true,
        options: (regions ?? []).map((r) => ({ label: r.name, value: r.id })),
      },
      {
        key: "f_country",
        label: t("orders.list.filters.country"),
        type: "select",
        options: COUNTRY_CODES.map((c) => ({ label: c, value: c })),
      },
      {
        key: "f_country_other",
        label: t("orders.list.filters.countryOther"),
        type: "string",
      },
      {
        key: "f_total",
        label: t("orders.list.filters.total"),
        type: "number",
      },
      {
        key: "f_carrier",
        label: t("orders.list.filters.carrier"),
        type: "select",
        options: CARRIERS.map((c) => ({ label: c, value: c })),
      },
      {
        key: "f_carrier_other",
        label: t("orders.list.filters.carrierOther"),
        type: "string",
      },
      {
        key: "f_ship_from",
        label: t("orders.list.filters.shipFrom"),
        type: "select",
        searchable: true,
        options: (stock_locations ?? []).map((l) => ({
          label: l.name,
          value: l.id,
        })),
      },
      {
        key: "f_delivery",
        label: t("orders.list.filters.delivery"),
        type: "string",
      },
      {
        key: "f_sku",
        label: t("orders.list.filters.sku"),
        type: "string",
      },
    ]

    const dropped = new Set(excludeKey ? excludeKey.split(",") : [])
    return filters.filter(
      (f) => !dropped.has(f.key.slice(FILTER_KEY_PREFIX.length))
    )
  }, [t, regions, sales_channels, tags, stock_locations, excludeKey])
}
