import { useState } from "react"
import { Button, Drawer, Input, Label, Text } from "@medusajs/ui"
import type { Expense } from "../../types"
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "../labels"

export type ExpenseBody = {
  expense_date?: string
  category?: string
  amount?: number
  description?: string
  payee?: string
}

type ParseResult = { ok: true; amount: number } | { ok: false; error: string }

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Strict: digits with at most two decimals and above zero. Unreadable input is
// an error, never 0.
export function parseExpenseAmount(raw: string): ParseResult {
  const text = raw.trim()
  if (!AMOUNT_PATTERN.test(text) || Math.round(Number(text) * 100) <= 0) {
    return {
      ok: false,
      error: "The amount must be more than 0, with at most 2 decimals.",
    }
  }
  return { ok: true, amount: Number(text) }
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

// Mounted only while the dialog is open, so the fields are initialised once per
// open and a background refetch never resets what was typed.
const ExpenseForm = ({
  expense,
  pending,
  serverError,
  onSubmit,
  onCancel,
}: {
  expense: Expense | null
  pending: boolean
  serverError: string | null
  onSubmit: (body: ExpenseBody) => void
  onCancel: () => void
}) => {
  const [date, setDate] = useState(() => expense?.expense_date ?? todayUtc())
  const [category, setCategory] = useState<string>(
    () => expense?.category ?? "other"
  )
  const [amount, setAmount] = useState(() =>
    expense ? expense.amount.toFixed(2) : ""
  )
  const [description, setDescription] = useState(
    () => expense?.description ?? ""
  )
  const [payee, setPayee] = useState(() => expense?.payee ?? "")
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (pending) {
      return
    }
    const parsed = parseExpenseAmount(amount)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (!DATE_PATTERN.test(date)) {
      setError("Date is required.")
      return
    }
    const desc = description.trim()
    if (!desc) {
      setError("Description is required.")
      return
    }
    setError(null)
    const payeeText = payee.trim()

    if (!expense) {
      const body: ExpenseBody = {
        expense_date: date,
        category,
        amount: parsed.amount,
        description: desc,
      }
      if (payeeText) {
        body.payee = payeeText
      }
      onSubmit(body)
      return
    }

    // Edit sends only what changed.
    const body: ExpenseBody = {}
    if (date !== expense.expense_date) {
      body.expense_date = date
    }
    if (category !== expense.category) {
      body.category = category
    }
    if (Math.round(parsed.amount * 100) !== Math.round(expense.amount * 100)) {
      body.amount = parsed.amount
    }
    if (desc !== expense.description) {
      body.description = desc
    }
    if (payeeText !== (expense.payee ?? "")) {
      body.payee = payeeText
    }
    if (Object.keys(body).length === 0) {
      onCancel()
      return
    }
    onSubmit(body)
  }

  const shownError = error ?? serverError

  return (
    <form noValidate onSubmit={handleSubmit} className="flex h-full flex-col">
      <Drawer.Body className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="expense-date">Date</Label>
          <Input
            id="expense-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="expense-category">Category</Label>
          <select
            id="expense-category"
            className="bg-ui-bg-field text-ui-fg-base shadow-borders-base rounded-md px-2 py-1 text-sm"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {EXPENSE_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {EXPENSE_CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="expense-amount">Amount</Label>
          <Input
            id="expense-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="expense-description">Description</Label>
          <Input
            id="expense-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="expense-payee">Payee</Label>
          <Input
            id="expense-payee"
            value={payee}
            onChange={(event) => setPayee(event.target.value)}
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
          Save expense
        </Button>
      </Drawer.Footer>
    </form>
  )
}

export const ExpenseDialog = ({
  open,
  onOpenChange,
  expense,
  pending,
  serverError,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // null adds a new expense.
  expense: Expense | null
  pending: boolean
  serverError: string | null
  onSubmit: (body: ExpenseBody) => void
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
        <Drawer.Title>{expense ? "Edit expense" : "Add expense"}</Drawer.Title>
      </Drawer.Header>
      <ExpenseForm
        expense={expense}
        pending={pending}
        serverError={serverError}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
      />
    </Drawer.Content>
  </Drawer>
)
