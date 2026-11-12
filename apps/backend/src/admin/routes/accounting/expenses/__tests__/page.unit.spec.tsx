/**
 * @jest-environment jsdom
 */
import "../../../purchases/__tests__/text-encoder-polyfill"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const mockFetch = jest.fn()
const mockToast = { success: jest.fn(), error: jest.fn() }

jest.mock("../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

jest.mock("@medusajs/ui", () => ({
  ...jest.requireActual("@medusajs/ui"),
  toast: {
    success: (...args: unknown[]) => mockToast.success(...args),
    error: (...args: unknown[]) => mockToast.error(...args),
  },
}))

import ExpensesPage, { config } from "../page"

let queryClient: QueryClient

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/accounting/expenses"]}>
        <ExpensesPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

type ExpenseRow = {
  id: string
  reference: string
  expense_date: string
  category: string
  amount: number
  description: string
  payee: string | null
  currency_code: string
  created_at: string
}

function makeExpense(n: number, overrides: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: `exp_${n}`,
    reference: `EXP-${String(n).padStart(4, "0")}`,
    expense_date: "2026-10-05",
    category: "rent",
    amount: 100,
    description: `Expense ${n}`,
    payee: `Payee ${n}`,
    currency_code: "usd",
    created_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  }
}

// Stateful mock server: filters, searches and paginates the current data,
// handles create/update/delete and returns fresh objects on every call.
let serverExpenses: ExpenseRow[] = []
let failSave: string | null = null
let nextId = 1000

