/**
 * @jest-environment jsdom
 */
import "../../__tests__/text-encoder-polyfill"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const mockFetch = jest.fn()

jest.mock("../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
  },
}))

jest.mock("../[id]/components/details-tab", () => ({
  DetailsTab: () => <div>details tab</div>,
}))
jest.mock("../[id]/components/products-tab", () => ({
  ProductsTab: () => <div>products tab</div>,
}))
jest.mock("../[id]/components/purchases-tab", () => ({
  PurchasesTab: () => <div>purchases tab</div>,
}))

import SuppliersPage, { config as suppliersConfig } from "../page"
import SupplierDetailPage from "../[id]/page"
import PurchaseDetailPage from "../../[id]/page"
import { config as reviewsConfig } from "../../../reviews/page"
import { config as fulfillmentQueueConfig } from "../../../fulfillment-queue/page"

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Mirrors the file-based routes: purchases/[id] next to purchases/suppliers.
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
          <Route path="/purchases/suppliers" element={<SuppliersPage />} />
          <Route
            path="/purchases/suppliers/:id"
            element={<SupplierDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const acme = {
  id: "sup_1",
  name: "Acme Perfumes",
  email: "sales@acme.test",
  phone: null,
  address: null,
  notes: null,
  is_active: true,
  created_at: "2026-10-01T00:00:00.000Z",
}

describe("supplier routes under /purchases", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockImplementation((url: string) => {
      if (url === "/admin/suppliers") {
        return Promise.resolve({ suppliers: [acme], count: 1, offset: 0, limit: 20 })
      }
      if (url === "/admin/suppliers/sup_1") {
        return Promise.resolve({ supplier: acme })
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
  })

  it("renders the supplier list at /purchases/suppliers, not the purchase detail", async () => {
    renderAt("/purchases/suppliers")

    expect(await screen.findByRole("heading", { name: "Suppliers" })).toBeInTheDocument()
    expect(await screen.findByText("Acme Perfumes")).toBeInTheDocument()
    const urls = mockFetch.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.startsWith("/admin/purchases"))).toBe(false)
  })

  it("renders the supplier detail at /purchases/suppliers/:id", async () => {
    renderAt("/purchases/suppliers/sup_1")

    expect(
      await screen.findByRole("heading", { name: "Acme Perfumes" })
    ).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/admin/suppliers/sup_1")
    const urls = mockFetch.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.startsWith("/admin/purchases"))).toBe(false)
  })
})

describe("sidebar menu config", () => {
  it("nests Reviews under Products", () => {
    expect(reviewsConfig.label).toBe("Reviews")
    expect((reviewsConfig as { nested?: string }).nested).toBe("/products")
  })

  it("nests Fulfillment Queue under Orders", () => {
    expect(fulfillmentQueueConfig.label).toBe("Fulfillment Queue")
    expect((fulfillmentQueueConfig as { nested?: string }).nested).toBe("/orders")
  })

  it("keeps Suppliers un-nested (nesting comes from the /purchases URL prefix)", () => {
    expect(suppliersConfig.label).toBe("Suppliers")
    expect((suppliersConfig as { nested?: string }).nested).toBeUndefined()
  })
})
