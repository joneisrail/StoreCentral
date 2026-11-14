// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { mutateAsync, toastSuccess, toastError } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("../../../../../../hooks/api/order-shipping", () => ({
  useMarkOrderShipped: () => ({ mutateAsync }),
}))
vi.mock("@medusajs/ui", async () => {
  const actual = await vi.importActual<any>("@medusajs/ui")
  return { ...actual, toast: { success: toastSuccess, error: toastError } }
})

import { MarkShippedModal } from "./mark-shipped-modal"
import { buildTrackingUrl } from "./tracking-url"

afterEach(() => {
  cleanup()
  ;[mutateAsync, toastSuccess, toastError].forEach((m) => m.mockReset())
})

const setup = () => {
  const onOpenChange = vi.fn()
  render(
    <MarkShippedModal
      order={{ id: "order_1", display_id: 5 }}
      open
      onOpenChange={onOpenChange}
    />
  )
  return { onOpenChange }
}

const confirm = () =>
  screen.getByRole("button", {
    name: "orders.shipping.markShippedConfirm",
  }) as HTMLButtonElement

const fill = async (carrier: string, number: string) => {
  await userEvent.type(
    screen.getByLabelText("orders.shipping.carrier"),
    carrier
  )
  await userEvent.type(
    screen.getByLabelText("orders.shipping.trackingNumber"),
    number
  )
}

describe("buildTrackingUrl", () => {
  it.each([
    ["UPS", "https://www.ups.com/track?tracknum=1Z%2099"],
    ["fedex", "https://www.fedex.com/fedextrack/?trknbr=1Z%2099"],
    ["USPS", "https://tools.usps.com/go/TrackConfirmAction?tLabels=1Z%2099"],
    ["DHL", "https://www.dhl.com/en/express/tracking.html?AWB=1Z%2099"],
  ])("%s", (carrier, url) => {
    expect(buildTrackingUrl(carrier, "1Z 99")).toBe(url)
  })

  it("returns nothing for unknown carriers", () => {
    expect(buildTrackingUrl("Local Courier", "123")).toBeUndefined()
    expect(buildTrackingUrl("Other", "123")).toBeUndefined()
  })
})

describe("MarkShippedModal", () => {
  it("requires a carrier and a tracking number", async () => {
    setup()
    expect(confirm().disabled).toBe(true)
    await userEvent.type(
      screen.getByLabelText("orders.shipping.carrier"),
      "UPS"
    )
    expect(confirm().disabled).toBe(true)
    await userEvent.type(
      screen.getByLabelText("orders.shipping.trackingNumber"),
      "1Z"
    )
    expect(confirm().disabled).toBe(false)
  })

  it("auto-fills the tracking url for a known carrier; defaults send no date and notify", async () => {
    mutateAsync.mockResolvedValue({})
    const { onOpenChange } = setup()
    await fill("UPS", "1Z999")
    await userEvent.click(confirm())
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: "order_1",
        carrier: "UPS",
        tracking_number: "1Z999",
        tracking_url: "https://www.ups.com/track?tracknum=1Z999",
      })
    )
    expect(toastSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("sends no url for an unknown carrier", async () => {
    mutateAsync.mockResolvedValue({})
    setup()
    await fill("Local Courier", "55")
    await userEvent.click(confirm())
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: "order_1",
        carrier: "Local Courier",
        tracking_number: "55",
      })
    )
  })

  it("keeps a custom tracking url", async () => {
    mutateAsync.mockResolvedValue({})
    setup()
    await fill("UPS", "1Z")
    await userEvent.type(
      screen.getByLabelText("orders.shipping.trackingUrl"),
      "https://example.com/t/1Z"
    )
    await userEvent.click(confirm())
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ tracking_url: "https://example.com/t/1Z" })
      )
    )
  })

  it("sends shipped_at only when the date changed, and no_notification only when off", async () => {
    mutateAsync.mockResolvedValue({})
    setup()
    await fill("USPS", "9400")
    const date = screen.getByLabelText("orders.shipping.shipDate")
    await userEvent.clear(date)
    await userEvent.type(date, "2020-03-04")
    await userEvent.click(screen.getByRole("switch"))
    await userEvent.click(confirm())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.no_notification).toBe(true)
    expect(new Date(payload.shipped_at).getFullYear()).toBe(2020)
    expect(payload.shipped_at).toMatch(/Z$/)
  })

  it("shows the server message and stays open on failure", async () => {
    mutateAsync.mockRejectedValue(new Error("Order is on hold"))
    const { onOpenChange } = setup()
    await fill("UPS", "1Z")
    await userEvent.click(confirm())
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Order is on hold")
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("does not double submit", async () => {
    let resolve: (v: unknown) => void = () => {}
    mutateAsync.mockReturnValue(new Promise((r) => (resolve = r)))
    setup()
    await fill("UPS", "1Z")
    await userEvent.click(confirm())
    await userEvent.click(confirm())
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    resolve({})
  })
})
