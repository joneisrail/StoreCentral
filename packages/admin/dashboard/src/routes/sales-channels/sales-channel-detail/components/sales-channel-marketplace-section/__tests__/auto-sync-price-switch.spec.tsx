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
  save: vi.fn(),
  pending: false,
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@medusajs/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@medusajs/ui")>("@medusajs/ui")
  return { ...actual, toast: mocks.toast }
})

// The `auto_sync_price` backend field is added in Task 14; this is written
// against that contract and the hook is mocked.
vi.mock("../../../../../../hooks/api/marketplace-connections", () => ({
  useSaveMarketplaceConnection: () => ({
    mutateAsync: mocks.save,
    isPending: mocks.pending,
  }),
}))

import { AutoSyncPriceSwitch } from "../auto-sync-price-switch"

describe("AutoSyncPriceSwitch", () => {
  beforeEach(() => {
    mocks.pending = false
    mocks.save.mockReset().mockResolvedValue({})
    mocks.toast.success.mockReset()
    mocks.toast.error.mockReset()
  })
  afterEach(cleanup)

  it("is off when the field is absent and shows the helper text", () => {
    render(<AutoSyncPriceSwitch connectionId="conn_1" />)
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false"
    )
    expect(
      screen.getByText("salesChannels.marketplace.autoSyncPriceHint")
    ).toBeTruthy()
  })

  it("reflects an enabled connection", () => {
    render(<AutoSyncPriceSwitch connectionId="conn_1" checked />)
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true")
  })

  it("sends the payload and shows a saved toast", async () => {
    render(<AutoSyncPriceSwitch connectionId="conn_1" />)
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({ auto_sync_price: true })
    )
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
  })

  it("shows the backend message when saving fails", async () => {
    mocks.save.mockRejectedValue(new Error("nope"))
    render(<AutoSyncPriceSwitch connectionId="conn_1" checked />)
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({ auto_sync_price: false })
    )
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("nope"))
  })

  it("disables the switch while saving", () => {
    mocks.pending = true
    render(<AutoSyncPriceSwitch connectionId="conn_1" />)
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true)
  })

  it("can be disabled by the parent", () => {
    render(<AutoSyncPriceSwitch connectionId="conn_1" disabled />)
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true)
  })
})
