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
import { Link, useSearchParams } from "react-router-dom"
import { sdk } from "../../../lib/sdk"
import { formatUsd } from "../../purchases/format"
import {
  formatInvoiceDate,
  formatMoneyOrDash,
  invoicePaymentStatusColor,
  invoicePaymentStatusLabel,
  INVOICE_STATUS_COLORS,
  INVOICE_STATUS_LABELS,
} from "../format"
import type { AdminInvoice, InvoiceStatus } from "../types"

type InvoicesResponse = {
  invoices: AdminInvoice[]
  count: number
  offset: number
  limit: number
}

type StatusFilter = "all" | InvoiceStatus
type PaymentFilter = "all" | "unpaid" | "partially_paid" | "paid" | "overdue"

const LIMIT = 20
const SEARCH_DEBOUNCE_MS = 300

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: INVOICE_STATUS_LABELS.draft, value: "draft" },
  { label: INVOICE_STATUS_LABELS.posted, value: "posted" },
  { label: INVOICE_STATUS_LABELS.void, value: "void" },
]

const PAYMENT_FILTER_OPTIONS: { label: string; value: PaymentFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unpaid", value: "unpaid" },
  { label: "Part paid", value: "partially_paid" },
  { label: "Paid", value: "paid" },
  { label: "Overdue", value: "overdue" },
]

const EMPTY_STATE_TEXT: Record<StatusFilter, string> = {
  all: "No invoices yet.",
  draft: "No draft invoices.",
  posted: "No posted invoices.",
  void: "No void invoices.",
}

const InvoicesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const supplierId = searchParams.get("supplier_id") || ""
  const [status, setStatus] = useState<StatusFilter>("all")
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all")
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const appliedQ = useRef("")

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [
      "admin",
      "invoices",
      status,
      paymentFilter,
      q,
      supplierId,
      offset,
    ],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (status !== "all") {
        query.status = status
      }
      if (paymentFilter !== "all") {
        query.payment_status = paymentFilter
      }
      if (q) {
        query.q = q
      }
      if (supplierId) {
        query.supplier_id = supplierId
      }
      return sdk.client.fetch<InvoicesResponse>("/admin/invoices", { query })
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

  const handlePaymentFilterChange = (value: string) => {
    setPaymentFilter(value as PaymentFilter)
    setOffset(0)
  }

  const clearSupplierFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("supplier_id")
    setSearchParams(next)
    setOffset(0)
  }

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Invoices</Heading>
        <Button size="small" asChild>
          <Link to="/accounting/invoices/new">New invoice</Link>
        </Button>
      </div>

      <div className="flex gap-2 py-4">
        <Input
          type="search"
          placeholder="Search by supplier invoice number"
          aria-label="Search invoices"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applySearch(search)
            }
          }}
        />
        <select
          aria-label="Filter by payment status"
          className="bg-ui-bg-field text-ui-fg-base shadow-borders-base rounded-md px-2 text-sm"
          value={paymentFilter}
          onChange={(event) => handlePaymentFilterChange(event.target.value)}
        >
          {PAYMENT_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {supplierId && (
        <div className="flex items-center gap-2 pb-4">
          <Badge color="blue">Filtered by supplier</Badge>
          <Button
            size="small"
            variant="transparent"
            onClick={clearSupplierFilter}
          >
            Clear supplier filter
          </Button>
        </div>
      )}

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
          <Text>Something went wrong loading invoices.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.invoices.length === 0 && (
        <Text>
          {q
            ? "No invoices match your search."
            : paymentFilter !== "all"
              ? "No invoices match this payment filter."
              : EMPTY_STATE_TEXT[status]}
        </Text>
      )}

      {!isLoading && !isError && data && data.invoices.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Reference</Table.HeaderCell>
              <Table.HeaderCell>Supplier</Table.HeaderCell>
              <Table.HeaderCell>Supplier invoice #</Table.HeaderCell>
              <Table.HeaderCell>Purchase</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
              <Table.HeaderCell>Paid</Table.HeaderCell>
              <Table.HeaderCell>Balance</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Payment</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.invoices.map((invoice) => (
              <Table.Row key={invoice.id}>
                <Table.Cell>
                  <Link to={`/accounting/invoices/${invoice.id}`}>
                    {invoice.reference}
                  </Link>
                </Table.Cell>
                <Table.Cell>{invoice.supplier?.name ?? "—"}</Table.Cell>
                <Table.Cell>{invoice.invoice_number}</Table.Cell>
                <Table.Cell>{invoice.purchase?.reference ?? "—"}</Table.Cell>
                <Table.Cell>{formatInvoiceDate(invoice.invoice_date)}</Table.Cell>
                <Table.Cell>{formatUsd(invoice.total)}</Table.Cell>
                <Table.Cell>
                  {formatMoneyOrDash(invoice.paid_total, formatUsd)}
                </Table.Cell>
                <Table.Cell>
                  {formatMoneyOrDash(invoice.balance, formatUsd)}
                </Table.Cell>
                <Table.Cell>
                  <Badge color={INVOICE_STATUS_COLORS[invoice.status]}>
                    {INVOICE_STATUS_LABELS[invoice.status]}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex gap-1">
                    {invoice.payment_status && (
                      <Badge
                        data-testid="payment-status"
                        color={invoicePaymentStatusColor(invoice.payment_status)}
                      >
                        {invoicePaymentStatusLabel(invoice.payment_status)}
                      </Badge>
                    )}
                    {invoice.payment_status && invoice.overdue && (
                      <Badge data-testid="overdue" color="red">
                        Overdue
                      </Badge>
                    )}
                  </div>
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
  label: "Invoices",
})

export default InvoicesPage
