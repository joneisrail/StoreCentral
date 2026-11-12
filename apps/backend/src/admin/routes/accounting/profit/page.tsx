import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui"
import { sdk } from "../../../lib/sdk"
import { formatUsd } from "../../purchases/format"
import { expenseCategoryLabel } from "../expenses/labels"
import type { ProfitReport, SalesGranularity } from "../types"
import {
  DEFAULT_PRESET,
  PRESETS,
  presetRange,
  validateRange,
} from "../range"

const formatMargin = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`

const CARDS: { label: string; value: (r: ProfitReport) => string }[] = [
  { label: "Net revenue", value: (r) => formatUsd(r.summary.net_revenue) },
  { label: "Cost of goods", value: (r) => formatUsd(r.summary.cogs) },
  { label: "Gross profit", value: (r) => formatUsd(r.summary.gross_profit) },
  { label: "Margin", value: (r) => formatMargin(r.summary.margin_pct) },
  { label: "Expenses", value: (r) => formatUsd(r.summary.expenses) },
  { label: "Net profit", value: (r) => formatUsd(r.summary.net_profit) },
  {
    label: "Net margin",
    value: (r) => formatMargin(r.summary.net_margin_pct),
  },
  {
    label: "Units without cost",
    value: (r) => String(r.summary.units_without_cost),
  },
]

const ProfitPage = () => {
  const [initial] = useState(() => presetRange(DEFAULT_PRESET))
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [granularity, setGranularity] = useState<SalesGranularity>("day")

  const rangeError = validateRange(from, to)

  const { data, isPending, isError, isPlaceholderData, refetch } = useQuery({
    queryKey: ["admin", "profit-report", from, to, granularity],
    queryFn: () =>
      sdk.client.fetch<ProfitReport>("/admin/profit-report", {
        query: { from, to, granularity },
      }),
    enabled: rangeError === null,
    placeholderData: keepPreviousData,
  })

  const maxProfit = data
    ? Math.max(0, ...data.trend.map((row) => row.gross_profit))
    : 0
  const isEmpty =
    !!data &&
    data.summary.orders === 0 &&
    data.summary.net_revenue === 0 &&
    data.summary.cogs === 0 &&
    data.by_product.length === 0

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Profit</Heading>
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
          <Text>Something went wrong loading profit.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {data && isPlaceholderData && !rangeError && <Text>Updating...</Text>}

      {data && isEmpty && <Text>No orders in this range</Text>}

      {data && !isEmpty && (
        <div className="flex flex-col gap-6">
          {data.summary.units_without_cost > 0 && (
            <div role="status">
              <Text className="text-ui-fg-error">
                {`${data.summary.units_without_cost} units sold have no purchase cost yet, so their cost is not included.`}
              </Text>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {CARDS.map((card) => (
              <div
                key={card.label}
                data-testid="profit-card"
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
                  <Table.HeaderCell>Net revenue</Table.HeaderCell>
                  <Table.HeaderCell>Cost of goods</Table.HeaderCell>
                  <Table.HeaderCell>Gross profit</Table.HeaderCell>
                  <Table.HeaderCell>Expenses</Table.HeaderCell>
                  <Table.HeaderCell>Net profit</Table.HeaderCell>
                  <Table.HeaderCell>Margin</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.trend.map((row) => {
                  const width =
                    maxProfit > 0
                      ? Math.max(0, (row.gross_profit / maxProfit) * 100)
                      : 0
                  return (
                    <Table.Row key={row.period}>
                      <Table.Cell>{row.period}</Table.Cell>
                      <Table.Cell>{formatUsd(row.net_revenue)}</Table.Cell>
                      <Table.Cell>{formatUsd(row.cogs)}</Table.Cell>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <div className="bg-ui-bg-subtle h-2 w-24 rounded">
                            <div
                              data-testid="profit-bar"
                              className="bg-ui-fg-interactive h-2 rounded"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span>{formatUsd(row.gross_profit)}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>{formatUsd(row.expenses)}</Table.Cell>
                      <Table.Cell>{formatUsd(row.net_profit)}</Table.Cell>
                      <Table.Cell>{formatMargin(row.margin_pct)}</Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>

          {data.expenses_by_category.length > 0 && (
            <div>
              <Heading level="h2">Expenses by category</Heading>
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Category</Table.HeaderCell>
                    <Table.HeaderCell>Amount</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.expenses_by_category.map((row) => (
                    <Table.Row key={row.category}>
                      <Table.Cell>{expenseCategoryLabel(row.category)}</Table.Cell>
                      <Table.Cell>{formatUsd(row.amount)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}

          <div>
            <Heading level="h2">By product</Heading>
            {data.by_product.length === 0 ? (
              <Text>No products sold in this range.</Text>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Product</Table.HeaderCell>
                    <Table.HeaderCell>Units</Table.HeaderCell>
                    <Table.HeaderCell>Revenue</Table.HeaderCell>
                    <Table.HeaderCell>Cost of goods</Table.HeaderCell>
                    <Table.HeaderCell>Gross profit</Table.HeaderCell>
                    <Table.HeaderCell>Margin</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {data.by_product.map((product, index) => (
                    <Table.Row
                      key={`${product.variant_id ?? product.title}-${index}`}
                    >
                      <Table.Cell>{product.title}</Table.Cell>
                      <Table.Cell>{product.units}</Table.Cell>
                      <Table.Cell>{formatUsd(product.revenue)}</Table.Cell>
                      <Table.Cell>{formatUsd(product.cogs)}</Table.Cell>
                      <Table.Cell>{formatUsd(product.gross_profit)}</Table.Cell>
                      <Table.Cell>{formatMargin(product.margin_pct)}</Table.Cell>
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
  label: "Profit",
})

export default ProfitPage
