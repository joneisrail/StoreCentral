import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Heading,
  Input,
  Table,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { sdk } from "../../../lib/sdk"
import { errorMessage, formatUsd } from "../../purchases/format"
import { formatInvoiceDate } from "../format"
import type { Expense, ExpensesResponse } from "../types"
import { ExpenseDialog } from "./components/expense-dialog"
import type { ExpenseBody } from "./components/expense-dialog"
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  expenseCategoryLabel,
} from "./labels"

const LIMIT = 20
const SEARCH_DEBOUNCE_MS = 300

const ExpensesPage = () => {
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const [category, setCategory] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const appliedQ = useRef("")

  // null = closed, "new" = add dialog, otherwise the expense being edited.
  const [dialog, setDialog] = useState<Expense | "new" | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Synchronous in-flight flag: two clicks in one tick must send one request.
  const saveInFlight = useRef(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "expenses", category, from, to, q, offset],
    queryFn: () => {
      const query: Record<string, unknown> = { limit: LIMIT, offset }
      if (category !== "all") {
        query.category = category
      }
      if (from) {
        query.from = from
      }
      if (to) {
        query.to = to
      }
      if (q) {
        query.q = q
      }
      return sdk.client.fetch<ExpensesResponse>("/admin/expenses", { query })
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

  const invalidateAll = () => {
    for (const key of ["expenses", "profit-report"]) {
      queryClient.invalidateQueries({ queryKey: ["admin", key] })
    }
  }

  const saveExpense = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: ExpenseBody }) =>
      sdk.client.fetch<{ expense: Expense }>(
        id ? `/admin/expenses/${id}` : "/admin/expenses",
        { method: "POST", body }
      ),
    onMutate: () => setSaveError(null),
    onSettled: () => {
      saveInFlight.current = false
    },
    onSuccess: (_result, variables) => {
      toast.success(variables.id ? "Expense updated" : "Expense added")
      setDialog(null)
      invalidateAll()
    },
    onError: (error: unknown) => {
      setSaveError(errorMessage(error, "Failed to save the expense."))
    },
  })

  const deleteExpense = useMutation({
    mutationFn: (expense: Expense) =>
      sdk.client.fetch(`/admin/expenses/${expense.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Expense deleted")
      invalidateAll()
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to delete the expense."))
    },
  })

  const handleSubmit = (body: ExpenseBody) => {
    if (saveInFlight.current) {
      return
    }
    saveInFlight.current = true
    saveExpense.mutate({
      id: dialog && dialog !== "new" ? dialog.id : null,
      body,
    })
  }

  const handleDelete = async (expense: Expense) => {
    const confirmed = await prompt({
      title: "Delete expense",
      description: `Delete expense ${expense.reference}? It stops counting in the profit report.`,
      confirmText: "Delete expense",
      cancelText: "Keep expense",
    })
    if (confirmed) {
      deleteExpense.mutate(expense)
    }
  }

  const openDialog = (value: Expense | "new") => {
    setSaveError(null)
    setDialog(value)
  }

  const filtered = category !== "all" || !!from || !!to

  return (
    <Container>
      <div className="flex items-center justify-between">
        <Heading level="h1">Expenses</Heading>
        <Button size="small" onClick={() => openDialog("new")}>
          Add expense
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 py-4">
        <Input
          type="search"
          placeholder="Search description or payee"
          aria-label="Search expenses"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applySearch(search)
            }
          }}
        />
        <select
          aria-label="Filter by category"
          className="bg-ui-bg-field text-ui-fg-base shadow-borders-base rounded-md px-2 text-sm"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value)
            setOffset(0)
          }}
        >
          <option value="all">All categories</option>
          {EXPENSE_CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {EXPENSE_CATEGORY_LABELS[key]}
            </option>
          ))}
        </select>
        <Input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value)
            setOffset(0)
          }}
        />
        <Input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value)
            setOffset(0)
          }}
        />
      </div>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading expenses.</Text>
          <Button size="small" variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && (
        <Text data-testid="total-amount" className="pb-2">
          Total: {formatUsd(data.total_amount)}
        </Text>
      )}

      {!isLoading && !isError && data && data.expenses.length === 0 && (
        <Text>
          {q || filtered ? "No expenses match your filters." : "No expenses yet"}
        </Text>
      )}

      {!isLoading && !isError && data && data.expenses.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Reference</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Category</Table.HeaderCell>
              <Table.HeaderCell>Description</Table.HeaderCell>
              <Table.HeaderCell>Payee</Table.HeaderCell>
              <Table.HeaderCell>Amount</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.expenses.map((expense) => (
              <Table.Row key={expense.id} data-testid="expense-row">
                <Table.Cell>{expense.reference}</Table.Cell>
                <Table.Cell>{formatInvoiceDate(expense.expense_date)}</Table.Cell>
                <Table.Cell>{expenseCategoryLabel(expense.category)}</Table.Cell>
                <Table.Cell>{expense.description}</Table.Cell>
                <Table.Cell>{expense.payee || "—"}</Table.Cell>
                <Table.Cell>{formatUsd(expense.amount)}</Table.Cell>
                <Table.Cell>
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      aria-label={`Edit expense ${expense.reference}`}
                      onClick={() => openDialog(expense)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="small"
                      variant="danger"
                      aria-label={`Delete expense ${expense.reference}`}
                      disabled={deleteExpense.isPending}
                      onClick={() => handleDelete(expense)}
                    >
                      Delete
                    </Button>
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

      <ExpenseDialog
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDialog(null)
          }
        }}
        expense={dialog && dialog !== "new" ? dialog : null}
        pending={saveExpense.isPending}
        serverError={saveError}
        onSubmit={handleSubmit}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Expenses",
})

export default ExpensesPage
