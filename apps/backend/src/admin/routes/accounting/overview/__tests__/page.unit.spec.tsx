/**
 * @jest-environment jsdom
 */
import "../../../purchases/__tests__/text-encoder-polyfill"
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react"
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

import OverviewPage, { config } from "../page"
import ProfitPage from "../../profit/page"
import AccountingPage from "../../page"

const DAY_MS = 24 * 60 * 60 * 1000

function todayUtc() {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function daysBetween(from: string, to: string) {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS
}

function renderPage(Page: React.ComponentType = OverviewPage) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/accounting/overview"]}>
        <Page />
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
        net_revenue: 1000,
        net_profit: 288.89,
      },
      { ...ZERO, period: "2026-11-02" },
      {
        ...ZERO,
        period: "2026-11-03",
        net_revenue: 500,
        net_profit: 144.445,
      },
      {
        ...ZERO,
        period: "2026-11-04",
        net_revenue: 50,
        net_profit: -22.22,
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
    ],
    expenses_by_category: [{ category: "rent", amount: 150 }],
    ...overrides,
  }
}

let serverReport: Report = makeReport()

const TOTALS = {
  balance_owed: 1234.5,
  overdue_total: 300,
  open_invoices: 7,
  suppliers: 3,
}

let serverTotals = { ...TOTALS }

function balancesResponse() {
  return {
    balances: [],
    count: serverTotals.suppliers,
    offset: 0,
    limit: 1,
    totals: { ...serverTotals },
  }
}

function balanceCalls() {
  return mockFetch.mock.calls.filter((c) => c[0] === "/admin/supplier-balances")
}

