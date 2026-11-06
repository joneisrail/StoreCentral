import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useNavigate, useSearchParams } from "react-router-dom"
import { sdk } from "../../../../lib/sdk"
import { errorMessage, formatUsd } from "../../../purchases/format"
import { calculateTotals } from "../../../purchases/new/totals"
import type { AdminPurchase } from "../../../purchases/types"
import type { AdminInvoice } from "../../types"
import { CodeEntry } from "./components/code-entry"
import {
  buildCreateBody,
  isLineValid,
  lineWarnings,
  parseCost,
  parseOptionalAmount,
  parseQuantity,
  prefillLines,
} from "./line-entry"
import type { Line } from "./line-entry"

type PurchasesResponse = {
  purchases: AdminPurchase[]
  count: number
}

type InvoicesResponse = {
  invoices: AdminInvoice[]
  count: number
}

const PURCHASE_LIMIT = 100
const PURCHASE_STATUSES = ["ordered", "partially_received", "received"] as const

const selectClass =
  "bg-ui-bg-field text-ui-fg-base shadow-borders-base h-8 rounded-md px-2 text-sm"

async function fetchPurchases() {
  const responses = await Promise.all(
    PURCHASE_STATUSES.map((status) =>
      sdk.client.fetch<PurchasesResponse>("/admin/purchases", {
        query: { status, limit: PURCHASE_LIMIT },
      })
    )
  )
  return {
    purchases: responses.flatMap((r) => r.purchases),
    capped: responses.some((r) => r.count > PURCHASE_LIMIT),
  }
}

// Non-void invoices of one purchase: drafts and posted ones, all pages.
async function fetchPurchaseInvoices(purchaseId: string) {
  const all: AdminInvoice[] = []
  for (const status of ["draft", "posted"] as const) {
    let offset = 0
    for (;;) {
      const response = await sdk.client.fetch<InvoicesResponse>(
        "/admin/invoices",
        { query: { purchase_id: purchaseId, status, limit: 100, offset } }
      )
      all.push(...response.invoices)
      offset += response.invoices.length
      if (response.invoices.length === 0 || offset >= response.count) {
        break
      }
    }
  }
  return all
}

