/**
 * @jest-environment jsdom
 */
import "../../routes/purchases/__tests__/text-encoder-polyfill"
import { act, render, screen, fireEvent, within } from "@testing-library/react"
import "@testing-library/jest-dom"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const mockFetch = jest.fn()

jest.mock("../../lib/sdk", () => ({
  sdk: {
    client: { fetch: (...args: unknown[]) => mockFetch(...args) },
  },
}))

import ProductSupplierOffers from "../product-supplier-offers"

function renderWidget() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ProductSupplierOffers data={{ id: "prod_1" } as any} />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

const offer = (over: Record<string, any> = {}) => ({
  supplier_product_id: "sp_1",
  supplier: {
    id: "sup_1",
    name: "Acme",
    is_active: true,
    lead_time_days: 5,
    payment_terms: "Net 30",
  },
  supplier_sku: "AC-100",
  supplier_title: "Acme Oud",
  unit_cost: 12.5,
  is_lowest: false,
  ...over,
})

const twoVariants = () => [
  {
    variant_id: "variant_1",
    title: "100ml",
    sku: "SKU-100",
    offers: [
      offer({
        supplier_product_id: "sp_cheap",
        supplier: {
          id: "sup_cheap",
          name: "Cheap Co",
          is_active: true,
          lead_time_days: 3,
          payment_terms: "Prepaid",
        },
        supplier_sku: "CH-1",
        supplier_title: "Cheap oud",
        unit_cost: 4.25,
        is_lowest: true,
      }),
      offer({
        supplier_product_id: "sp_old",
        supplier: {
          id: "sup_old",
          name: "Old Supplier",
          is_active: false,
          lead_time_days: null,
          payment_terms: null,
        },
        supplier_sku: "OLD-1",
        supplier_title: null,
        unit_cost: 2,
      }),
    ],
  },
  { variant_id: "variant_2", title: "50ml", sku: "SKU-50", offers: [] },
]

// Behaves like a server: a fresh object graph on every response.
function useServer() {
  mockFetch.mockImplementation(() =>
    Promise.resolve({ variants: twoVariants() })
  )
}

const flush = () => act(async () => {})

describe("ProductSupplierOffers widget", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
  })

  it("renders offer details, formatted price and supplier link", async () => {
    useServer()
    renderWidget()

    expect(await screen.findByText("CH-1")).toBeInTheDocument()
    expect(screen.getByText("Cheap oud")).toBeInTheDocument()
    expect(screen.getByText("$4.25")).toBeInTheDocument()
    expect(screen.getByText("3 days")).toBeInTheDocument()
    expect(screen.getByText("Prepaid")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Cheap Co" })).toHaveAttribute(
      "href",
      "/suppliers/sup_cheap"
    )
    expect(mockFetch).toHaveBeenCalledWith(
      "/admin/supplier-offers",
      expect.objectContaining({ query: { product_id: "prod_1" } })
    )
  })

  it("pluralises lead time", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        variants: [
          {
            variant_id: "v",
            title: "t",
            sku: "s",
            offers: [
              offer({
                supplier_product_id: "a",
                supplier_sku: "ONE",
                supplier: { ...offer().supplier, id: "a", lead_time_days: 1 },
              }),
              offer({
                supplier_product_id: "b",
                supplier_sku: "TWO",
                supplier: { ...offer().supplier, id: "b", lead_time_days: 14 },
              }),
            ],
          },
        ],
      })
    )
    renderWidget()
    expect(await screen.findByText("1 day")).toBeInTheDocument()
    expect(screen.getByText("14 days")).toBeInTheDocument()
    expect(screen.queryByText("1 days")).not.toBeInTheDocument()
  })

  it("shows the Lowest badge only on the flagged offer", async () => {
    useServer()
    renderWidget()

    const cheapRow = (await screen.findByText("CH-1")).closest(
      "tr"
    ) as HTMLElement
    const oldRow = screen.getByText("OLD-1").closest("tr") as HTMLElement
    await flush()
    expect(within(cheapRow).getByText("Lowest")).toBeInTheDocument()
    expect(within(oldRow).queryByText("Lowest")).not.toBeInTheDocument()
    expect(screen.getAllByText("Lowest")).toHaveLength(1)
  })

  it("labels inactive suppliers and shows dashes for missing values", async () => {
    useServer()
    renderWidget()

    const oldRow = (await screen.findByText("OLD-1")).closest(
      "tr"
    ) as HTMLElement
    await flush()
    expect(within(oldRow).getByText("Inactive")).toBeInTheDocument()
    expect(within(oldRow).getAllByText("—")).toHaveLength(3)
    expect(screen.getAllByText("Inactive")).toHaveLength(1)
  })

  it("shows the empty state for a variant with no offers", async () => {
    useServer()
    renderWidget()

    expect(
      await screen.findByText("No supplier offers yet")
    ).toBeInTheDocument()
    expect(screen.getByText(/Products tab/)).toBeInTheDocument()
  })

  it("shows an error and recovers on Retry", async () => {
    useServer()
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error("boom")))
    renderWidget()

    expect(
      await screen.findByText("Something went wrong loading supplier offers.")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("CH-1")).toBeInTheDocument()
    await flush()
    expect(
      screen.queryByText("Something went wrong loading supplier offers.")
    ).not.toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