function installServer() {
  mockFetch.mockImplementation((url: string) => {
    if (url === "/admin/supplier-balances") {
      return Promise.resolve(balancesResponse())
    }
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
    .getAllByTestId("overview-profit-card")
    .find((el) => el.textContent?.startsWith(label))
  if (!found) {
    throw new Error(`no card ${label}`)
  }
  return found
}

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

const FIVE = [
  "Net revenue",
  "Gross profit",
  "Expenses",
  "Net profit",
  "Net margin",
]

describe("OverviewPage profit section", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    serverReport = makeReport()
    serverTotals = { ...TOTALS }
    installServer()
  })

  it("renders the heading and the five cards", async () => {
    renderPage()
    expect(
      screen.getByRole("heading", { name: "Overview" })
    ).toBeInTheDocument()
    expect(await screen.findByText("2026-11-01")).toBeInTheDocument()

    expect(card("Net revenue")).toHaveTextContent("$1,429.75")
    expect(card("Gross profit")).toHaveTextContent("$629.25")
    expect(card("Expenses")).toHaveTextContent("$229.25")
    expect(card("Net profit")).toHaveTextContent("$400.00")
    expect(card("Net margin")).toHaveTextContent("28.0%")
    expect(screen.getAllByTestId("overview-profit-card")).toHaveLength(5)
  })

  it("requests the last 30 days by day by default", async () => {
    renderPage()
    await screen.findByText("2026-11-01")

    expect(reportCalls()).toHaveLength(1)
    const query = lastQuery()
    expect(query.granularity).toBe("day")
    expect(query.to).toBe(iso(todayUtc()))
    expect(daysBetween(query.from, query.to)).toBe(29)
  })

  it("preset and granularity changes refetch", async () => {
    renderPage()
    await screen.findByText("2026-11-01")

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }))
    await waitFor(() =>
      expect(daysBetween(lastQuery().from, lastQuery().to)).toBe(6)
    )
    expect(lastQuery().to).toBe(iso(todayUtc()))

    fireEvent.change(screen.getByLabelText("Granularity"), {
      target: { value: "month" },
    })
    await waitFor(() => expect(lastQuery().granularity).toBe("month"))
  })

  it("trend lists period, net revenue and net profit with proportional bars", async () => {
    renderPage()
    await screen.findByText("2026-11-01")

    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(headers.slice(0, 3)).toEqual(["Period", "Net revenue", "Net profit"])

    const first = rowStarting("2026-11-01")
    expect(first).toHaveTextContent("$1,000.00")
    expect(first).toHaveTextContent("$288.89")
    expect(rowStarting("2026-11-04")).toHaveTextContent("-$22.22")

    expect(barWidth(first)).toBe("100%")
    expect(barWidth(rowStarting("2026-11-03"))).toBe("50%")
    expect(barWidth(rowStarting("2026-11-02"))).toBe("0%")
    expect(barWidth(rowStarting("2026-11-04"))).toBe("0%")
  })

  it("renders 0% bars when every period lost money", async () => {
    serverReport = makeReport({
      trend: [
        { ...ZERO, period: "2026-11-01", net_profit: -20 },
        { ...ZERO, period: "2026-11-02", net_profit: -5 },
      ],
    })
    renderPage()
    await screen.findByText("2026-11-01")

    expect(barWidth(rowStarting("2026-11-01"))).toBe("0%")
    expect(barWidth(rowStarting("2026-11-02"))).toBe("0%")
  })

  it("renders a dash for a null margin and still renders with zero revenue", async () => {
    serverReport = makeReport({
      summary: {
        ...ZERO,
        orders: 1,
        expenses: 50,
        net_profit: -50,
        net_margin_pct: null,
      },
    })
    renderPage()
    await screen.findByText("2026-11-01")

    expect(card("Net margin")).toHaveTextContent("—")
    expect(card("Net margin")).not.toHaveTextContent("%")
    expect(card("Net revenue")).toHaveTextContent("$0.00")
    expect(card("Net profit")).toHaveTextContent("-$50.00")
  })

  it("invalid range shows a message and sends no profit request", async () => {
    renderPage()
    await screen.findByText("2026-11-01")
    const before = reportCalls().length

    setDates("2026-03-10", "2026-03-01", "to")
    await flush()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The from date must not be after the to date."
    )
    expect(reportCalls().length).toBe(before)

    setDates("2025-01-01", "2026-01-01")
    await waitFor(() => expect(reportCalls().length).toBe(before + 1))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows a loading indicator while the first report loads", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}))
    renderPage()
    await flush()
    expect(
      within(screen.getByTestId("profit-section")).getByText("Loading...")
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("owed-section")).getByText("Loading...")
    ).toBeInTheDocument()
  })

  it("shows an error with a working Retry", async () => {
    mockFetch.mockImplementation((url: string) =>
      url === "/admin/supplier-balances"
        ? new Promise(() => {})
        : Promise.reject(new Error("boom"))
    )
    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    const failedQuery = lastQuery()
    const callsBefore = reportCalls().length

    installServer()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("2026-11-01")).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    expect(reportCalls().length).toBe(callsBefore + 1)
    expect(lastQuery()).toEqual(failedQuery)
  })

  it("keeps previous data while a new range loads", async () => {
    renderPage()
    await screen.findByText("2026-11-01")

    let resolveNext: (value: Report) => void = () => {}
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Report>((resolve) => {
          resolveNext = resolve
        })
    )
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }))
    await flush()

    expect(card("Net revenue")).toHaveTextContent("$1,429.75")
    expect(screen.getByText("Updating...")).toBeInTheDocument()

    await act(async () => {
      resolveNext(
        makeReport({
          summary: { ...ZERO, orders: 3, net_revenue: 90 },
          trend: [{ ...ZERO, period: "2026-12-01", net_revenue: 90 }],
        })
      )
    })
    expect(await screen.findByText("2026-12-01")).toBeInTheDocument()
    expect(card("Net revenue")).toHaveTextContent("$90.00")
    expect(screen.queryByText("Updating...")).not.toBeInTheDocument()
  })

  it('empty report shows "No orders or expenses in this range"', async () => {
    serverReport = makeReport({
      summary: { ...ZERO },
      trend: [{ ...ZERO, period: "2026-11-01" }],
      by_product: [],
      expenses_by_category: [],
    })
    renderPage()

    expect(
      await screen.findByText("No orders or expenses in this range")
    ).toBeInTheDocument()
    expect(screen.queryAllByTestId("overview-profit-card")).toHaveLength(0)
  })

  it("shows the report, not the empty state, when there are only expenses", async () => {
    serverReport = makeReport({
      summary: { ...ZERO, expenses: 1200, net_profit: -1200 },
      trend: [{ ...ZERO, period: "2026-11-01", expenses: 1200, net_profit: -1200 }],
      by_product: [],
      expenses_by_category: [{ category: "rent", amount: 1200 }],
    })
    renderPage()

    await waitFor(() =>
      expect(screen.getAllByTestId("overview-profit-card").length).toBe(5)
    )
    expect(
      screen.queryByText("No orders or expenses in this range")
    ).not.toBeInTheDocument()
    expect(card("Expenses")).toHaveTextContent("$1,200.00")
  })

  it("shows the same five card values as the Profit page for one report", async () => {
    const { unmount } = renderPage(ProfitPage)
    await screen.findByText("Blue Widget")
    const profitValues = FIVE.map((label) => {
      const el = screen
        .getAllByTestId("profit-card")
        .find((c) => c.textContent?.startsWith(label))!
      return el.textContent
    })
    unmount()

    renderPage()
    await screen.findByText("2026-11-01")
    const overviewValues = FIVE.map((label) => card(label).textContent)

    expect(overviewValues).toEqual(profitValues)
    expect(overviewValues[0]).toContain("$1,429.75")
  })
})

