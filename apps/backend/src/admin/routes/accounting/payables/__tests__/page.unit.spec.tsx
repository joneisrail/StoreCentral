/**
 * @jest-environment jsdom
 */
import "../../../purchases/__tests__/text-encoder-polyfill"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"

const mockFetch = jest.fn()

jest.mock("../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

import PayablesPage, { config } from "../page"

let queryClient: QueryClient

const InvoicesStub = () => {
  const location = useLocation()
  return <div>{`Invoices ${location.pathname}${location.search}`}</div>
}

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/accounting/payables"]}>
        <Routes>
          <Route path="/accounting/payables" element={<PayablesPage />} />
          <Route path="/accounting/invoices" element={<InvoicesStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

type Balance = {
  supplier: { id: string; name: string }
  invoiced_total: number
  paid_total: number
  balance_owed: number
  overdue_total: number
  open_invoices: number
}

function makeBalance(n: number, overrides: Partial<Balance> = {}): Balance {
  return {
    supplier: { id: `sup_${n}`, name: `Supplier ${String(n).padStart(2, "0")}` },
    invoiced_total: 100,
    paid_total: 40,
    balance_owed: 60,
    overdue_total: 0,
    open_invoices: 2,
    ...overrides,
  }
}

// Stateful mock server returning fresh objects per call, in a fixed order.
let serverBalances: Balance[] = []

function installServer() {
  mockFetch.mockImplementation(
    (url: string, opts?: { query?: Record<string, unknown> }) => {
      if (url !== "/admin/supplier-balances") {
        return Promise.reject(new Error(`unexpected fetch ${url}`))
      }
      const query = opts?.query ?? {}
      const offset = Number(query.offset ?? 0)
      const limit = Number(query.limit ?? 20)
      let rows = serverBalances
      if (query.q) {
        rows = rows.filter((b) => b.supplier.name.includes(String(query.q)))
      }
      return Promise.resolve({
        balances: rows
          .slice(offset, offset + limit)
          .map((b) => ({ ...b, supplier: { ...b.supplier } })),
        count: rows.length,
        offset,
        limit,
      })
    }
  )
}

function listCalls() {
  return mockFetch.mock.calls.filter(
    (c) => c[0] === "/admin/supplier-balances" && c[1]?.query
  )
}

function lastQuery() {
  const calls = listCalls()
  return calls[calls.length - 1][1].query
}

function manyBalances(count: number) {
  return Array.from({ length: count }, (_, i) => makeBalance(i + 1))
}

async function flush() {
  await act(async () => {})
}

describe("PayablesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    serverBalances = []
    installServer()
  })

  it("shows supplier, invoiced, paid, owed, overdue and open invoices", async () => {
    serverBalances = [
      makeBalance(1, {
        invoiced_total: 1234.5,
        paid_total: 200,
        balance_owed: 1034.5,
        overdue_total: 300.25,
        open_invoices: 3,
      }),
    ]

    renderPage()

    expect(await screen.findByText("Supplier 01")).toBeInTheDocument()
    const row = screen.getAllByRole("row")[1]
    expect(row).toHaveTextContent("$1,234.50")
    expect(row).toHaveTextContent("$200.00")
    expect(row).toHaveTextContent("$1,034.50")
    expect(row).toHaveTextContent("$300.25")
    expect(row).toHaveTextContent("3")
    expect(mockFetch).toHaveBeenCalledWith("/admin/supplier-balances", {
      query: { limit: 20, offset: 0 },
    })
  })

  it("highlights overdue only when it is greater than zero", async () => {
    serverBalances = [
      makeBalance(1, { overdue_total: 50 }),
      makeBalance(2, { overdue_total: 0 }),
    ]

    renderPage()
    await screen.findByText("Supplier 01")

    const highlighted = screen.getAllByTestId("overdue-amount")
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]).toHaveTextContent("$50.00")
    // The zero-overdue row still shows $0.00, unhighlighted.
    expect(screen.getAllByRole("row")[2]).toHaveTextContent("$0.00")
  })

  it("keeps the order the server returned", async () => {
    serverBalances = [
      makeBalance(3),
      makeBalance(1),
      makeBalance(2),
    ]

    renderPage()
    await screen.findByText("Supplier 03")

    const rows = screen.getAllByRole("row")
    expect(rows[1]).toHaveTextContent("Supplier 03")
    expect(rows[2]).toHaveTextContent("Supplier 01")
    expect(rows[3]).toHaveTextContent("Supplier 02")
  })

  it("links each supplier to its filtered invoice list", async () => {
    serverBalances = [makeBalance(1)]

    renderPage()

    const link = await screen.findByRole("link", { name: "Supplier 01" })
    expect(link).toHaveAttribute(
      "href",
      "/accounting/invoices?supplier_id=sup_1"
    )
    fireEvent.click(link)
    expect(
      await screen.findByText("Invoices /accounting/invoices?supplier_id=sup_1")
    ).toBeInTheDocument()
  })

  it("search sends q after a short debounce and resets the offset", async () => {
    serverBalances = manyBalances(45)

    renderPage()
    await screen.findByText("Supplier 01")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Supplier 21")

    fireEvent.change(screen.getByLabelText("Search suppliers"), {
      target: { value: "Supplier 3" },
    })
    await flush()
    expect(listCalls().some((c) => c[1].query.q)).toBe(false)

    await waitFor(() =>
      expect(lastQuery()).toEqual({ limit: 20, offset: 0, q: "Supplier 3" })
    )
    expect(await screen.findByText("Supplier 30")).toBeInTheDocument()
    expect(
      listCalls().filter((c) => c[1].query.q && c[1].query.offset !== 0)
    ).toEqual([])
  })

  it("pressing Enter searches immediately", async () => {
    serverBalances = manyBalances(45)

    renderPage()
    await screen.findByText("Supplier 01")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Supplier 21")

    const input = screen.getByLabelText("Search suppliers")
    fireEvent.change(input, { target: { value: "Supplier 4" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(
      () =>
        expect(lastQuery()).toEqual({ limit: 20, offset: 0, q: "Supplier 4" }),
      { timeout: 150 }
    )
  })

  it("paginates with Next and Previous from count and offset", async () => {
    serverBalances = manyBalances(45)

    renderPage()
    await screen.findByText("Supplier 01")

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Supplier 21")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Supplier 41")
    expect(lastQuery().offset).toBe(40)
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    await screen.findByText("Supplier 21")
    expect(lastQuery().offset).toBe(20)
  })

  it("clamps to the last valid page when the count shrinks", async () => {
    serverBalances = manyBalances(45)

    renderPage()
    await screen.findByText("Supplier 01")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Supplier 21")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Supplier 41")

    serverBalances = manyBalances(25)
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "supplier-balances"],
      })
    })

    await waitFor(() => expect(lastQuery().offset).toBe(20))
    expect(await screen.findByText("Supplier 25")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("clamps back to the first page when the count drops to zero", async () => {
    serverBalances = manyBalances(25)

    renderPage()
    await screen.findByText("Supplier 01")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Supplier 21")

    serverBalances = []
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "supplier-balances"],
      })
    })

    await waitFor(() => expect(lastQuery().offset).toBe(0))
    expect(
      await screen.findByText("No supplier balances yet.")
    ).toBeInTheDocument()
  })

  it("does not refetch when nothing changed (no reset loops)", async () => {
    serverBalances = manyBalances(25)

    renderPage()
    await screen.findByText("Supplier 01")
    await flush()
    const before = listCalls().length
    await flush()
    expect(listCalls().length).toBe(before)
  })

  it("shows a search-specific empty text", async () => {
    serverBalances = manyBalances(3)

    renderPage()
    await screen.findByText("Supplier 01")

    const input = screen.getByLabelText("Search suppliers")
    fireEvent.change(input, { target: { value: "zzz" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(
      await screen.findByText("No suppliers match your search.")
    ).toBeInTheDocument()
  })

  it("shows an error with a working Retry when loading fails", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    serverBalances = [makeBalance(1)]
    installServer()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Supplier 01")).toBeInTheDocument()
  })
})

describe("route config", () => {
  it("labels the page Payables with no nested override", () => {
    expect(config.label).toBe("Payables")
    expect((config as { nested?: string }).nested).toBeUndefined()
  })
})
