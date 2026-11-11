import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui"
import { sdk } from "../../../lib/sdk"
import { formatUsd } from "../../purchases/format"
import type { SalesGranularity, SalesReport } from "../types"
import {
  DEFAULT_PRESET,
  PRESETS,
  presetRange,
  validateRange,
} from "../range"

const CARDS: { label: string; value: (r: SalesReport) => string }[] = [
  { label: "Orders", value: (r) => String(r.summary.orders) },
  { label: "Units", value: (r) => String(r.summary.units) },
  { label: "Gross sales", value: (r) => formatUsd(r.summary.gross_sales) },
  { label: "Discounts", value: (r) => formatUsd(r.summary.discounts) },
  { label: "Shipping", value: (r) => formatUsd(r.summary.shipping) },
  { label: "Tax", value: (r) => formatUsd(r.summary.tax) },
  { label: "Revenue", value: (r) => formatUsd(r.summary.revenue) },
  { label: "Refunds", value: (r) => formatUsd(r.summary.refunds) },
  { label: "Net revenue", value: (r) => formatUsd(r.summary.net_revenue) },
  {
    label: "Average order value",
    value: (r) => formatUsd(r.summary.average_order_value),
  },
]

const SalesPage = () => {
  const [initial] = useState(() => presetRange(DEFAULT_PRESET))
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [granularity, setGranularity] = useState<SalesGranularity>("day")

  const rangeError = validateRange(from, to)

  const { data, isPending, isError, isPlaceholderData, refetch } = useQuery({
    queryKey: ["admin", "sales-report", from, to, granularity],
    queryFn: () =>
      sdk.client.fetch<SalesReport>("/admin/sales-report", {
        query: { from, to, granularity },
      }),
    enabled: rangeError === null,
    placeholderData: keepPreviousData,
  })

  const maxRevenue = data
    ? Math.max(0, ...data.trend.map((row) => row.revenue))
    : 0
  const isEmpty =
    !!data &&
    data.summary.orders === 0 &&
    data.summary.refunds === 0 &&
    data.top_products.length === 0

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Sales</Heading>
      </div>

      <div className="flex flex-wrap items-end gap-3 py-4">
        {PRESETS.map((days) => (
          <Button
            key={days}
            size="small"
            variant="secondary"
            onClick={() => {
              const range = presetRange(days)
              setFrom(range.from)
              setTo(range.to)
            }}
          >
            {`Last ${days} days`}
          </Button>
        ))}
        <label className="flex flex-col gap-1 text-ui-fg-subtle txt-small">
          From
          <Input
            type="date"
            aria-label="From"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-fg-subtle txt-small">
          To
          <Input
            type="date"
            aria-label="To"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-fg-subtle txt-small">
          Group by
          <select
            aria-label="Granularity"
            className="bg-ui-bg-field text-ui-fg-base border-ui-border-base rounded-md border px-2 py-1.5"
            value={granularity}
            onChange={(event) =>
              setGranularity(event.target.value as SalesGranularity)
            }
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </div>

      {rangeError && (
        <div role="alert" className="pb-4">
          <Text className="text-ui-fg-error">{rangeError}</Text>
        </div>
      )}

      {isPending && !rangeError && <Text>Loading...</Text>}

      {isError && !rangeError && (
        <div>
          <Text>Something went wrong loading sales.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {data && isPlaceholderData && !rangeError && <Text>Updating...</Text>}

      {data && isEmpty && <Text>No orders in this range</Text>}

      {data && !isEmpty && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {CARDS.map((card) => (
              <div
                key={card.label}
                data-testid="sales-card"
                className="border-ui-border-base rounded-md border p-3"
              >
                <Text size="small" className="text-ui-fg-subtle">
                  {card.label}
                </Text>
                <Text weight="plus">{card.value(data)}</Text>
              </div>
            ))}
          </div>

          <div>
            <Heading level="h2">Trend</Heading>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Period</Table.HeaderCell>
                  <Table.HeaderCell>Orders</Table.HeaderCell>
                  <Table.HeaderCell>Revenue</Table.HeaderCell>
                  <Table.HeaderCell>Refunds</Table.HeaderCell>
                  <Table.HeaderCell>Net revenue</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.trend.map((row) => {
                  const width =
                    maxRevenue > 0
                      ? Math.max(0, (row.revenue / maxRevenue) * 100)
                      : 0
                  return (
                    <Table.Row key={row.period}>
                      <Table.Cell>{row.period}</Table.Cell>
                      <Table.Cell>{row.orders}</Table.Cell>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <div className="bg-ui-bg-subtle h-2 w-24 rounded">
                            <div
                              data-testid="revenue-bar"
                              className="bg-ui-fg-interactive h-2 rounded"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span>{formatUsd(row.revenue)}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>{formatUsd(row.refunds)}</Table.Cell>
                      <Table.Cell>{formatUsd(row.net_revenue)}</Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>

          <div>
            <Heading level="h2">Top products</Heading>
            {data.top_products.length === 0 ? (
              <Text>No products sold in this range.</Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Product</Table.HeaderCell>
                    <Table.HeaderCell>Units</Table.HeaderCell>
                    <Table.HeaderCell>Revenue</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.top_products.map((product, index) => (
                    <Table.Row
                      key={`${product.variant_id ?? product.title}-${index}`}
                    >
                      <Table.Cell>{product.title}</Table.Cell>
                      <Table.Cell>{product.quantity}</Table.Cell>
                      <Table.Cell>{formatUsd(product.revenue)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
          </div>
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Sales",
})

export default SalesPage