describe("OverviewPage owed section", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    serverReport = makeReport()
    serverTotals = { ...TOTALS }
    installServer()
  })

  const owed = () => within(screen.getByTestId("owed-section"))

  it("requests totals with limit 1 and renders the three figures as of today", async () => {
    renderPage()
    expect(await owed().findByText("$1,234.50")).toBeInTheDocument()

    expect(balanceCalls()).toHaveLength(1)
    expect(balanceCalls()[0][1]).toEqual({ query: { limit: 1 } })
    expect(owed().getByText("As of today")).toBeInTheDocument()
    const cards = owed().getAllByTestId("overview-owed-card")
    expect(cards).toHaveLength(3)
    const byLabel = (l: string) =>
      cards.find((c) => c.textContent?.startsWith(l))!
    expect(byLabel("Total owed")).toHaveTextContent("$1,234.50")
    expect(byLabel("Overdue")).toHaveTextContent("$300.00")
    expect(byLabel("Open invoices")).toHaveTextContent("7")
  })

  it("links to the Payables page", async () => {
    renderPage()
    await owed().findByText("$1,234.50")
    expect(owed().getByRole("link", { name: /payables/i })).toHaveAttribute(
      "href",
      "/accounting/payables"
    )
  })

  it("a balances failure shows Retry in the owed section while profit renders", async () => {
    mockFetch.mockImplementation((url: string) =>
      url === "/admin/supplier-balances"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(JSON.parse(JSON.stringify(serverReport)))
    )
    renderPage()

    expect(await screen.findByText("2026-11-01")).toBeInTheDocument()
    expect(card("Net revenue")).toHaveTextContent("$1,429.75")
    expect(
      await owed().findByText(/something went wrong/i)
    ).toBeInTheDocument()
    expect(owed().queryAllByTestId("overview-owed-card")).toHaveLength(0)

    installServer()
    fireEvent.click(owed().getByRole("button", { name: "Retry" }))
    expect(await owed().findByText("$1,234.50")).toBeInTheDocument()
    expect(owed().queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it("a profit failure leaves the owed cards rendered", async () => {
    mockFetch.mockImplementation((url: string) =>
      url === "/admin/supplier-balances"
        ? Promise.resolve(balancesResponse())
        : Promise.reject(new Error("boom"))
    )
    renderPage()

    expect(await owed().findByText("$1,234.50")).toBeInTheDocument()
    expect(
      await within(screen.getByTestId("profit-section")).findByText(
        /something went wrong/i
      )
    ).toBeInTheDocument()
    expect(owed().getAllByTestId("overview-owed-card")).toHaveLength(3)
    expect(owed().queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it("changing the date range does not refetch balances", async () => {
    renderPage()
    await owed().findByText("$1,234.50")
    await screen.findByText("2026-11-01")
    expect(balanceCalls()).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }))
    await waitFor(() =>
      expect(daysBetween(lastQuery().from, lastQuery().to)).toBe(6)
    )
    setDates("2025-01-01", "2026-01-01")
    await waitFor(() => expect(lastQuery().from).toBe("2025-01-01"))
    await flush()

    expect(balanceCalls()).toHaveLength(1)
  })

  it("zero totals render $0.00 cards without an error", async () => {
    serverTotals = {
      balance_owed: 0,
      overdue_total: 0,
      open_invoices: 0,
      suppliers: 0,
    }
    renderPage()

    await waitFor(() =>
      expect(owed().getAllByTestId("overview-owed-card")).toHaveLength(3)
    )
    const cards = owed().getAllByTestId("overview-owed-card")
    expect(cards[0]).toHaveTextContent("$0.00")
    expect(cards[1]).toHaveTextContent("$0.00")
    expect(cards[2]).toHaveTextContent("0")
    expect(owed().queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })
})

describe("accounting landing", () => {
  it("redirects /accounting to /accounting/overview without looping", async () => {
    const Where = () => <div data-testid="where">{useLocation().pathname}</div>
    render(
      <MemoryRouter initialEntries={["/accounting"]}>
        <Routes>
          <Route path="/accounting" element={<AccountingPage />} />
          <Route path="/accounting/overview" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByTestId("where")).toHaveTextContent(
      "/accounting/overview"
    )
  })
})

describe("route config", () => {
  it("labels the page Overview", () => {
    expect(config.label).toBe("Overview")
  })
})
