import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Link, useParams } from "react-router-dom"
import { sdk } from "../../../../lib/sdk"
import { errorMessage, formatUsd } from "../../../purchases/format"
import {
  formatInvoiceDate,
  formatMoneyOrDash,
  invoicePaymentStatusColor,
  invoicePaymentStatusLabel,
  INVOICE_STATUS_COLORS,
  INVOICE_STATUS_LABELS,
} from "../../format"
import type {
  AdminInvoice,
  AdminPayment,
  InvoiceComparison,
} from "../../types"
import { Comparison } from "./components/comparison"
import { EditForm } from "./components/edit-form"
import { PaymentsSection } from "./components/payments-section"
import {
  RecordPaymentDialog,
  type PaymentBody,
} from "./components/record-payment-dialog"

type InvoiceResponse = {
  invoice: AdminInvoice
  comparison: InvoiceComparison | null
  payments?: AdminPayment[]
}

const NO_PAYMENTS: AdminPayment[] = []

type Action = "post" | "void"

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : null

const SummaryRow = ({
  label,
  value,
  testId,
  strong,
}: {
  label: string
  value: string
  testId: string
  strong?: boolean
}) => (
  <div className="flex items-center justify-between">
    <Text size="small" weight={strong ? "plus" : "regular"}>
      {label}
    </Text>
    <Text size="small" weight={strong ? "plus" : "regular"} data-testid={testId}>
      {value}
    </Text>
  </div>
)