const InvoiceForm = ({
  purchase,
  invoices,
  dirtyRef,
}: {
  purchase: AdminPurchase
  invoices: AdminInvoice[]
  dirtyRef: { current: boolean }
}) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Initialised once per purchase (the parent keys this component by id), so
  // a refetch never resets what the admin has typed.
  const [initialLines] = useState<Line[]>(() =>
    prefillLines(purchase.items, invoices)
  )
  const [lines, setLines] = useState<Line[]>(initialLines)
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceDate, setInvoiceDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [shipping, setShipping] = useState("")
  const [tax, setTax] = useState("")
  const [other, setOther] = useState("")
  const [notes, setNotes] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ invoice: { id: string } }>("/admin/invoices", {
        method: "POST",
        body,
      }),
    onSuccess: ({ invoice }) => {
      // What is already invoiced has changed, so cached prefill data is stale.
      queryClient.invalidateQueries({ queryKey: ["admin", "purchase-invoices"] })
      queryClient.invalidateQueries({
        queryKey: ["admin", "invoice-purchase-options"],
    refetchOnMount: "always",
      })
      queryClient.invalidateQueries({ queryKey: ["admin", "invoices"] })
      toast.success("Invoice saved")
      navigate(`/accounting/invoices/${invoice.id}`)
    },
    onError: (error: unknown) => {
      setFormError(errorMessage(error, "Failed to save the invoice."))
    },
  })

  const shippingCost = parseOptionalAmount(shipping)
  const taxAmount = parseOptionalAmount(tax)
  const otherCost = parseOptionalAmount(other)
  const canSave =
    invoiceNumber.trim() !== "" &&
    invoiceDate !== "" &&
    lines.length > 0 &&
    lines.every(isLineValid) &&
    shippingCost !== null &&
    taxAmount !== null &&
    otherCost !== null &&
    !create.isPending

  // Lines with unreadable values count as 0 until they are fixed.
  const totals = calculateTotals(
    lines.map((line) => ({
      quantity: parseQuantity(line.quantity) ?? 0,
      unit_cost: parseCost(line.unit_cost) ?? 0,
    })),
    {
      shipping_cost: shippingCost ?? 0,
      tax: taxAmount ?? 0,
      other_cost: otherCost ?? 0,
    }
  )

  // Dirty once anything differs from the pristine prefilled form.
  dirtyRef.current =
    invoiceNumber !== "" ||
    invoiceDate !== "" ||
    dueDate !== "" ||
    shipping !== "" ||
    tax !== "" ||
    other !== "" ||
    notes !== "" ||
    lines.length !== initialLines.length ||
    lines.some((line, index) => {
      const initial = initialLines[index]
      return (
        line.key !== initial.key ||
        line.quantity !== initial.quantity ||
        line.unit_cost !== initial.unit_cost
      )
    })

  const warnings = lineWarnings(lines, purchase.items, invoices)

  const updateLine = (
    key: string,
    field: "quantity" | "unit_cost",
    value: string
  ) => {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: value } : line
      )
    )
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave) {
      return
    }
    setFormError(null)
    create.mutate(
      buildCreateBody({
        purchase_id: purchase.id,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        shipping_cost: shipping,
        tax,
        other_cost: other,
        notes,
        lines,
      })
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading level="h2">Lines</Heading>
        {purchase.supplier && (
          <CodeEntry
            supplierId={purchase.supplier.id}
            purchaseItems={purchase.items}
            onAdd={(line) => setLines((current) => [...current, line])}
          />
        )}

        {lines.length === 0 ? (
          <Text>No lines yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Item</Table.HeaderCell>
                <Table.HeaderCell>Supplier code</Table.HeaderCell>
                <Table.HeaderCell>Quantity</Table.HeaderCell>
                <Table.HeaderCell>Unit cost (USD)</Table.HeaderCell>
                <Table.HeaderCell>Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {lines.map((line) => {
                const warning = warnings.get(line.key)
                const purchaseItem = purchase.items.find(
                  (p) => p.id === line.purchase_item_id
                )
                return (
                  <Table.Row key={line.key}>
                    <Table.Cell>
                      <div className="flex flex-col gap-1">
                        <span>{line.label}</span>
                        <div className="flex flex-wrap gap-1">
                          {warning?.not_on_purchase && (
                            <Badge size="2xsmall" color="orange">
                              Not on purchase
                            </Badge>
                          )}
                          {warning?.price_difference && purchaseItem && (
                            <Badge size="2xsmall" color="orange">
                              Price differs from ordered{" "}
                              {formatUsd(purchaseItem.unit_cost)}
                            </Badge>
                          )}
                          {warning?.over_ordered && purchaseItem && (
                            <Badge size="2xsmall" color="orange">
                              Billed above ordered ({purchaseItem.quantity})
                            </Badge>
                          )}
                          {warning?.over_received && purchaseItem && (
                            <Badge size="2xsmall" color="orange">
                              Billed above received (
                              {purchaseItem.quantity_received})
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>{line.supplier_sku || "—"}</Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        aria-label={`Quantity for ${line.label}`}
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(line.key, "quantity", event.target.value)
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`Unit cost for ${line.label}`}
                        value={line.unit_cost}
                        onChange={(event) =>
                          updateLine(line.key, "unit_cost", event.target.value)
                        }
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        type="button"
                        size="small"
                        variant="danger"
                        aria-label={`Remove ${line.label}`}
                        onClick={() =>
                          setLines((current) =>
                            current.filter((l) => l.key !== line.key)
                          )
                        }
                      >
                        Remove
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-number">Invoice number</Label>
            <Input
              id="invoice-number"
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-date">Invoice date</Label>
            <Input
              id="invoice-date"
              type="date"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-due-date">Due date</Label>
            <Input
              id="invoice-due-date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-shipping">Shipping cost</Label>
            <Input
              id="invoice-shipping"
              type="number"
              min={0}
              step="0.01"
              value={shipping}
              onChange={(event) => setShipping(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-tax">Tax</Label>
            <Input
              id="invoice-tax"
              type="number"
              min={0}
              step="0.01"
              value={tax}
              onChange={(event) => setTax(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-other">Other cost</Label>
            <Input
              id="invoice-other"
              type="number"
              min={0}
              step="0.01"
              value={other}
              onChange={(event) => setOther(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="invoice-notes">Notes</Label>
          <Textarea
            id="invoice-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Text>
            Subtotal:{" "}
            <span data-testid="subtotal">{formatUsd(totals.subtotal)}</span>
          </Text>
          <Text weight="plus">
            Total: <span data-testid="total">{formatUsd(totals.total)}</span>
          </Text>
        </div>

        {formError && (
          <Text role="alert" className="text-ui-fg-error">
            {formError}
          </Text>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate("/accounting/invoices")}
          >
            Cancel
          </Button>
          <Button type="submit" isLoading={create.isPending} disabled={!canSave}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}

const NewInvoicePage = () => {
  const [searchParams] = useSearchParams()
  const [purchaseId, setPurchaseId] = useState(
    searchParams.get("purchase_id") ?? ""
  )
  const [filter, setFilter] = useState("")
  const dirtyRef = useRef(false)
  const prompt = usePrompt()

  const purchases = useQuery({
    queryKey: ["admin", "invoice-purchase-options"],
    queryFn: fetchPurchases,
  })

  const listed = purchases.data?.purchases.find((p) => p.id === purchaseId)

  // A purchase named in the URL may be outside the capped list.
  const detail = useQuery({
    queryKey: ["admin", "purchases", purchaseId, "for-invoice"],
    enabled:
      purchaseId !== "" &&
      !listed &&
      (purchases.isSuccess || purchases.isError),
    queryFn: () =>
      sdk.client.fetch<{ purchase: AdminPurchase }>(
        `/admin/purchases/${purchaseId}`
      ),
  })

  const purchase = listed ?? detail.data?.purchase

  const invoices = useQuery({
    queryKey: ["admin", "purchase-invoices", purchaseId],
    enabled: purchase !== undefined,
    // The prefill must reflect the server at mount, never a cached copy: a
    // stale list would bill again what an earlier invoice already covers.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: () => fetchPurchaseInvoices(purchaseId),
  })

  const handlePurchaseChange = async (next: string) => {
    if (next !== purchaseId && purchaseId !== "" && dirtyRef.current) {
      const confirmed = await prompt({
        title: "Discard this invoice?",
        description:
          "Changing the purchase discards the invoice you have started.",
        confirmText: "Discard",
        cancelText: "Keep editing",
      })
      if (!confirmed) {
        return
      }
    }
    dirtyRef.current = false
    setPurchaseId(next)
  }

  const term = filter.trim().toLowerCase()
  const options = (purchases.data?.purchases ?? []).filter(
    (p) =>
      p.id === purchaseId ||
      term === "" ||
      p.reference.toLowerCase().includes(term) ||
      (p.supplier?.name ?? "").toLowerCase().includes(term)
  )

  return (
    <Container>
      <Heading level="h1">New invoice</Heading>

      <div className="flex flex-col gap-6 pt-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="invoice-purchase-filter">Find a purchase</Label>
          <Input
            id="invoice-purchase-filter"
            type="search"
            placeholder="Reference or supplier"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <Label htmlFor="invoice-purchase">Purchase</Label>
          <select
            id="invoice-purchase"
            className={selectClass}
            value={purchaseId}
            onChange={(event) => handlePurchaseChange(event.target.value)}
          >
            <option value="">Select a purchase</option>
            {purchase && !options.some((p) => p.id === purchase.id) && (
              <option value={purchase.id}>
                {purchase.reference}
                {purchase.supplier ? ` - ${purchase.supplier.name}` : ""}
              </option>
            )}
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.reference}
                {p.supplier ? ` - ${p.supplier.name}` : ""}
              </option>
            ))}
          </select>
          {purchases.isLoading && <Text size="small">Loading purchases...</Text>}
          {purchases.isError && (
            <div className="flex items-center gap-2">
              <Text size="small" className="text-ui-fg-error">
                Something went wrong loading purchases.
              </Text>
              <Button
                size="small"
                variant="secondary"
                type="button"
                onClick={() => purchases.refetch()}
              >
                Retry
              </Button>
            </div>
          )}
          {purchases.data?.capped && (
            <Text size="small">
              Showing the first {PURCHASE_LIMIT} purchases of each status.
              Older ones are not listed.
            </Text>
          )}
          {detail.isError && (
            <Text size="small" className="text-ui-fg-error">
              Could not load that purchase.
            </Text>
          )}
        </div>

        {purchase && !invoices.isError && !invoices.isFetchedAfterMount && <Text>Loading invoice lines...</Text>}
        {purchase && invoices.isError && (
          <div className="flex items-center gap-2">
            <Text className="text-ui-fg-error">
              Something went wrong loading the invoices for this purchase.
            </Text>
            <Button
              size="small"
              variant="secondary"
              type="button"
              onClick={() => invoices.refetch()}
            >
              Retry
            </Button>
          </div>
        )}
        {purchase && invoices.data && invoices.isFetchedAfterMount && (
          <InvoiceForm
            key={purchase.id}
            purchase={purchase}
            invoices={invoices.data}
            dirtyRef={dirtyRef}
          />
        )}
      </div>
    </Container>
  )
}

export default NewInvoicePage
