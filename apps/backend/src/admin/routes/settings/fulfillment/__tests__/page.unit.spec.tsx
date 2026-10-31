/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const mockStoreList = jest.fn()
const mockStoreUpdate = jest.fn()
const mockStockLocationList = jest.fn()
const mockSalesChannelList = jest.fn()
const mockSalesChannelUpdate = jest.fn()

jest.mock("../../../../lib/sdk", () => ({
  sdk: {
    admin: {
      store: {
        list: (...args: unknown[]) => mockStoreList(...args),
        update: (...args: unknown[]) => mockStoreUpdate(...args),
      },
      stockLocation: {
        list: (...args: unknown[]) => mockStockLocationList(...args),
      },
      salesChannel: {
        list: (...args: unknown[]) => mockSalesChannelList(...args),
        update: (...args: unknown[]) => mockSalesChannelUpdate(...args),
      },
    },
  },
}))

import FulfillmentSettingsPage from "../page"

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <FulfillmentSettingsPage />
    </QueryClientProvider>
  )
}

describe("FulfillmentSettingsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockStoreList.mockResolvedValue({
      stores: [
        {
          id: "store_1",
          metadata: { default_ship_from_location_id: "sloc_a" },
        },
      ],
      count: 1,
      limit: 1,
      offset: 0,
    })

    mockStockLocationList.mockResolvedValue({
      stock_locations: [
        { id: "sloc_a", name: "Warehouse A" },
        { id: "sloc_b", name: "Warehouse B" },
      ],
      count: 2,
      limit: 20,
      offset: 0,
    })

    mockSalesChannelList.mockResolvedValue({
      sales_channels: [
        { id: "sc_amazon", name: "Amazon", metadata: { handling_hours: 12 } },
        { id: "sc_storefront", name: "Storefront", metadata: null },
      ],
      count: 2,
      limit: 20,
      offset: 0,
    })

    mockStoreUpdate.mockResolvedValue({
      store: { id: "store_1", metadata: { default_ship_from_location_id: "sloc_b" } },
    })

    mockSalesChannelUpdate.mockResolvedValue({
      sales_channel: { id: "sc_amazon", name: "Amazon", metadata: { handling_hours: 24 } },
    })
  })

  it("renders the current default ship-from location and lets the admin change it", async () => {
    renderPage()

    expect(await screen.findByText(/Warehouse A/)).toBeInTheDocument()
  })

  it("renders a handling-hours input per sales channel and saves on change", async () => {
    renderPage()

    const input = await screen.findByLabelText(/Amazon/i)
    fireEvent.change(input, { target: { value: "24" } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(mockSalesChannelUpdate).toHaveBeenCalledWith(
        "sc_amazon",
        expect.objectContaining({
          metadata: expect.objectContaining({ handling_hours: 24 }),
        })
      )
    )
  })
})
