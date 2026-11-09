import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Table,
  Tabs,
  Text,
} from "@medusajs/ui"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import { formatUsd } from "../../purchases/format"
import {
  formatInvoiceDate,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  paymentMethodLabel,
  paymentStatusColor,
  paymentStatusLabel,
} from "../format"
import type { AdminPayment, PaymentMethod, PaymentStatus } from "../types"

type PaymentsResponse = {
  payments: AdminPayment[]
  count: number
  offset: number
  limit: number
}

type StatusFilter = "all" | PaymentStatus
type MethodFilter = "all" | PaymentMethod

const LIMIT = 20
const SEARCH_DEBOUNCE_MS = 300

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: PAYMENT_STATUS_LABELS.recorded, value: "recorded" },
  { label: PAYMENT_STATUS_LABELS.void, value: "void" },
]

const METHOD_OPTIONS: { label: string; value: MethodFilter }[] = [
  { label: "All methods", value: "all" },
  ...(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((value) => ({
    label: PAYMENT_METHOD_LABELS[value],
    value,
  })),
]

const PaymentsPage = () => {
  const [status, setStatus] = useState<StatusFilter>("all")
  const [method, setMethod] = useState<MethodFilter>("all")
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const appliedQ = useRef("")

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "supplier-payments", status, method, q, offset],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (status !== "all") {
        query.status = status
      }
      if (method !== "all") {
        query.method = method
      }
      if (q) {
        query.q = q
      }
      return sdk.client.fetch<PaymentsResponse>("/admin/supplier-payments", {
        query,
      })
    },
  })

  // Applying a search term that differs from the current one resets the page.
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

  // If the count shrinks below the current page, step back to the last page
  // that still has rows.
  const count = data?.count
  useEffect(() => {
    if (count === undefined || offset === 0 || offset < count) {
      return
    }
    setOffset(count === 0 ? 0 : Math.floor((count - 1) / LIMIT) * LIMIT)
  }, [count, offset])

  const handleTabChange = (value: string) => {
    setStatus(value as StatusFilter)
    setOffset(0)
  }

  const handleMethodChange = (value: string) => {
    setMethod(value as MethodFilter)
    setOffset(0)
  }

  const filtered = status !== "all" || method !== "all"

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Payments</Heading>
      </div>

      <div className="flex gap-2 py-4">
        <Input
          type="search"
          placeholder="Search by payment reference"
          aria-label="Search payments"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applySearch(search)
            }
          }}
        />
        <select
          aria-label="Filter by method"
          className="bg-ui-bg-field text-ui-fg-base shadow-borders-base rounded-md px-2 text-sm"
          value={method}
          onChange={(event) => handleMethodChange(event.target.value)}
        >
          {METHOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Tabs value={status} onValueChange={handleTabChange}>
        <Tabs.List>
          {STATUS_TABS.map((tab) => (
            <Tabs.Trigger key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading payments.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.payments.length === 0 && (
        <Text>
          {q || filtered
            ? "No payments match your filters."
            : "No payments yet."}
        </Text>
      )}

      {!isLoading && !isError && data && data.payments.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Reference</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Supplier</Table.HeaderCell>
              <Table.HeaderCell>Invoice</Table.HeaderCell>
              <Table.HeaderCell>Method</Table.HeaderCell>
              <Table.HeaderCell>Amount</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.payments.map((payment) => (
              <Table.Row key={payment.id}>
                <Table.Cell>{payment.reference}</Table.Cell>
                <Table.Cell>{formatInvoiceDate(payment.paid_at)}</Table.Cell>
                <Table.Cell>{payment.supplier?.name ?? "—"}</Table.Cell>
                <Table.Cell>
                  {payment.invoice ? (
                    <Link to={`/accounting/invoices/${payment.invoice.id}`}>
                      {payment.invoice.reference} (
                      {payment.invoice.invoice_number})
                    </Link>
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell>{paymentMethodLabel(payment.method)}</Table.Cell>
                <Table.Cell>{formatUsd(payment.amount)}</Table.Cell>
                <Table.Cell>
                  <Badge color={paymentStatusColor(payment.status)}>
                    {paymentStatusLabel(payment.status)}
                  </Badge>
                </Table.Cell>
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
  label: "Payments",
})

export default PaymentsPage
