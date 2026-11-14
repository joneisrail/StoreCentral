import { HttpTypes } from "@medusajs/types"
import { keepPreviousData } from "@tanstack/react-query"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { _DataTable } from "../../../../../../components/table/data-table/data-table"
import { DateCell } from "../../../../../../components/table/table-cells/common/date-cell"
import {
  CustomerCell,
  CustomerHeader,
} from "../../../../../../components/table/table-cells/order/customer-cell"
import {
  DisplayIdCell,
  DisplayIdHeader,
} from "../../../../../../components/table/table-cells/order/display-id-cell"
import {
  FulfillmentStatusCell,
  FulfillmentStatusHeader,
} from "../../../../../../components/table/table-cells/order/fulfillment-status-cell"
import {
  PaymentStatusCell,
  PaymentStatusHeader,
} from "../../../../../../components/table/table-cells/order/payment-status-cell"
import {
  TotalCell,
  TotalHeader,
} from "../../../../../../components/table/table-cells/order/total-cell"
import { useOrders } from "../../../../../../hooks/api/orders"
import { useDataTable } from "../../../../../../hooks/use-data-table"
import { DEFAULT_FIELDS } from "../../../const"
import { useTabTableCriteria } from "../use-tab-table-criteria"
import { HoldLookupError } from "./hold-lookup-error"
import { TabTableToolbar } from "./tab-table-toolbar"

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<HttpTypes.AdminOrder>()

type OrderColumn = ColumnDef<HttpTypes.AdminOrder, any>

/**
 * Columns shared by the small view tables (Awaiting Payment, On Hold,
 * Cancelled): order number, customer, created date, total, payment status
 * and fulfillment status. `extraColumns` are appended after them.
 */
const useViewOrderColumns = (extraColumns: OrderColumn[]) => {
  const { t } = useTranslation()

  return useMemo(
    () =>
      [
        columnHelper.accessor("display_id", {
          header: () => <DisplayIdHeader />,
          cell: ({ getValue }) => <DisplayIdCell displayId={getValue()} />,
        }),
        columnHelper.accessor("customer", {
          header: () => <CustomerHeader />,
          cell: ({ getValue }) => <CustomerCell customer={getValue()} />,
        }),
        columnHelper.accessor("created_at", {
          header: () => (
            <div className="flex h-full w-full items-center">
              <span className="truncate">{t("fields.createdAt")}</span>
            </div>
          ),
          cell: ({ getValue }) => <DateCell date={getValue()} />,
        }),
        columnHelper.accessor("total", {
          header: () => <TotalHeader />,
          cell: ({ getValue, row }) => (
            <TotalCell
              currencyCode={row.original.currency_code}
              total={getValue()}
            />
          ),
        }),
        columnHelper.accessor("payment_status", {
          header: () => <PaymentStatusHeader />,
          cell: ({ getValue }) => <PaymentStatusCell status={getValue()} />,
        }),
        columnHelper.accessor("fulfillment_status", {
          header: () => <FulfillmentStatusHeader />,
          cell: ({ getValue }) => <FulfillmentStatusCell status={getValue()} />,
        }),
        ...extraColumns,
      ] as OrderColumn[],
    [t, extraColumns]
  )
}

type ViewOrderTableProps = {
  /** Order list filters for this view, from `getViewQuery`. */
  query: Record<string, unknown>
  /** URL param prefix for this tab's own pagination. */
  prefix: string
  noRecordsMessage: string
  /** Extra order fields to request on top of the default list fields. */
  extraFields?: string
  extraColumns?: OrderColumn[]
  /** Held ids / hold tag still resolving: show loading, do not fetch. */
  lookupLoading?: boolean
  /**
   * The held ids / hold tag lookup failed (or the held set was truncated):
   * the view's filter would be incomplete, so surface an error instead of
   * listing orders that should be excluded.
   */
  lookupError?: boolean
  /** Toolbar filters the tab already fixes (On Hold defines the tag). */
  excludeFilters?: string[]
}

const NO_EXTRA_COLUMNS: OrderColumn[] = []

/**
 * Shared body of the small, read-only order view tabs. Mirrors
 * `ShippedTable`: `useOrders` + `useDataTable` + `_DataTable`, a prefixed
 * offset param, rows linking to the order detail page.
 */
export const ViewOrderTable = ({
  query,
  prefix,
  noRecordsMessage,
  extraFields,
  extraColumns = NO_EXTRA_COLUMNS,
  lookupLoading = false,
  lookupError = false,
  excludeFilters,
}: ViewOrderTableProps) => {
  const { ordersQuery, offset, searchBlocked, searchLoading, toolbarProps } =
    useTabTableCriteria(prefix, query)

  const { orders, count, isLoading, isError, error } = useOrders(
    {
      fields: extraFields ? `${DEFAULT_FIELDS},${extraFields}` : DEFAULT_FIELDS,
      ...ordersQuery,
      limit: PAGE_SIZE,
      offset,
      order: "-created_at",
    } as HttpTypes.AdminOrderFilters,
    {
      placeholderData: keepPreviousData,
      enabled: !lookupLoading && !lookupError && !searchBlocked,
    }
  )

  const columns = useViewOrderColumns(extraColumns)

  const { table } = useDataTable({
    data: searchBlocked ? [] : (orders ?? []),
    columns,
    count: searchBlocked ? 0 : count,
    enablePagination: true,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    prefix,
  })

  if (lookupError) {
    return <HoldLookupError />
  }

  if (isError) {
    throw error
  }

  return (
    <>
      <TabTableToolbar {...toolbarProps} excludeFilters={excludeFilters} />
      <_DataTable
        columns={columns}
        table={table}
        pagination
        navigateTo={(row) => `/orders/${row.original.id}`}
        count={searchBlocked ? 0 : count}
        isLoading={isLoading || lookupLoading || searchLoading}
        pageSize={PAGE_SIZE}
        prefix={prefix}
        noRecords={{ message: noRecordsMessage }}
      />
    </>
  )
}
