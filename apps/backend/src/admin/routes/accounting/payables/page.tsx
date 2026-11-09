import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import { formatUsd } from "../../purchases/format"
import type { SupplierBalance } from "../types"

type BalancesResponse = {
  balances: SupplierBalance[]
  count: number
  offset: number
  limit: number
}

const LIMIT = 20
const SEARCH_DEBOUNCE_MS = 300

const PayablesPage = () => {
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const appliedQ = useRef("")

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "supplier-balances", q, offset],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (q) {
        query.q = q
      }
      return sdk.client.fetch<BalancesResponse>("/admin/supplier-balances", {
        query,
      })
    },
  })

  const applySearch = (value: string) => {
    const next = value.trim()
    if (next === appliedQ.current) {
      return
    }
    appliedQ.current = next
    setQ(next)
    setOffset(0)
  }

  useEffect(() => {
    const timer = setTimeout(() => applySearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const count = data?.count
  useEffect(() => {
    if (count === undefined || offset === 0 || offset < count) {
      return
    }
    setOffset(count === 0 ? 0 : Math.floor((count - 1) / LIMIT) * LIMIT)
  }, [count, offset])

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Payables</Heading>
      </div>

      <div className="py-4">
        <Input
          type="search"
          placeholder="Search by supplier name"
          aria-label="Search suppliers"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applySearch(search)
            }
          }}
        />
      </div>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading payables.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.balances.length === 0 && (
        <Text>
          {q ? "No suppliers match your search." : "No supplier balances yet."}
        </Text>
      )}

      {!isLoading && !isError && data && data.balances.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Supplier</Table.HeaderCell>
              <Table.HeaderCell>Invoiced</Table.HeaderCell>
              <Table.HeaderCell>Paid</Table.HeaderCell>
              <Table.HeaderCell>Owed</Table.HeaderCell>
              <Table.HeaderCell>Overdue</Table.HeaderCell>
              <Table.HeaderCell>Open invoices</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.balances.map((row) => (
              <Table.Row key={row.supplier.id}>
                <Table.Cell>
                  <Link
                    to={`/accounting/invoices?supplier_id=${encodeURIComponent(
                      row.supplier.id
                    )}`}
                  >
                    {row.supplier.name}
                  </Link>
                </Table.Cell>
                <Table.Cell>{formatUsd(row.invoiced_total)}</Table.Cell>
                <Table.Cell>{formatUsd(row.paid_total)}</Table.Cell>
                <Table.Cell>{formatUsd(row.balance_owed)}</Table.Cell>
                <Table.Cell>
                  {row.overdue_total > 0 ? (
                    <span
                      data-testid="overdue-amount"
                      className="text-ui-fg-error font-medium"
                    >
                      {formatUsd(row.overdue_total)}
                    </span>
                  ) : (
                    formatUsd(row.overdue_total)
                  )}
                </Table.Cell>
                <Table.Cell>{row.open_invoices}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {!isLoading && !isError && data && (
        <div className="flex gap-2 pt-4">
          <Button
            size="small"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Previous
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={offset + LIMIT >= data.count}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Next
          </Button>
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Payables",
})

export default PayablesPage
