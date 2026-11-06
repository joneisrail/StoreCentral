/**
 * @jest-environment jsdom
 */
import "../../../../purchases/__tests__/text-encoder-polyfill"
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const mockFetch = jest.fn()

jest.mock("../../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

import { PurchasesTab } from "../purchases-tab"

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PurchasesTab supplierId="sup_1" />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

const makePurchase = (n: number) => ({
  id: `pur_${n}`,
  reference: `PO-${n}`,
  status: "ordered",
  total: 1234.5,
  ordered_at: "2026-01-02T00:00:00.000Z",
})

function serve(options: {
  purchases?: ReturnType<typeof makePurchase>[]
  count?: number
  summary?: unknown
  summaryError?: boolean
}) {
  mockFetch.mockImplementation((url: string, opts: any = {}) => {
    if (url.endsWith("/summary")) {
      if (options.summaryError) {
        return Promise.reject(new Error("boom"))
      }
      return Promise.resolve({
        summary: options.summary ?? {
          counts: { ordered: 2, received: 1 },
          total_ordered: 1000,
          total_received: 250.5,
          outstanding: 749.5,
        },
      })
    }
    const purchases = options.purchases ?? []
    const offset = opts.query?.offset ?? 0
    return Promise.resolve({
      purchases: purchases.slice(offset, offset + 20).map((p) => ({ ...p })),
      count: options.count ?? purchases.length,
      limit: 20,
      offset,
    })
  })
}

describe("PurchasesTab", () => {
  beforeEach(() => mockFetch.mockReset())

  it("shows status counts and USD totals", async () => {
    serve({ purchases: [makePurchase(1)] })
    renderTab()

    const ordered = await screen.findByTestId("count-ordered")
    expect(within(ordered).getByText("2")).toBeInTheDocument()
    expect(
      within(screen.getByTestId("count-received")).getByText("1")
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("count-draft")).getByText("0")
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("total-ordered")).getByText("$1,000.00")
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("total-received")).getByText("$250.50")
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("total-outstanding")).getByText("$749.50")
    ).toBeInTheDocument()
  })

  it("lists purchases with reference, status, total and a link", async () => {
    serve({ purchases: [makePurchase(1)] })
    renderTab()

    const link = await screen.findByRole("link", { name: "PO-1" })
    expect(link).toHaveAttribute("href", "/purchases/pur_1")
    expect(screen.getByText("Ordered", { selector: "span" })).toBeInTheDocument()
    expect(screen.getByText("$1,234.50")).toBeInTheDocument()
    const call = mockFetch.mock.calls.find((c) => c[0] === "/admin/purchases")
    expect(call?.[1].query.supplier_id).toBe("sup_1")
  })

  it("shows an empty message and zero cards with no purchases", async () => {
    serve({
      purchases: [],
      summary: {
        counts: {},
        total_ordered: 0,
        total_received: 0,
        outstanding: 0,
      },
    })
    renderTab()

    expect(await screen.findByText("No purchases yet.")).toBeInTheDocument()
    expect(
      within(screen.getByTestId("count-ordered")).getByText("0")
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("total-outstanding")).getByText("$0.00")
    ).toBeInTheDocument()
  })

  it("shows an error with Retry when the summary fails", async () => {
    serve({ summaryError: true })
    renderTab()

    expect(
      await screen.findByText("Something went wrong loading the summary.")
    ).toBeInTheDocument()
    serve({ purchases: [makePurchase(1)] })
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByTestId("total-ordered")).toBeInTheDocument()
  })

  it("clamps the page when the count shrinks", async () => {
    const all = Array.from({ length: 25 }, (_, i) => makePurchase(i + 1))
    serve({ purchases: all })
    renderTab()

    await screen.findByRole("link", { name: "PO-1" })
    // The list shrinks (purchases removed elsewhere) before the next page loads.
    serve({ purchases: all.slice(0, 5) })
    fireEvent.click(screen.getByRole("button", { name: "Next" }))

    // Page 2 is now out of range; the tab must fall back to the last valid page.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "PO-1" })).toBeInTheDocument()
    )
    expect(screen.queryByText("No purchases yet.")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
  })
})