function installServer() {
  mockFetch.mockImplementation(
    (
      url: string,
      opts?: { method?: string; query?: Record<string, unknown>; body?: any }
    ) => {
      const method = opts?.method ?? "GET"
      if (url === "/admin/expenses" && method === "GET") {
        const query = opts?.query ?? {}
        const offset = Number(query.offset ?? 0)
        const limit = Number(query.limit ?? 20)
        let rows = serverExpenses
        if (query.category) {
          rows = rows.filter((e) => e.category === query.category)
        }
        if (query.from) {
          rows = rows.filter((e) => e.expense_date >= String(query.from))
        }
        if (query.to) {
          rows = rows.filter((e) => e.expense_date <= String(query.to))
        }
        if (query.q) {
          const needle = String(query.q).toLowerCase()
          rows = rows.filter(
            (e) =>
              e.description.toLowerCase().includes(needle) ||
              (e.payee ?? "").toLowerCase().includes(needle)
          )
        }
        return Promise.resolve({
          expenses: rows.slice(offset, offset + limit).map((e) => ({ ...e })),
          count: rows.length,
          offset,
          limit,
          total_amount: rows.reduce((sum, e) => sum + e.amount, 0),
        })
      }
      if (url === "/admin/expenses" && method === "POST") {
        if (failSave) {
          return Promise.reject(new Error(failSave))
        }
        const n = nextId++
        const created = makeExpense(n, { ...opts!.body, payee: opts!.body.payee ?? null })
        serverExpenses = [created, ...serverExpenses]
        return Promise.resolve({ expense: { ...created } })
      }
      const match = url.match(/^\/admin\/expenses\/(.+)$/)
      if (match && method === "POST") {
        if (failSave) {
          return Promise.reject(new Error(failSave))
        }
        serverExpenses = serverExpenses.map((e) =>
          e.id === match[1]
            ? { ...e, ...opts!.body, payee: opts!.body.payee === "" ? null : (opts!.body.payee ?? e.payee) }
            : e
        )
        return Promise.resolve({ expense: {} })
      }
      if (match && method === "DELETE") {
        serverExpenses = serverExpenses.filter((e) => e.id !== match[1])
        return Promise.resolve({ id: match[1], deleted: true })
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${url}`))
    }
  )
}

function listCalls() {
  return mockFetch.mock.calls.filter(
    (c) => c[0] === "/admin/expenses" && c[1]?.query
  )
}

function lastQuery() {
  const calls = listCalls()
  return calls[calls.length - 1][1].query
}

function writeCalls() {
  return mockFetch.mock.calls.filter(
    (c) => c[1]?.method === "POST" || c[1]?.method === "DELETE"
  )
}

function manyExpenses(count: number) {
  return Array.from({ length: count }, (_, i) => makeExpense(i + 1))
}

async function flush() {
  await act(async () => {})
}

async function confirmDialog(name: string) {
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name }))
}

describe("ExpensesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    serverExpenses = []
    failSave = null
    nextId = 1000
    installServer()
  })

  it("exports a route config with the Expenses label only", () => {
    expect(config).toMatchObject({ label: "Expenses" })
    expect((config as any).nested).toBeUndefined()
  })

  it("shows reference, date, category label, description, payee and amount", async () => {
    serverExpenses = [
      makeExpense(1, {
        category: "shipping_packaging",
        amount: 1234.5,
        description: "Boxes",
        payee: "BoxCo",
      }),
      makeExpense(2, { payee: null, category: "other" }),
    ]
    renderPage()

    const rows = await screen.findAllByTestId("expense-row")
    expect(rows).toHaveLength(2)
    const first = within(rows[0])
    expect(first.getByText("EXP-0001")).toBeInTheDocument()
    expect(first.getByText("Shipping & packaging")).toBeInTheDocument()
    expect(first.getByText("Boxes")).toBeInTheDocument()
    expect(first.getByText("BoxCo")).toBeInTheDocument()
    expect(first.getByText("$1,234.50")).toBeInTheDocument()
    expect(first.getByText(new Date("2026-10-05").toLocaleDateString(undefined, { timeZone: "UTC" }))).toBeInTheDocument()
    expect(within(rows[1]).getByText("—")).toBeInTheDocument()
    expect(within(rows[1]).getByText("Other")).toBeInTheDocument()
  })

  it("shows the filtered total from total_amount, not the page sum", async () => {
    serverExpenses = manyExpenses(25)
    renderPage()
    await screen.findAllByTestId("expense-row")
    expect(screen.getAllByTestId("expense-row")).toHaveLength(20)
    expect(screen.getByTestId("total-amount")).toHaveTextContent("$2,500.00")
  })

  it("shows the empty state", async () => {
    renderPage()
    expect(await screen.findByText("No expenses yet")).toBeInTheDocument()
  })

  it("shows loading, then an error with Retry that reloads with the same params", async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error("boom")))
    renderPage()
    expect(screen.getByText("Loading...")).toBeInTheDocument()
    expect(
      await screen.findByText("Something went wrong loading expenses.")
    ).toBeInTheDocument()
    expect(lastQuery()).toEqual({ limit: 20, offset: 0 })

    serverExpenses = [makeExpense(1)]
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("EXP-0001")).toBeInTheDocument()
    expect(listCalls()).toHaveLength(2)
    expect(lastQuery()).toEqual({ limit: 20, offset: 0 })
  })

  describe("filters and pagination", () => {
    it("sends exact params for category, from and to and resets the offset", async () => {
      serverExpenses = manyExpenses(45)
      renderPage()
      await screen.findAllByTestId("expense-row")
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      await waitFor(() => expect(lastQuery().offset).toBe(20))

      fireEvent.change(screen.getByLabelText("Filter by category"), {
        target: { value: "rent" },
      })
      await waitFor(() =>
        expect(lastQuery()).toEqual({ limit: 20, offset: 0, category: "rent" })
      )

      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      await waitFor(() => expect(lastQuery().offset).toBe(20))
      fireEvent.change(screen.getByLabelText("From date"), {
        target: { value: "2026-10-01" },
      })
      await waitFor(() =>
        expect(lastQuery()).toEqual({
          limit: 20,
          offset: 0,
          category: "rent",
          from: "2026-10-01",
        })
      )

      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      await waitFor(() => expect(lastQuery().offset).toBe(20))
      fireEvent.change(screen.getByLabelText("To date"), {
        target: { value: "2026-10-31" },
      })
      await waitFor(() =>
        expect(lastQuery()).toEqual({
          limit: 20,
          offset: 0,
          category: "rent",
          from: "2026-10-01",
          to: "2026-10-31",
        })
      )
    })

    it("debounces the search and resets the offset", async () => {
      serverExpenses = manyExpenses(45)
      renderPage()
      await screen.findAllByTestId("expense-row")
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      await waitFor(() => expect(lastQuery().offset).toBe(20))
      const callsBefore = listCalls().length

      fireEvent.change(screen.getByLabelText("Search expenses"), {
        target: { value: "  Expense 4  " },
      })
      // Not sent immediately.
      expect(listCalls()).toHaveLength(callsBefore)
      await waitFor(() =>
        expect(lastQuery()).toEqual({ limit: 20, offset: 0, q: "Expense 4" })
      )
    })

    it("clamps to the last page when the count shrinks", async () => {
      serverExpenses = manyExpenses(21)
      renderPage()
      await screen.findAllByTestId("expense-row")
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      expect(await screen.findByText("EXP-0021")).toBeInTheDocument()
      expect(lastQuery().offset).toBe(20)

      serverExpenses = manyExpenses(20)
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["admin", "expenses"] })
      })
      await waitFor(() => expect(lastQuery().offset).toBe(0))
      expect(await screen.findByText("EXP-0020")).toBeInTheDocument()
    })
  })

  describe("add dialog", () => {
    async function openAdd() {
      renderPage()
      await screen.findByText("No expenses yet")
      fireEvent.click(screen.getByRole("button", { name: "Add expense" }))
      return screen.findByLabelText("Amount")
    }

    function fill(amount: string, description = "Office rent") {
      fireEvent.change(screen.getByLabelText("Amount"), { target: { value: amount } })
      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: description },
      })
    }

    it("defaults the date to today (UTC) and the category to Other", async () => {
      await openAdd()
      expect(screen.getByLabelText("Date")).toHaveValue(
        new Date().toISOString().slice(0, 10)
      )
      expect(screen.getByLabelText("Category")).toHaveValue("other")
    })

    it("sends a trimmed create body and then closes, toasts and refreshes", async () => {
      await openAdd()
      fireEvent.change(screen.getByLabelText("Category"), { target: { value: "rent" } })
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-02" } })
      fireEvent.change(screen.getByLabelText("Payee"), { target: { value: " Landlord " } })
      fill("12.5", "  Office rent ")
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))

      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Expense added")
      )
      expect(writeCalls()).toHaveLength(1)
      expect(writeCalls()[0][0]).toBe("/admin/expenses")
      expect(writeCalls()[0][1].body).toEqual({
        expense_date: "2026-10-02",
        category: "rent",
        amount: 12.5,
        description: "Office rent",
        payee: "Landlord",
      })
      await waitFor(() =>
        expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument()
      )
      expect(await screen.findByText("Office rent")).toBeInTheDocument()
    })

    it("omits a blank payee", async () => {
      await openAdd()
      fill("5")
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))
      await waitFor(() => expect(writeCalls()).toHaveLength(1))
      expect(writeCalls()[0][1].body).not.toHaveProperty("payee")
    })

    it.each([["12.345"], ["abc"], ["1e2"], [""], ["0"], ["0.00"], ["-5"], ["1,5"]])(
      "rejects amount %j without a request",
      async (value) => {
        await openAdd()
        fill(value)
        fireEvent.click(screen.getByRole("button", { name: "Save expense" }))

        expect(await screen.findByRole("alert")).toBeInTheDocument()
        await flush()
        expect(writeCalls()).toHaveLength(0)
        expect(screen.getByLabelText("Amount")).toBeInTheDocument()
      }
    )

    it("requires a description", async () => {
      await openAdd()
      fill("5", "   ")
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Description is required."
      )
      await flush()
      expect(writeCalls()).toHaveLength(0)
    })

    it("sends one request on a double-click Save", async () => {
      await openAdd()
      fill("5")
      const save = screen.getByRole("button", { name: "Save expense" })
      fireEvent.click(save)
      fireEvent.click(save)
      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Expense added")
      )
      await flush()
      expect(writeCalls()).toHaveLength(1)
    })

    it("shows a server error inline, stays open and keeps the entered values", async () => {
      failSave = "Amount is not valid"
      await openAdd()
      fill("7.25", "Domain")
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))

      expect(await screen.findByText("Amount is not valid")).toBeInTheDocument()
      expect(screen.getByLabelText("Amount")).toHaveValue("7.25")
      expect(screen.getByLabelText("Description")).toHaveValue("Domain")
      expect(mockToast.success).not.toHaveBeenCalled()
      expect(screen.getByRole("button", { name: "Save expense" })).toBeEnabled()
    })

    it("invalidates the expenses and profit report query prefixes", async () => {
      await openAdd()
      const spy = jest.spyOn(queryClient, "invalidateQueries")
      fill("5")
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))
      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Expense added")
      )
      const keys = spy.mock.calls.map((c) => (c[0] as any).queryKey)
      expect(keys).toEqual(
        expect.arrayContaining([
          ["admin", "expenses"],
          ["admin", "profit-report"],
        ])
      )
    })
  })

  describe("edit dialog", () => {
    it("is prefilled and sends only changed fields", async () => {
      serverExpenses = [
        makeExpense(1, { amount: 100, description: "Rent", payee: "Landlord" }),
      ]
      renderPage()
      fireEvent.click(
        await screen.findByRole("button", { name: "Edit expense EXP-0001" })
      )

      expect(await screen.findByLabelText("Amount")).toHaveValue("100.00")
      expect(screen.getByLabelText("Description")).toHaveValue("Rent")
      expect(screen.getByLabelText("Payee")).toHaveValue("Landlord")
      expect(screen.getByLabelText("Category")).toHaveValue("rent")
      expect(screen.getByLabelText("Date")).toHaveValue("2026-10-05")

      fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "110.5" } })
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))

      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Expense updated")
      )
      expect(writeCalls()).toHaveLength(1)
      expect(writeCalls()[0][0]).toBe("/admin/expenses/exp_1")
      expect(writeCalls()[0][1].body).toEqual({ amount: 110.5 })
      expect(await screen.findByText("$110.50")).toBeInTheDocument()
    })

    it("sends an empty payee to clear it", async () => {
      serverExpenses = [makeExpense(1)]
      renderPage()
      fireEvent.click(
        await screen.findByRole("button", { name: "Edit expense EXP-0001" })
      )
      fireEvent.change(await screen.findByLabelText("Payee"), { target: { value: " " } })
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))
      await waitFor(() => expect(writeCalls()).toHaveLength(1))
      expect(writeCalls()[0][1].body).toEqual({ payee: "" })
    })

    it("closes without a request when nothing changed", async () => {
      serverExpenses = [makeExpense(1)]
      renderPage()
      fireEvent.click(
        await screen.findByRole("button", { name: "Edit expense EXP-0001" })
      )
      await screen.findByLabelText("Amount")
      fireEvent.click(screen.getByRole("button", { name: "Save expense" }))
      await waitFor(() =>
        expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument()
      )
      expect(writeCalls()).toHaveLength(0)
    })

    it("keeps typed values through a background refetch", async () => {
      serverExpenses = [makeExpense(1)]
      renderPage()
      fireEvent.click(
        await screen.findByRole("button", { name: "Edit expense EXP-0001" })
      )
      fireEvent.change(await screen.findByLabelText("Description"), {
        target: { value: "Typed" },
      })
      serverExpenses = [makeExpense(1, { description: "From server" })]
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["admin", "expenses"] })
      })
      expect(screen.getByLabelText("Description")).toHaveValue("Typed")
    })
  })

  describe("delete", () => {
    it("sends nothing when the confirmation is cancelled", async () => {
      serverExpenses = [makeExpense(1)]
      renderPage()
      fireEvent.click(
        await screen.findByRole("button", { name: "Delete expense EXP-0001" })
      )
      await confirmDialog("Keep expense")
      await flush()
      expect(writeCalls()).toHaveLength(0)
      expect(screen.getByText("EXP-0001")).toBeInTheDocument()
    })

    it("calls DELETE on confirm, toasts and refreshes the list", async () => {
      serverExpenses = [makeExpense(1), makeExpense(2)]
      renderPage()
      fireEvent.click(
        await screen.findByRole("button", { name: "Delete expense EXP-0001" })
      )
      await confirmDialog("Delete expense")

      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith("Expense deleted")
      )
      expect(writeCalls()).toEqual([
        ["/admin/expenses/exp_1", { method: "DELETE" }],
      ])
      await waitFor(() =>
        expect(screen.queryByText("EXP-0001")).not.toBeInTheDocument()
      )
      expect(screen.getByText("EXP-0002")).toBeInTheDocument()
    })

    it("toasts a delete failure", async () => {
      serverExpenses = [makeExpense(1)]
      renderPage()
      fireEvent.click(
        await screen.findByRole("button", { name: "Delete expense EXP-0001" })
      )
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error("Expense not found")))
      await confirmDialog("Delete expense")
      await waitFor(() =>
        expect(mockToast.error).toHaveBeenCalledWith("Expense not found")
      )
    })
  })
})