const InvoiceView = ({
  invoice,
  comparison,
  payments,
}: {
  invoice: AdminInvoice
  comparison: InvoiceComparison | null
  payments: AdminPayment[]
}) => {
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const closeEditor = () => {
    setEditing(false)
    setDirty(false)
    setSaving(false)
  }

  const invalidateAll = () => {
    for (const key of [
      "invoices",
      "supplier-payments",
      "supplier-balances",
      "purchase-invoices",
      "invoice-purchase-options",
    ]) {
      queryClient.invalidateQueries({ queryKey: ["admin", key] })
    }
  }

  const runAction = useMutation({
    mutationFn: (action: Action) =>
      sdk.client.fetch<{ invoice: AdminInvoice }>(
        `/admin/invoices/${invoice.id}/${action}`,
        { method: "POST" }
      ),
    onMutate: () => setActionError(null),
    onSuccess: (_result, action) => {
      toast.success(action === "post" ? "Invoice posted" : "Invoice voided")
      invalidateAll()
    },
    onError: (error: unknown) => {
      const message = errorMessage(error, "The action failed.")
      setActionError(message)
      toast.error(message)
    },
  })

  const recordPayment = useMutation({
    mutationFn: (body: PaymentBody) =>
      sdk.client.fetch<{ payment: AdminPayment }>("/admin/supplier-payments", {
        method: "POST",
        body,
      }),
    onMutate: () => setPaymentError(null),
    onSuccess: () => {
      toast.success("Payment recorded")
      setPaymentOpen(false)
      invalidateAll()
    },
    onError: (error: unknown) => {
      setPaymentError(errorMessage(error, "Failed to record the payment."))
    },
  })

  const voidPayment = useMutation({
    mutationFn: (payment: AdminPayment) =>
      sdk.client.fetch<{ payment: AdminPayment }>(
        `/admin/supplier-payments/${payment.id}/void`,
        { method: "POST" }
      ),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      toast.success("Payment voided")
      invalidateAll()
    },
    onError: (error: unknown) => {
      const message = errorMessage(error, "Failed to void the payment.")
      setActionError(message)
      toast.error(message)
    },
  })

  const handlePost = async () => {
    const confirmed = await prompt({
      title: "Post invoice",
      description:
        "Posting makes this invoice final. Only a void is possible afterwards.",
      confirmText: "Post invoice",
      cancelText: "Keep as draft",
    })
    if (confirmed) {
      runAction.mutate("post")
    }
  }

  const handleVoid = async () => {
    const confirmed = await prompt({
      title: "Void invoice",
      description: "Are you sure you want to void this invoice?",
      confirmText: "Void invoice",
      cancelText: "Keep invoice",
    })
    if (confirmed) {
      runAction.mutate("void")
    }
  }

  const isDraft = invoice.status === "draft"
  const unsavedEdits = isDraft && editing && dirty
  const paymentBusy = recordPayment.isPending || voidPayment.isPending
  const busy = runAction.isPending || saving
  const locked = busy || paymentBusy
  const canRecordPayment =
    invoice.status === "posted" &&
    typeof invoice.balance === "number" &&
    Math.round(invoice.balance * 100) > 0
  const paymentStatus = invoice.payment_status
  const canVoid = invoice.status === "draft" || invoice.status === "posted"
  const postedAt = formatTimestamp(invoice.posted_at)
  const voidedAt = formatTimestamp(invoice.voided_at)
  // An unexpected status string falls back to the raw text, never an empty badge.
  const statusLabel =
    (INVOICE_STATUS_LABELS as Record<string, string>)[invoice.status] ??
    invoice.status
  const statusColor =
    (INVOICE_STATUS_COLORS as Record<string, "grey" | "green" | "red">)[
      invoice.status
    ] ?? "grey"

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Heading level="h1">{invoice.reference}</Heading>
            <Badge data-testid="status" color={statusColor}>
              {statusLabel}
            </Badge>
            {paymentStatus && (
              <Badge
                data-testid="payment-status"
                color={invoicePaymentStatusColor(paymentStatus)}
              >
                {invoicePaymentStatusLabel(paymentStatus)}
              </Badge>
            )}
            {paymentStatus && invoice.overdue && (
              <Badge data-testid="overdue" color="red">
                Overdue
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {isDraft && !editing && (
              <Button
                size="small"
                variant="secondary"
                disabled={locked}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
            {isDraft && (
              <Button
                size="small"
                isLoading={runAction.isPending}
                disabled={locked || unsavedEdits}
                onClick={handlePost}
              >
                Post
              </Button>
            )}
            {canRecordPayment && (
              <Button
                size="small"
                variant="secondary"
                disabled={locked}
                onClick={() => {
                  setPaymentError(null)
                  setPaymentOpen(true)
                }}
              >
                Record payment
              </Button>
            )}
            {canVoid && (
              <Button
                size="small"
                variant="danger"
                disabled={locked}
                onClick={handleVoid}
              >
                Void
              </Button>
            )}
          </div>
        </div>
        {unsavedEdits && (
          <Text size="small" className="pt-2 text-ui-fg-subtle">
            Save or cancel your edits first
          </Text>
        )}
        {actionError && (
          <Text role="alert" className="pt-2 text-ui-fg-error">
            {actionError}
          </Text>
        )}
        <div className="flex flex-col gap-1 pt-4">
          <Text size="small" className="text-ui-fg-subtle">
            Supplier invoice number:{" "}
            <span data-testid="invoice-number">{invoice.invoice_number}</span>
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Supplier: {invoice.supplier ? invoice.supplier.name : "—"}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Purchase:{" "}
            {invoice.purchase ? (
              <Link to={`/purchases/${invoice.purchase.id}`}>
                {invoice.purchase.reference}
              </Link>
            ) : (
              "—"
            )}
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Invoice date:{" "}
            <span data-testid="invoice-date">
              {formatInvoiceDate(invoice.invoice_date)}
            </span>
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            Due date:{" "}
            <span data-testid="due-date">
              {formatInvoiceDate(invoice.due_date)}
            </span>
          </Text>
          {postedAt && (
            <Text size="small" className="text-ui-fg-subtle">
              Posted: <span data-testid="posted-at">{postedAt}</span>
            </Text>
          )}
          {voidedAt && (
            <Text size="small" className="text-ui-fg-subtle">
              Voided: <span data-testid="voided-at">{voidedAt}</span>
            </Text>
          )}
          {invoice.notes && (
            <Text size="small" className="text-ui-fg-subtle">
              {invoice.notes}
            </Text>
          )}
        </div>
      </Container>

      {isDraft && editing && (
        <Container>
          <EditForm
            invoice={invoice}
            onClose={closeEditor}
            onDirtyChange={setDirty}
            onSavingChange={setSaving}
            actionPending={runAction.isPending || paymentBusy}
          />
        </Container>
      )}

      <Container>
        <Heading level="h2">Lines</Heading>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Item</Table.HeaderCell>
              <Table.HeaderCell>Supplier code</Table.HeaderCell>
              <Table.HeaderCell>Quantity</Table.HeaderCell>
              <Table.HeaderCell>Unit cost</Table.HeaderCell>
              <Table.HeaderCell>Line total</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {invoice.items.map((item) => (
              <Table.Row key={item.id} data-testid="line-row">
                <Table.Cell>{item.description}</Table.Cell>
                <Table.Cell>{item.supplier_sku || "—"}</Table.Cell>
                <Table.Cell>{item.quantity}</Table.Cell>
                <Table.Cell>{formatUsd(item.unit_cost)}</Table.Cell>
                <Table.Cell>{formatUsd(item.line_total)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        <div className="flex flex-col gap-1 pt-4">
          <SummaryRow
            label="Subtotal"
            value={formatUsd(invoice.subtotal)}
            testId="subtotal"
          />
          <SummaryRow
            label="Shipping"
            value={formatUsd(invoice.shipping_cost)}
            testId="shipping-cost"
          />
          <SummaryRow label="Tax" value={formatUsd(invoice.tax)} testId="tax" />
          <SummaryRow
            label="Other costs"
            value={formatUsd(invoice.other_cost)}
            testId="other-cost"
          />
          <SummaryRow
            label="Total"
            value={formatUsd(invoice.total)}
            testId="total"
            strong
          />
          {paymentStatus && (
            <>
              <SummaryRow
                label="Paid"
                value={formatMoneyOrDash(invoice.paid_total, formatUsd)}
                testId="paid-total"
              />
              <SummaryRow
                label="Balance"
                value={formatMoneyOrDash(invoice.balance, formatUsd)}
                testId="balance"
                strong
              />
            </>
          )}
        </div>
      </Container>

      <Container>
        <PaymentsSection
          payments={payments}
          disabled={locked}
          onVoid={(payment) => voidPayment.mutate(payment)}
        />
      </Container>

      {canRecordPayment && (
        <RecordPaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          invoiceId={invoice.id}
          balance={invoice.balance}
          pending={recordPayment.isPending}
          serverError={paymentError}
          onSubmit={(body) => recordPayment.mutate(body)}
        />
      )}

      <Container>
        <Comparison comparison={comparison} />
      </Container>

      <Link to="/accounting/invoices">
        <Text size="small">Back to invoices</Text>
      </Link>
    </div>
  )
}

const InvoiceDetailPage = () => {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "invoices", "detail", id],
    queryFn: () => sdk.client.fetch<InvoiceResponse>(`/admin/invoices/${id}`),
  })

  // Loaded data stays on screen if a later background refetch fails, so an
  // open edit form is never unmounted by a transient error.
  if (!data) {
    if (isLoading) {
      return (
        <Container>
          <Text>Loading...</Text>
        </Container>
      )
    }

    if (isError && (error as { status?: number } | null)?.status === 404) {
      return (
        <Container>
          <Text>Invoice not found</Text>
          <Link to="/accounting/invoices">Back to invoices</Link>
        </Container>
      )
    }

    return (
      <Container>
        <Text>Something went wrong loading this invoice.</Text>
        <Button size="small" variant="secondary" onClick={() => refetch()}>
          Retry
        </Button>
      </Container>
    )
  }

  return (
    <InvoiceView
      key={data.invoice.id}
      invoice={data.invoice}
      comparison={data.comparison ?? null}
      payments={data.payments ?? NO_PAYMENTS}
    />
  )
}

export default InvoiceDetailPage
