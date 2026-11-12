import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import { formatUsd } from "../../purchases/format"
import type {
  ProfitReport,
  SalesGranularity,
  SupplierBalanceTotals,
} from "../types"
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
  { label: "Gross profit", value: (r) => formatUsd(r.summary.gross_profit) },
  { label: "Expenses", value: (r) => formatUsd(r.summary.expenses) },
  { label: "Net profit", value: (r) => formatUsd(r.summary.net_profit) },
  {
    label: "Net margin",
    value: (r) => formatMargin(r.summary.net_margin_pct),
  },
]

const ProfitSection = () => {
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
    ? Math.max(0, ...data.trend.map((row) => row.net_profit))
    : 0
  const isEmpty =
    !!data &&
    data.summary.orders === 0 &&
    data.summary.net_revenue === 0 &&
    data.summary.cogs === 0 &&
    data.summary.expenses === 0 &&
    data.by_product.length === 0 &&
    data.expenses_by_category.length === 0

  return (
    <Container data-testid="profit-section">
      <Heading level="h2">Profit</Heading>

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

      {data && isEmpty && <Text>No orders or expenses in this range</Text>}

      {data && !isEmpty && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {CARDS.map((card) => (
              <div
                key={card.label}
                data-testid="overview-profit-card"
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
            <Heading level="h3">Trend</Heading>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Period</Table.HeaderCell>
                  <Table.HeaderCell>Net revenue</Table.HeaderCell>
                  <Table.HeaderCell>Net profit</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.trend.map((row) => {
                  const width =
                    maxProfit > 0
                      ? Math.max(0, (row.net_profit / maxProfit) * 100)
                      : 0
                  return (
                    <Table.Row key={row.period}>
                      <Table.Cell>{row.period}</Table.Cell>
                      <Table.Cell>{formatUsd(row.net_revenue)}</Table.Cell>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <div className="bg-ui-bg-subtle h-2 w-24 rounded">
                            <div
                              data-testid="profit-bar"
                              className="bg-ui-fg-interactive h-2 rounded"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span>{formatUsd(row.net_profit)}</span>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>
        </div>
      )}
    </Container>
  )
}

const OWED_CARDS: {
  label: string
  value: (t: SupplierBalanceTotals) => string
}[] = [
  { label: "Total owed", value: (t) => formatUsd(t.balance_owed) },
  { label: "Overdue", value: (t) => formatUsd(t.overdue_total) },
  { label: "Open invoices", value: (t) => String(t.open_invoices) },
]

const OwedSection = () => {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin", "supplier-balances", "totals"],
    queryFn: () =>
      sdk.client.fetch<{ totals: SupplierBalanceTotals }>(
        "/admin/supplier-balances",
        { query: { limit: 1 } }
      ),
  })

  return (
    <Container data-testid="owed-section">
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h2">Owed to suppliers</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            As of today
          </Text>
        </div>
        <Link to="/accounting/payables" className="text-ui-fg-interactive">
          Payables
        </Link>
      </div>

      {isPending && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading money owed.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-3 py-4 md:grid-cols-3">
          {OWED_CARDS.map((card) => (
            <div
              key={card.label}
              data-testid="overview-owed-card"
              className="border-ui-border-base rounded-md border p-3"
            >
              <Text size="small" className="text-ui-fg-subtle">
                {card.label}
              </Text>
              <Text weight="plus">{card.value(data.totals)}</Text>
            </div>
          ))}
        </div>
      )}
    </Container>
  )
}

const OverviewPage = () => (
  <div className="flex flex-col gap-4">
    <Container>
      <Heading level="h1">Overview</Heading>
    </Container>
    <ProfitSection />
    <OwedSection />
  </div>
)

export const config = defineRouteConfig({
  label: "Overview",
})

export default OverviewPage
