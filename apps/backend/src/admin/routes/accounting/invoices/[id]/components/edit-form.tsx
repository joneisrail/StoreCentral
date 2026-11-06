import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { sdk } from "../../../../../lib/sdk"
import { errorMessage } from "../../../../purchases/format"
import { parseCost, parseQuantity } from "../../new/line-entry"
import type { AdminInvoice } from "../../../types"

type FormValues = {
  invoice_number: string
  invoice_date: string
  due_date: string
  shipping_cost: string
  tax: string
  other_cost: string
  notes: string
  lines: { id: string; quantity: string; unit_cost: string }[]
}

const AMOUNT_FIELDS = [
  { key: "shipping_cost", label: "Shipping cost" },
  { key: "tax", label: "Tax" },
  { key: "other_cost", label: "Other cost" },
] as const

export function toFormValues(invoice: AdminInvoice): FormValues {
  return {
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date ?? "",
    shipping_cost: String(invoice.shipping_cost),
    tax: String(invoice.tax),
    other_cost: String(invoice.other_cost),
    notes: invoice.notes ?? "",
    lines: invoice.items.map((item) => ({
      id: item.id,
      quantity: String(item.quantity),
      unit_cost: String(item.unit_cost),
    })),
  }
}

type BuildResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string }

// Only changed header fields are sent; `items` (a full replacement) is sent
// only when some line changed. Unreadable numbers are errors, never "cleared".
export function buildUpdateBody(
  invoice: AdminInvoice,
  form: FormValues
): BuildResult {
  const body: Record<string, unknown> = {}

  const number = form.invoice_number.trim()
  if (number === "") {
    return { ok: false, error: "Invoice number is required." }
  }
  if (number !== invoice.invoice_number) {
    body.invoice_number = number
  }

  if (form.invoice_date === "") {
    return { ok: false, error: "Invoice date is required." }
  }
  if (form.invoice_date !== invoice.invoice_date) {
    body.invoice_date = form.invoice_date
  }

  if (form.due_date !== (invoice.due_date ?? "")) {
    body.due_date = form.due_date === "" ? null : form.due_date
  }

  for (const { key, label } of AMOUNT_FIELDS) {
    const parsed = parseCost(form[key])
    if (parsed === null) {
      return { ok: false, error: `${label} must be an amount of 0 or more.` }
    }
    if (parsed !== invoice[key]) {
      body[key] = parsed
    }
  }

  const notes = form.notes.trim()
  if (notes !== (invoice.notes ?? "")) {
    body.notes = notes === "" ? null : notes
  }

  let linesChanged = false
  const items: Record<string, unknown>[] = []
  for (const item of invoice.items) {
    const line = form.lines.find((l) => l.id === item.id)
    const quantity = line ? parseQuantity(line.quantity) : item.quantity
    const unitCost = line ? parseCost(line.unit_cost) : item.unit_cost
    if (quantity === null || unitCost === null) {
      return {
        ok: false,
        error: "Every line needs a whole quantity and a cost of 0 or more.",
      }
    }
    if (quantity !== item.quantity || unitCost !== item.unit_cost) {
      linesChanged = true
    }
    const payload: Record<string, unknown> = {
      variant_id: item.variant_id,
      quantity,
      unit_cost: unitCost,
    }
    if (item.purchase_item_id) {
      payload.purchase_item_id = item.purchase_item_id
    }
    if (item.supplier_sku.trim()) {
      payload.supplier_sku = item.supplier_sku.trim()
    }
    if (item.description.trim()) {
      payload.description = item.description.trim()
    }
    items.push(payload)
  }
  if (linesChanged) {
    body.items = items
  }

  return { ok: true, body }
}

// Mounted once per invoice (the parent keys it by id). The form state is
// initialised here only, so a refetch never overwrites what the admin typed;
// it is reset to the saved values only after a successful save.
export const EditForm = ({
  invoice,
  onClose,
}: {
  invoice: AdminInvoice
  onClose: () => void
}) => {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormValues>(() => toFormValues(invoice))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ invoice: AdminInvoice }>(
        `/admin/invoices/${invoice.id}`,
        { method: "POST", body }
      ),
    onMutate: () => {
      setError(null)
      setNotice(null)
    },
    onSuccess: () => {
      toast.success("Invoice updated")
      queryClient.invalidateQueries({ queryKey: ["admin", "invoices"] })
      queryClient.invalidateQueries({ queryKey: ["admin", "purchase-invoices"] })
      queryClient.invalidateQueries({
        queryKey: ["admin", "invoice-purchase-options"],
      })
    },
    onError: (err: unknown) => {
      const message = errorMessage(err, "Failed to save the invoice.")
      setError(message)
      toast.error(message)
    },
  })

  const setField = (key: keyof Omit<FormValues, "lines">, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const setLine = (
    id: string,
    field: "quantity" | "unit_cost",
    value: string
  ) =>
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.id === id ? { ...line, [field]: value } : line
      ),
    }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (save.isPending) {
      return
    }
    setError(null)
    setNotice(null)
    const result = buildUpdateBody(invoice, form)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (Object.keys(result.body).length === 0) {
      setNotice("No changes to save.")
      return
    }
    save.mutate(result.body, {
      onSuccess: (response) => setForm(toFormValues(response.invoice)),
    })
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Heading level="h2">Edit invoice</Heading>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="edit-invoice-number">Invoice number</Label>
          <Input
            id="edit-invoice-number"
            value={form.invoice_number}
            onChange={(event) => setField("invoice_number", event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="edit-invoice-date">Invoice date</Label>
          <Input
            id="edit-invoice-date"
            type="date"
            value={form.invoice_date}
            onChange={(event) => setField("invoice_date", event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="edit-due-date">Due date</Label>
          <Input
            id="edit-due-date"
            type="date"
            value={form.due_date}
            onChange={(event) => setField("due_date", event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {AMOUNT_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label htmlFor={`edit-${key}`}>{label}</Label>
            <Input
              id={`edit-${key}`}
              type="number"
              min={0}
              step="0.01"
              value={form[key]}
              onChange={(event) => setField(key, event.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="edit-notes">Notes</Label>
        <Textarea
          id="edit-notes"
          value={form.notes}
          onChange={(event) => setField("notes", event.target.value)}
        />
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Item</Table.HeaderCell>
            <Table.HeaderCell>Supplier code</Table.HeaderCell>
            <Table.HeaderCell>Quantity</Table.HeaderCell>
            <Table.HeaderCell>Unit cost (USD)</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {invoice.items.map((item) => {
            const line = form.lines.find((l) => l.id === item.id)
            return (
              <Table.Row key={item.id}>
                <Table.Cell>{item.description}</Table.Cell>
                <Table.Cell>{item.supplier_sku || "—"}</Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    aria-label={`Quantity for ${item.description}`}
                    value={line?.quantity ?? ""}
                    onChange={(event) =>
                      setLine(item.id, "quantity", event.target.value)
                    }
                  />
                </Table.Cell>
                <Table.Cell>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Unit cost for ${item.description}`}
                    value={line?.unit_cost ?? ""}
                    onChange={(event) =>
                      setLine(item.id, "unit_cost", event.target.value)
                    }
                  />
                </Table.Cell>
              </Table.Row>
            )
          })}
        </Table.Body>
      </Table>

      {error && (
        <Text role="alert" className="text-ui-fg-error">
          {error}
        </Text>
      )}
      {notice && <Text size="small">{notice}</Text>}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" isLoading={save.isPending} disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  )
}
