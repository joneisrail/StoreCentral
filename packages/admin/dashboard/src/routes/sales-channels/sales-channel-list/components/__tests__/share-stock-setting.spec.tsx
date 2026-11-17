// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const mocks = vi.hoisted(() => ({
  settings: { data: undefined as unknown, isPending: false, isError: false },
  update: vi.fn(),
  pending: false,
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@medusajs/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@medusajs/ui")>("@medusajs/ui")
  return { ...actual, toast: mocks.toast }
})

vi.mock("../../../../../hooks/api/channel-offers", () => ({
  useChannelStockSettings: () => mocks.settings,
  useUpdateChannelStockSettings: () => ({
    mutateAsync: mocks.update,
    isPending: mocks.pending,
  }),
}))

import { ShareStockSetting } from "../share-stock-setting"

describe("ShareStockSetting", () => {
  beforeEach(() => {
    mocks.settings = {
      data: { share_stock_after_sale: false },
      isPending: false,
      isError: false,
    }
    mocks.pending = false
    mocks.update.mockReset().mockResolvedValue({ share_stock_after_sale: true })
    mocks.toast.success.mockReset()
    mocks.toast.error.mockReset()
  })
  afterEach(cleanup)

  it("shows the helper text", () => {
    render(<ShareStockSetting />)
    expect(
      screen.getByText("salesChannels.channelStock.shareStockHint")
    ).toBeTruthy()
  })

  it("sends the new value and shows a success toast", async () => {
    render(<ShareStockSetting />)
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        share_stock_after_sale: true,
      })
    )
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
  })

  it("turns the setting off when it is on", async () => {
    mocks.settings.data = { share_stock_after_sale: true }
    render(<ShareStockSetting />)
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        share_stock_after_sale: false,
      })
    )
  })

  it("shows the backend message in an error toast", async () => {
    mocks.update.mockRejectedValue(new Error("boom"))
    render(<ShareStockSetting />)
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("boom"))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it("is disabled until the setting has loaded", () => {
    mocks.settings.data = undefined
    render(<ShareStockSetting />)
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true)
  })

  it("falls back to a translated message when the error has none", async () => {
    mocks.update.mockRejectedValue({})
    render(<ShareStockSetting />)
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "channelPricing.edit.saveFailed"
      )
    )
  })

  it("disables the switch while saving", () => {
    mocks.pending = true
    render(<ShareStockSetting />)
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true)
  })

  it("defaults to off when the setting is absent", () => {
    mocks.settings.data = {}
    render(<ShareStockSetting />)
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false"
    )
  })
})
