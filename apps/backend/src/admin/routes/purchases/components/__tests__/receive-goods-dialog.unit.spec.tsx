/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const mockFetch = jest.fn()
const mockStockLocationList = jest.fn()

jest.mock("../../../../lib/sdk", () => ({
  sdk: {
    client: {
      fetch: (...args: unknown[]) => mockFetch(...args),
    },
    admin: {
      stockLocation: {
        list: (...args: unknown[]) => mockStockLocationList(...args),
      },
    },
  },
}))

import { ReceiveGoodsDialog } from "../receive-goods-dialog"
import type { AdminPurchase } from "../../types"

const purchase: AdminPurchase = {
  id: "pur_1",
  reference: "PO-0001",
  status: "partially_received",
  currency_code: "usd",
  supplier: { id: "sup_1", name: "Acme Perfumes" },
  items: [
    {
      id: "pitem_1",
      variant_id: "variant_1",
      sku: "OUD-50",
      title: "Midnight Oud 50ml",
      quantity: 10,
      quantity_received: 4,
      remaining: 6,
      unit_cost: 12.5,
    },
    {
      id: "pitem_2",
      variant_id: "variant_2",
      sku: "ROSE-30",
      title: "Rose 30ml",
      quantity: 2,
      quantity_received: 0,
      remaining: 2,
      unit_cost: 7,
    },
    {
      id: "pitem_3",
      variant_id: "variant_3",
      sku: "MUSK-10",
      title: "Musk 10ml",
      quantity: 5,
      quantity_received: 5,
      remaining: 0,
      unit_cost: 3,
    },
  ],
  receipts: [],
  shipping_cost: 0,
  tax: 0,
  other_cost: 0,
  subtotal: 0,
  total: 0,
  notes: null,
  ordered_at: null,
  created_at: "2026-10-01T12:00:00.000Z",
}

function renderDialog(onReceived?: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReceiveGoodsDialog purchase={purchase} onReceived={onReceived} />
    </QueryClientProvider>
  )
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Receive goods" }))
  await screen.findByRole("dialog")
  await screen.findByRole("option", { name: "Main warehouse" })
}

const receiveButton = () => screen.getByRole("button", { name: "Receive" })
const qty = (title: string) =>
  screen.getByLabelText(`Quantity for ${title}`) as HTMLInputElement

describe("ReceiveGoodsDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStockLocationList.mockResolvedValue({
      stock_locations: [
        { id: "sloc_1", name: "Main warehouse" },
        { id: "sloc_2", name: "Back room" },
      ],
    })
  })

  it("shows each item with its remaining quantity as the maximum", async () => {
    renderDialog()
    await openDialog()

    expect(mockStockLocationList).toHaveBeenCalledWith({
      fields: "id,name",
      limit: 100,
    })
    expect(qty("Midnight Oud 50ml")).toHaveAttribute("max", "6")
    expect(qty("Midnight Oud 50ml")).toHaveAttribute("min", "0")
    expect(qty("Rose 30ml")).toHaveAttribute("max", "2")
    expect(screen.getByText("Remaining: 6")).toBeInTheDocument()
    expect(screen.getByText("Remaining: 2")).toBeInTheDocument()
    // Fully received items are shown but disabled.
    expect(qty("Musk 10ml")).toBeDisabled()
    expect(qty("Musk 10ml")).toHaveAttribute("max", "0")
    expect(screen.getByText("Remaining: 0")).toBeInTheDocument()
  })

  it("Receive is disabled until a stock location is chosen and at least one quantity is above 0", async () => {
    renderDialog()
    await openDialog()

    expect(receiveButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Stock location"), {
      target: { value: "sloc_1" },
    })
    expect(receiveButton()).toBeDisabled()

    fireEvent.change(qty("Rose 30ml"), { target: { value: "2" } })
    expect(receiveButton()).toBeEnabled()

    fireEvent.change(qty("Rose 30ml"), { target: { value: "0" } })
    expect(receiveButton()).toBeDisabled()

    fireEvent.change(qty("Rose 30ml"), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText("Stock location"), {
      target: { value: "" },
    })
    expect(receiveButton()).toBeDisabled()
  })

  it("a quantity above remaining shows an error and disables Receive", async () => {
    renderDialog()
    await openDialog()
    fireEvent.change(screen.getByLabelText("Stock location"), {
      target: { value: "sloc_1" },
    })

    fireEvent.change(qty("Midnight Oud 50ml"), { target: { value: "7" } })
    expect(
      screen.getByText("Cannot receive more than 6.")
    ).toBeInTheDocument()
    expect(receiveButton()).toBeDisabled()

    fireEvent.change(qty("Midnight Oud 50ml"), { target: { value: "6" } })
    expect(screen.queryByText(/Cannot receive more than/)).not.toBeInTheDocument()
    expect(receiveButton()).toBeEnabled()

    fireEvent.change(qty("Midnight Oud 50ml"), { target: { value: "1.5" } })
    expect(screen.getByText("Enter a whole number.")).toBeInTheDocument()
    expect(receiveButton()).toBeDisabled()
  })

  it("submitting posts { stock_location_id, items } containing only items with quantity above 0", async () => {
    mockFetch.mockResolvedValue({ purchase, receipt: { id: "rcpt_1" } })
    renderDialog()
    await openDialog()

    fireEvent.change(screen.getByLabelText("Stock location"), {
      target: { value: "sloc_2" },
    })
    fireEvent.change(qty("Midnight Oud 50ml"), { target: { value: "3" } })
    fireEvent.change(qty("Rose 30ml"), { target: { value: "0" } })
    fireEvent.click(receiveButton())

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(mockFetch).toHaveBeenCalledWith("/admin/purchases/pur_1/receive", {
      method: "POST",
      body: {
        stock_location_id: "sloc_2",
        items: [{ purchase_item_id: "pitem_1", quantity: 3 }],
      },
    })
  })

  it("success closes the dialog, calls onReceived and refreshes the purchase", async () => {
    mockFetch.mockResolvedValue({ purchase, receipt: { id: "rcpt_1" } })
    const onReceived = jest.fn()
    renderDialog(onReceived)
    await openDialog()

    fireEvent.change(screen.getByLabelText("Stock location"), {
      target: { value: "sloc_1" },
    })
    fireEvent.change(qty("Rose 30ml"), { target: { value: "2" } })
    fireEvent.click(receiveButton())

    await waitFor(() => expect(onReceived).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })

  it("a server error (for example over-receiving) is shown and the dialog stays open", async () => {
    mockFetch.mockRejectedValue(new Error("Cannot receive more than ordered"))
    const onReceived = jest.fn()
    renderDialog(onReceived)
    await openDialog()

    fireEvent.change(screen.getByLabelText("Stock location"), {
      target: { value: "sloc_1" },
    })
    fireEvent.change(qty("Rose 30ml"), { target: { value: "2" } })
    fireEvent.click(receiveButton())

    expect(
      await screen.findByText("Cannot receive more than ordered")
    ).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(onReceived).not.toHaveBeenCalled()
    expect(qty("Rose 30ml").value).toBe("2")
    expect(
      (screen.getByLabelText("Stock location") as HTMLSelectElement).value
    ).toBe("sloc_1")
    expect(receiveButton()).toBeEnabled()
  })
})
