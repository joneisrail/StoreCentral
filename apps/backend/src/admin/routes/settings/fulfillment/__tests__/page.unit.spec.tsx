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

  it("clearing a channel's handling-hours input removes its SLA instead of saving 0", async () => {
    mockSalesChannelList.mockResolvedValue({
      sales_channels: [
        {
          id: "sc_amazon",
          name: "Amazon",
          metadata: { handling_hours: 12, other_key: "kept" },
        },
      ],
      count: 1,
      limit: 20,
      offset: 0,
    })
    renderPage()

    const input = await screen.findByLabelText(/Amazon/i)
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(mockSalesChannelUpdate).toHaveBeenCalledWith("sc_amazon", {
        metadata: { other_key: "kept" },
      })
    )
  })

  it("leaving an already-empty handling-hours input empty saves nothing", async () => {
    renderPage()

    const input = await screen.findByLabelText(/Storefront/i)
    fireEvent.blur(input)

    // Give a (wrong) save a chance to happen.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockSalesChannelUpdate).not.toHaveBeenCalled()
  })

  describe("high-value order alert threshold", () => {
    it("shows the saved threshold and saves a new one to store metadata", async () => {
      mockStoreList.mockResolvedValue({
        stores: [
          {
            id: "store_1",
            metadata: { default_ship_from_location_id: "sloc_a", high_value_threshold: 750 },
          },
        ],
        count: 1,
        limit: 1,
        offset: 0,
      })
      renderPage()

      const input = (await screen.findByLabelText(
        /High-value order alert threshold/i
      )) as HTMLInputElement
      expect(input.value).toBe("750")

      fireEvent.change(input, { target: { value: "900" } })
      fireEvent.blur(input)

      await waitFor(() =>
        expect(mockStoreUpdate).toHaveBeenCalledWith("store_1", {
          metadata: {
            default_ship_from_location_id: "sloc_a",
            high_value_threshold: 900,
          },
        })
      )
    })

    it("blank sends an empty string so the merge deletes the key", async () => {
      mockStoreList.mockResolvedValue({
        stores: [
          {
            id: "store_1",
            metadata: { other_key: "kept", high_value_threshold: 750 },
          },
        ],
        count: 1,
        limit: 1,
        offset: 0,
      })
      renderPage()

      const input = await screen.findByLabelText(
        /High-value order alert threshold/i
      )
      fireEvent.change(input, { target: { value: "" } })
      fireEvent.blur(input)

      await waitFor(() =>
        expect(mockStoreUpdate).toHaveBeenCalledWith("store_1", {
          metadata: { other_key: "kept", high_value_threshold: "" },
        })
      )
    })

    it("does not save when the value is unchanged on blur", async () => {
      mockStoreList.mockResolvedValue({
        stores: [{ id: "store_1", metadata: { high_value_threshold: 750 } }],
        count: 1,
        limit: 1,
        offset: 0,
      })
      renderPage()

      const input = await screen.findByLabelText(
        /High-value order alert threshold/i
      )
      fireEvent.blur(input)

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(mockStoreUpdate).not.toHaveBeenCalled()
    })

    it("rejects a negative value with an inline error and saves nothing", async () => {
      renderPage()

      const input = await screen.findByLabelText(
        /High-value order alert threshold/i
      )
      fireEvent.change(input, { target: { value: "-5" } })
      fireEvent.blur(input)

      expect(await screen.findByText(/zero or more/i)).toBeInTheDocument()
      expect(mockStoreUpdate).not.toHaveBeenCalled()
    })
  })
})
