/**
 * @jest-environment jsdom
 */
import "../../../purchases/__tests__/text-encoder-polyfill"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const mockFetch = jest.fn()

jest.mock("../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

import ProfitPage, { config } from "../page"

const DAY_MS = 24 * 60 * 60 * 1000

function todayUtc() {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function daysBetween(from: string, to: string) {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/accounting/profit"]}>
        <ProfitPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

type Totals = {
  orders: number
  units: number
  net_revenue: number
  cogs: number
  gross_profit: number
  margin_pct: number | null
  units_without_cost: number
  expenses: number
  net_profit: number
  net_margin_pct: number | null
}

const ZERO: Totals = {
  orders: 0,
  units: 0,
  net_revenue: 0,
  cogs: 0,
  gross_profit: 0,
  margin_pct: null,
  units_without_cost: 0,
  expenses: 0,
  net_profit: 0,
  net_margin_pct: null,
}

type Report = {
  range: { from: string; to: string; granularity: string }
  currency_code: "usd"
  summary: Totals
  trend: (Totals & { period: string })[]
  by_product: {
    variant_id: string | null
    product_id: string | null
    title: string
    units: number
    revenue: number
    cogs: number
    gross_profit: number
    margin_pct: number | null
    units_without_cost: number
  }[]
  expenses_by_category: { category: string; amount: number }[]
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    range: { from: "x", to: "y", granularity: "day" },
    currency_code: "usd",
    summary: {
      orders: 12,
      units: 34,
      net_revenue: 1429.75,
      cogs: 800.5,
      gross_profit: 629.25,
      margin_pct: 44,
      units_without_cost: 0,
      expenses: 229.25,
      net_profit: 400,
      net_margin_pct: 27.98,
    },
    trend: [
      {
        ...ZERO,
        period: "2026-11-01",
        orders: 2,
        net_revenue: 1000,
        cogs: 600,
        gross_profit: 400,
        margin_pct: 40,
        expenses: 111.11,
        net_profit: 288.89,
        net_margin_pct: 28.9,
      },
      { ...ZERO, period: "2026-11-02" },
      {
        ...ZERO,
        period: "2026-11-03",
        orders: 1,
        net_revenue: 500,
        cogs: 300,
        gross_profit: 200,
        margin_pct: 40,
        expenses: 222.22,
        net_profit: -22.22,
        net_margin_pct: -4.4,
      },
    ],
    by_product: [
      {
        variant_id: "var_1",
        product_id: "prod_1",
        title: "Blue Widget",
        units: 7,
        revenue: 700.5,
        cogs: 350.25,
        gross_profit: 350.25,
        margin_pct: 50,
        units_without_cost: 0,
      },
      {
        variant_id: null,
        product_id: null,
        title: "Loose Gadget",
        units: 2,
        revenue: 80,
        cogs: 0,
        gross_profit: 80,
        margin_pct: null,
        units_without_cost: 2,
      },
    ],
    expenses_by_category: [
      { category: "rent", amount: 150 },
      { category: "shipping_packaging", amount: 70.25 },
      { category: "mystery", amount: 9 },
    ],
    ...overrides,
  }
}

// Stateful mock server returning a fresh object per call.
let serverReport: Report = makeReport()

function installServer() {
  mockFetch.mockImplementation((url: string) => {
    if (url !== "/admin/profit-report") {
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    }
    return Promise.resolve(JSON.parse(JSON.stringify(serverReport)))
  })
}

function reportCalls() {
  return mockFetch.mock.calls.filter((c) => c[0] === "/admin/profit-report")
}

function lastQuery() {
  const calls = reportCalls()
  return calls[calls.length - 1][1].query as {
    from: string
    to: string
    granularity: string
  }
}

async function flush() {
  await act(async () => {})
}

function card(label: string) {
  const found = screen
    .getAllByTestId("profit-card")
    .find((el) => el.textContent?.startsWith(label))
  if (!found) {
    throw new Error(`no card ${label}`)
  }
  return found
}

// Pass "to" first when the intermediate state would otherwise be a valid
// range (and so legitimately send a request).
function setDates(from: string, to: string, order: "from" | "to" = "from") {
  const setFrom = () =>
    fireEvent.change(screen.getByLabelText("From"), { target: { value: from } })
  const setTo = () =>
    fireEvent.change(screen.getByLabelText("To"), { target: { value: to } })
  if (order === "from") {
    setFrom()
    setTo()
  } else {
    setTo()
    setFrom()
  }
}

const barWidth = (row: HTMLElement) =>
  (row.querySelector('[data-testid="profit-bar"]') as HTMLElement).style.width

const rowStarting = (text: string) =>
  screen.getAllByRole("row").find((r) => r.textContent?.startsWith(text))!

const WARNING = /units sold have no purchase cost yet/

describe("ProfitPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    serverReport = makeReport()
    installServer()
  })

  it("loads the last 30 days by default and shows the cards", async () => {
    renderPage()

    expect(await screen.findByText("Blue Widget")).toBeInTheDocument()
    expect(reportCalls()).toHaveLength(1)
    const query = lastQuery()
    expect(query.granularity).toBe("day")
    expect(query.to).toBe(iso(todayUtc()))
    expect(daysBetween(query.from, query.to)).toBe(29)

    expect(card("Net revenue")).toHaveTextContent("$1,429.75")
    expect(card("Cost of goods")).toHaveTextContent("$800.50")
    expect(card("Gross profit")).toHaveTextContent("$629.25")
    expect(card("Margin")).toHaveTextContent("44.0%")
    expect(card("Units without cost")).toHaveTextContent("0")
  })

  it("renders a dash for a null margin", async () => {
    serverReport = makeReport({
      summary: { ...makeReport().summary, margin_pct: null },
    })
    renderPage()
    await screen.findByText("Blue Widget")

    expect(card("Margin")).toHaveTextContent("—")
    expect(card("Margin")).not.toHaveTextContent("%")
  })

  it("shows the Expenses, Net profit and Net margin cards", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    expect(card("Expenses")).toHaveTextContent("$229.25")
    expect(card("Net profit")).toHaveTextContent("$400.00")
    expect(card("Net margin")).toHaveTextContent("28.0%")
  })

  it("renders a dash for a null net margin and a negative USD value for a net loss", async () => {
    serverReport = makeReport({
      summary: {
        ...makeReport().summary,
        net_profit: -75.5,
        net_margin_pct: null,
      },
    })
    renderPage()
    await screen.findByText("Blue Widget")

    expect(card("Net margin")).toHaveTextContent("—")
    expect(card("Net margin")).not.toHaveTextContent("%")
    expect(card("Net profit")).toHaveTextContent("-$75.50")
  })

  it("trend rows show expenses and net profit after gross profit", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(headers.slice(0, 7)).toEqual([
      "Period",
      "Net revenue",
      "Cost of goods",
      "Gross profit",
      "Expenses",
      "Net profit",
      "Margin",
    ])

    const cells = (text: string) =>
      Array.from(rowStarting(text).querySelectorAll("td")).map(
        (c) => c.textContent
      )
    const first = cells("2026-11-01")
    expect(first[4]).toBe("$111.11")
    expect(first[5]).toBe("$288.89")
    const empty = cells("2026-11-02")
    expect(empty[4]).toBe("$0.00")
    expect(empty[5]).toBe("$0.00")
    const third = cells("2026-11-03")
    expect(third[4]).toBe("$222.22")
    expect(third[5]).toBe("-$22.22")
  })

  it("lists expenses by category in the order received, with a raw fallback", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    expect(screen.getByText("Expenses by category")).toBeInTheDocument()
    const rent = rowStarting("Rent")
    expect(rent).toHaveTextContent("$150.00")
    expect(rowStarting("Shipping & packaging")).toHaveTextContent("$70.25")
    expect(rowStarting("mystery")).toHaveTextContent("$9.00")

    const order = screen
      .getAllByRole("row")
      .map((r) => r.textContent ?? "")
      .filter((t) => /^(Rent|Shipping & packaging|mystery)/.test(t))
    expect(order.map((t) => t.split("$")[0])).toEqual([
      "Rent",
      "Shipping & packaging",
      "mystery",
    ])
  })

  it("hides the category table when there are no expenses", async () => {
    serverReport = makeReport({ expenses_by_category: [] })
    renderPage()
    await screen.findByText("Blue Widget")

    expect(screen.queryByText("Expenses by category")).not.toBeInTheDocument()
  })

  it("shows the warning only when units_without_cost > 0", async () => {
    const { unmount } = renderPage()
    await screen.findByText("Blue Widget")
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
    unmount()

    serverReport = makeReport({
      summary: { ...makeReport().summary, units_without_cost: 5 },
    })
    renderPage()
    expect(
      await screen.findByText(
        "5 units sold have no purchase cost yet, so their cost is not included."
      )
    ).toBeInTheDocument()
    expect(card("Units without cost")).toHaveTextContent("5")
  })

  it("preset buttons and granularity refetch with the right params", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }))
    await waitFor(() =>
      expect(daysBetween(lastQuery().from, lastQuery().to)).toBe(6)
    )
    expect(lastQuery().to).toBe(iso(todayUtc()))

    fireEvent.click(screen.getByRole("button", { name: "Last 90 days" }))
    await waitFor(() =>
      expect(daysBetween(lastQuery().from, lastQuery().to)).toBe(89)
    )
    expect(lastQuery().to).toBe(iso(todayUtc()))

    fireEvent.change(screen.getByLabelText("Granularity"), {
      target: { value: "week" },
    })
    await waitFor(() => expect(lastQuery().granularity).toBe("week"))
    expect(daysBetween(lastQuery().from, lastQuery().to)).toBe(89)

    fireEvent.change(screen.getByLabelText("Granularity"), {
      target: { value: "month" },
    })
    await waitFor(() => expect(lastQuery().granularity).toBe("month"))
  })

  it("a valid custom range is sent as typed, and a same-day range is valid", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    setDates("2026-01-01", "2026-01-31")
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        from: "2026-01-01",
        to: "2026-01-31",
        granularity: "day",
      })
    )

    setDates("2026-01-15", "2026-01-15", "to")
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        from: "2026-01-15",
        to: "2026-01-15",
        granularity: "day",
      })
    )
    await flush()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("invalid custom range shows a message and sends no request", async () => {
    renderPage()
    await screen.findByText("Blue Widget")
    const before = reportCalls().length

    setDates("2026-03-10", "2026-03-01", "to")
    await flush()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The from date must not be after the to date."
    )
    expect(reportCalls().length).toBe(before)

    // 367 days inclusive is one too many; 366 is allowed.
    setDates("2025-01-01", "2026-01-02")
    await flush()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The date range must be at most 366 days."
    )
    expect(reportCalls().length).toBe(before)

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } })
    await flush()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid from and to date."
    )
    expect(reportCalls().length).toBe(before)

    setDates("2025-01-01", "2026-01-01")
    await waitFor(() => expect(reportCalls().length).toBe(before + 1))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(lastQuery().from).toBe("2025-01-01")
    expect(lastQuery().to).toBe("2026-01-01")
  })

  it("keeps showing the last valid report under the message while the range is invalid", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    setDates("2026-03-10", "2026-03-01", "to")
    await flush()

    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Blue Widget")).toBeInTheDocument()
    expect(card("Net revenue")).toHaveTextContent("$1,429.75")
    // Not mislabeled as loading, and no spurious error.
    expect(screen.queryByText("Updating...")).not.toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it("trend rows show cost, profit and margin; the bar is 100% for the max row, 0% for zero or negative", async () => {
    serverReport = makeReport({
      trend: [
        {
          ...ZERO,
          period: "2026-11-01",
          orders: 2,
          net_revenue: 1000,
          cogs: 600,
          gross_profit: 400,
          margin_pct: 40,
        },
        { ...ZERO, period: "2026-11-02" },
        {
          ...ZERO,
          period: "2026-11-03",
          orders: 1,
          net_revenue: 500,
          cogs: 300,
          gross_profit: 200,
          margin_pct: 40,
        },
        {
          ...ZERO,
          period: "2026-11-04",
          orders: 1,
          net_revenue: 50,
          cogs: 100,
          gross_profit: -50,
          margin_pct: -100,
        },
      ],
    })
    renderPage()
    await screen.findByText("Blue Widget")

    const first = rowStarting("2026-11-01")
    expect(first).toHaveTextContent("$1,000.00")
    expect(first).toHaveTextContent("$600.00")
    expect(first).toHaveTextContent("$400.00")
    expect(first).toHaveTextContent("40.0%")

    const empty = rowStarting("2026-11-02")
    expect(empty).toHaveTextContent("$0.00")
    expect(empty).toHaveTextContent("—")

    const loss = rowStarting("2026-11-04")
    expect(loss).toHaveTextContent("-$50.00")
    expect(loss).toHaveTextContent("-100.0%")

    expect(barWidth(first)).toBe("100%")
    expect(barWidth(empty)).toBe("0%")
    expect(barWidth(rowStarting("2026-11-03"))).toBe("50%")
    expect(barWidth(loss)).toBe("0%")
  })

  it("renders 0% bars (never NaN or negative) when every period lost money", async () => {
    serverReport = makeReport({
      trend: [
        {
          ...ZERO,
          period: "2026-11-01",
          orders: 1,
          net_revenue: 10,
          cogs: 30,
          gross_profit: -20,
          margin_pct: -200,
        },
        {
          ...ZERO,
          period: "2026-11-02",
          orders: 1,
          net_revenue: 10,
          cogs: 15,
          gross_profit: -5,
          margin_pct: -50,
        },
      ],
    })
    renderPage()
    await screen.findByText("Blue Widget")

    expect(barWidth(rowStarting("2026-11-01"))).toBe("0%")
    expect(barWidth(rowStarting("2026-11-02"))).toBe("0%")
  })

  it("by product table shows title, units, revenue, cost, profit, margin", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    const row = rowStarting("Blue Widget")
    expect(row).toHaveTextContent("7")
    expect(row).toHaveTextContent("$700.50")
    expect(row).toHaveTextContent("$350.25")
    expect(row).toHaveTextContent("50.0%")

    const gadget = rowStarting("Loose Gadget")
    expect(gadget).toHaveTextContent("$80.00")
    expect(gadget).toHaveTextContent("—")
  })

  it("keeps previous data while a new range loads", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    let resolveNext: (value: Report) => void = () => {}
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Report>((resolve) => {
          resolveNext = resolve
        })
    )

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }))
    await flush()

    expect(screen.getByText("Blue Widget")).toBeInTheDocument()
    expect(card("Net revenue")).toHaveTextContent("$1,429.75")
    expect(screen.getByText("Updating...")).toBeInTheDocument()

    await act(async () => {
      resolveNext(
        makeReport({
          summary: { ...ZERO, orders: 3, units: 4, net_revenue: 90 },
          by_product: [
            {
              variant_id: "var_9",
              product_id: "prod_9",
              title: "Red Gizmo",
              units: 4,
              revenue: 90,
              cogs: 0,
              gross_profit: 90,
              margin_pct: 100,
              units_without_cost: 0,
            },
          ],
        })
      )
    })

    expect(await screen.findByText("Red Gizmo")).toBeInTheDocument()
    expect(screen.queryByText("Blue Widget")).not.toBeInTheDocument()
    expect(screen.queryByText("Updating...")).not.toBeInTheDocument()
  })

  it('empty report shows "No orders in this range"', async () => {
    serverReport = makeReport({
      summary: { ...ZERO },
      trend: [{ ...ZERO, period: "2026-11-01" }],
      by_product: [],
    })

    renderPage()

    expect(await screen.findByText("No orders in this range")).toBeInTheDocument()
    expect(screen.queryAllByTestId("profit-card")).toHaveLength(0)
  })

  it("is not empty when there are no orders but refunds left negative revenue", async () => {
    serverReport = makeReport({
      summary: { ...ZERO, net_revenue: -25, gross_profit: -25 },
      trend: [{ ...ZERO, period: "2026-11-01", net_revenue: -25, gross_profit: -25 }],
      by_product: [],
    })

    renderPage()

    await waitFor(() =>
      expect(screen.getAllByTestId("profit-card").length).toBeGreaterThan(0)
    )
    expect(screen.queryByText("No orders in this range")).not.toBeInTheDocument()
    expect(card("Net revenue")).toHaveTextContent("-$25.00")
    expect(card("Margin")).toHaveTextContent("—")
  })

  it("shows an error with a working Retry that repeats the same request", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    const failedQuery = lastQuery()
    const callsBefore = reportCalls().length

    installServer()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Blue Widget")).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    expect(reportCalls().length).toBe(callsBefore + 1)
    expect(lastQuery()).toEqual(failedQuery)
  })
})

describe("route config", () => {
  it("labels the page Profit with no nested override", () => {
    expect(config.label).toBe("Profit")
    expect((config as { nested?: string }).nested).toBeUndefined()
  })
})
