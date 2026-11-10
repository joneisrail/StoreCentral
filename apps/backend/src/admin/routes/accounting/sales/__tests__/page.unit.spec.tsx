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

import SalesPage, { config } from "../page"

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
      <MemoryRouter initialEntries={["/accounting/sales"]}>
        <SalesPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

type Totals = {
  orders: number
  units: number
  gross_sales: number
  discounts: number
  net_sales: number
  shipping: number
  tax: number
  revenue: number
  refunds: number
  net_revenue: number
  average_order_value: number
}

const ZERO: Totals = {
  orders: 0,
  units: 0,
  gross_sales: 0,
  discounts: 0,
  net_sales: 0,
  shipping: 0,
  tax: 0,
  revenue: 0,
  refunds: 0,
  net_revenue: 0,
  average_order_value: 0,
}

type Report = {
  range: { from: string; to: string; granularity: string }
  currency_code: "usd"
  summary: Totals
  trend: (Totals & { period: string })[]
  top_products: {
    variant_id: string | null
    product_id: string | null
    title: string
    quantity: number
    revenue: number
  }[]
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    range: { from: "x", to: "y", granularity: "day" },
    currency_code: "usd",
    summary: {
      orders: 12,
      units: 34,
      gross_sales: 1500.5,
      discounts: 100.25,
      net_sales: 1400.25,
      shipping: 50,
      tax: 111.11,
      revenue: 1450.25,
      refunds: 20.5,
      net_revenue: 1429.75,
      average_order_value: 120.85,
    },
    trend: [
      {
        ...ZERO,
        period: "2026-11-01",
        orders: 2,
        revenue: 1000,
        refunds: 5,
        net_revenue: 995,
      },
      { ...ZERO, period: "2026-11-02" },
      {
        ...ZERO,
        period: "2026-11-03",
        orders: 1,
        revenue: 500,
        refunds: 0,
        net_revenue: 500,
      },
    ],
    top_products: [
      {
        variant_id: "var_1",
        product_id: "prod_1",
        title: "Blue Widget",
        quantity: 7,
        revenue: 700.5,
      },
      {
        variant_id: null,
        product_id: null,
        title: "Loose Gadget",
        quantity: 2,
        revenue: 80,
      },
    ],
    ...overrides,
  }
}

// Stateful mock server returning a fresh object per call.
let serverReport: Report = makeReport()

function installServer() {
  mockFetch.mockImplementation((url: string) => {
    if (url !== "/admin/sales-report") {
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    }
    return Promise.resolve(JSON.parse(JSON.stringify(serverReport)))
  })
}

function reportCalls() {
  return mockFetch.mock.calls.filter((c) => c[0] === "/admin/sales-report")
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
    .getAllByTestId("sales-card")
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

describe("SalesPage", () => {
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

    expect(card("Orders")).toHaveTextContent("12")
    expect(card("Units")).toHaveTextContent("34")
    expect(card("Gross sales")).toHaveTextContent("$1,500.50")
    expect(card("Discounts")).toHaveTextContent("$100.25")
    expect(card("Shipping")).toHaveTextContent("$50.00")
    expect(card("Tax")).toHaveTextContent("$111.11")
    expect(card("Revenue")).toHaveTextContent("$1,450.25")
    expect(card("Refunds")).toHaveTextContent("$20.50")
    expect(card("Net revenue")).toHaveTextContent("$1,429.75")
    expect(card("Average order value")).toHaveTextContent("$120.85")
  })

  it("preset buttons refetch", async () => {
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
  })

  it("changing granularity refetches with it", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    fireEvent.change(screen.getByLabelText("Granularity"), {
      target: { value: "week" },
    })
    await waitFor(() => expect(lastQuery().granularity).toBe("week"))

    fireEvent.change(screen.getByLabelText("Granularity"), {
      target: { value: "month" },
    })
    await waitFor(() => expect(lastQuery().granularity).toBe("month"))
  })

  it("a valid custom range is sent as typed", async () => {
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
  })

  it("an invalid custom range shows a message and sends no request", async () => {
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

    setDates("2025-01-01", "2026-01-01")
    await waitFor(() => expect(reportCalls().length).toBe(before + 1))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(lastQuery().from).toBe("2025-01-01")
    expect(lastQuery().to).toBe("2026-01-01")
  })

  it("a cleared date is invalid and sends no request", async () => {
    renderPage()
    await screen.findByText("Blue Widget")
    const before = reportCalls().length

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } })
    await flush()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid from and to date."
    )
    expect(reportCalls().length).toBe(before)
  })

  it("shows the trend rows with zeros for empty periods and proportional bars", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    const rows = screen.getAllByRole("row")
    const first = rows.find((r) => r.textContent?.startsWith("2026-11-01"))!
    const empty = rows.find((r) => r.textContent?.startsWith("2026-11-02"))!
    const third = rows.find((r) => r.textContent?.startsWith("2026-11-03"))!

    expect(first).toHaveTextContent("$1,000.00")
    expect(first).toHaveTextContent("$5.00")
    expect(first).toHaveTextContent("$995.00")
    expect(empty).toHaveTextContent("$0.00")

    const width = (row: HTMLElement) =>
      (
        row.querySelector('[data-testid="revenue-bar"]') as HTMLElement
      ).style.width
    expect(width(first)).toBe("100%")
    expect(width(empty)).toBe("0%")
    expect(width(third)).toBe("50%")
  })

  it("shows top products", async () => {
    renderPage()
    await screen.findByText("Blue Widget")

    const row = screen
      .getAllByRole("row")
      .find((r) => r.textContent?.startsWith("Blue Widget"))!
    expect(row).toHaveTextContent("7")
    expect(row).toHaveTextContent("$700.50")
    expect(screen.getByText("Loose Gadget")).toBeInTheDocument()
  })

  it("shows the previous data while a new range loads", async () => {
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
    expect(card("Orders")).toHaveTextContent("12")
    expect(screen.getByText("Updating...")).toBeInTheDocument()

    await act(async () => {
      resolveNext(
        makeReport({
          summary: { ...ZERO, orders: 3, units: 4, revenue: 90 },
          top_products: [
            {
              variant_id: "var_9",
              product_id: "prod_9",
              title: "Red Gizmo",
              quantity: 4,
              revenue: 90,
            },
          ],
        })
      )
    })

    expect(await screen.findByText("Red Gizmo")).toBeInTheDocument()
    expect(screen.queryByText("Blue Widget")).not.toBeInTheDocument()
    expect(screen.queryByText("Updating...")).not.toBeInTheDocument()
  })

  it("shows an empty state when the range has no orders", async () => {
    serverReport = makeReport({
      summary: { ...ZERO },
      trend: [{ ...ZERO, period: "2026-11-01" }],
      top_products: [],
    })

    renderPage()

    expect(await screen.findByText("No orders in this range")).toBeInTheDocument()
    expect(screen.queryAllByTestId("sales-card")).toHaveLength(0)
  })

  it("shows an error with a working Retry when loading fails", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))

    renderPage()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    installServer()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Blue Widget")).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })
})

describe("route config", () => {
  it("labels the page Sales with no nested override", () => {
    expect(config.label).toBe("Sales")
    expect((config as { nested?: string }).nested).toBeUndefined()
  })
})
