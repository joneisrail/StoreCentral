import { useState } from "react"
import { Button, Drawer, Input, Label, Text, Textarea } from "@medusajs/ui"
import { PAYMENT_METHOD_LABELS } from "../../../format"

export type PaymentBody = {
  invoice_id: string
  amount: number
  paid_at: string
  method: string
  reference?: string
  note?: string
}

type ParseResult = { ok: true; amount: number } | { ok: false; error: string }

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/

// Strict: digits with at most two decimals, above zero, not above the balance
// (compared in integer cents). Unreadable input is an error, never 0.
export function parsePaymentAmount(raw: string, balance: number): ParseResult {
  const text = raw.trim()
  const message = `The amount must be more than 0 and at most the balance of ${balance.toFixed(2)}.`
  if (!AMOUNT_PATTERN.test(text)) {
    return { ok: false, error: message }
  }
  const amount = Number(text)
  const cents = Math.round(amount * 100)
  if (cents <= 0 || cents > Math.round(balance * 100)) {
    return { ok: false, error: message }
  }
  return { ok: true, amount }
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

const METHOD_KEYS = Object.keys(PAYMENT_METHOD_LABELS)

// Mounted only while the dialog is open, so the fields are initialised once per
// open and a background refetch of the invoice never resets what was typed.
const PaymentForm = ({
  invoiceId,
  balance,
  pending,
  serverError,
  onSubmit,
  onCancel,
}: {
  invoiceId: string
  balance: number
  pending: boolean
  serverError: string | null
  onSubmit: (body: PaymentBody) => void
  onCancel: () => void
}) => {
  const [amount, setAmount] = useState(() => balance.toFixed(2))
  const [paidAt, setPaidAt] = useState(() => todayUtc())
  const [method, setMethod] = useState("bank_transfer")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (pending) {
      return
    }
    const parsed = parsePaymentAmount(amount, balance)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
      setError("Payment date is required.")
      return
    }
    setError(null)
    const body: PaymentBody = {
      invoice_id: invoiceId,
      amount: parsed.amount,
      paid_at: paidAt,
      method,
    }
    if (reference.trim()) {
      body.reference = reference.trim()
    }
    if (note.trim()) {
      body.note = note.trim()
    }
    onSubmit(body)
  }

  const shownError = error ?? serverError

  return (
    <form noValidate onSubmit={handleSubmit} className="flex h-full flex-col">
      <Drawer.Body className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-amount">Amount</Label>
          <Input
            id="payment-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-date">Payment date</Label>
          <Input
            id="payment-date"
            type="date"
            value={paidAt}
            onChange={(event) => setPaidAt(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-method">Method</Label>
          <select
            id="payment-method"
            className="bg-ui-bg-field text-ui-fg-base shadow-borders-base rounded-md px-2 py-1 text-sm"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            {METHOD_KEYS.map((key) => (
              <option key={key} value={key}>
                {PAYMENT_METHOD_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-reference">Reference</Label>
          <Input
            id="payment-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-note">Note</Label>
          <Textarea
            id="payment-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {shownError && (
          <Text role="alert" className="text-ui-fg-error">
            {shownError}
          </Text>
        )}
      </Drawer.Body>
      <Drawer.Footer>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" isLoading={pending} disabled={pending}>
          Save payment
        </Button>
      </Drawer.Footer>
    </form>
  )
}

export const RecordPaymentDialog = ({
  open,
  onOpenChange,
  invoiceId,
  balance,
  pending,
  serverError,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  balance: number
  pending: boolean
  serverError: string | null
  onSubmit: (body: PaymentBody) => void
}) => (
  <Drawer
    open={open}
    onOpenChange={(next) => {
      // The dialog cannot be dismissed while the request is in flight.
      if (!pending) {
        onOpenChange(next)
      }
    }}
  >
    <Drawer.Content aria-describedby={undefined}>
      <Drawer.Header>
        <Drawer.Title>Record payment</Drawer.Title>
      </Drawer.Header>
      <PaymentForm
        invoiceId={invoiceId}
        balance={balance}
        pending={pending}
        serverError={serverError}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
      />
    </Drawer.Content>
  </Drawer>
)
