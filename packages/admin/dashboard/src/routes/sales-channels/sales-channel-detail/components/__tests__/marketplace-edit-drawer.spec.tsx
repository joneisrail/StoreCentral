// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.message !== undefined) {
        return `${key}|${opts.message}`
      }
      return key
    },
  }),
}))

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock("@medusajs/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@medusajs/ui")>("@medusajs/ui")
  return { ...actual, toast: mocks.toast }
})

vi.mock("../../../../../hooks/api/marketplace-connections", () => ({
  useSaveMarketplaceConnection: () => ({
    mutateAsync: mocks.save,
    isPending: false,
  }),
}))

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

import { MarketplaceEditDrawer } from "../marketplace-edit-drawer"

const connection = {
  id: "conn_1",
  marketplace: "shopify",
  display_name: null,
  status: "connected",
  last_error: null,
  last_synced_at: null,
  linked_listings: 0,
  sales_channel_id: "sc_1",
  managed: true,
  read_only: false,
  credentials_source: "database",
  sync_live: true,
  fields: { shop_domain: "my-store.myshopify.com", location_id: "42" },
  webhook_url: null,
} as never

const submit = async (result: unknown) => {
  mocks.save.mockResolvedValue(result)
  const onOpenChange = vi.fn()
  render(
    <MarketplaceEditDrawer
      connection={connection}
      open
      onOpenChange={onOpenChange}
    />
  )
  fireEvent.click(screen.getByText("actions.save"))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("MarketplaceEditDrawer", () => {
  it("shows success when the test passed and the connection started", async () => {
    await submit({ ok: true, test: { ok: true } })
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "salesChannels.marketplace.toast.saved"
    )
  })

  it("warns, with the server error, when apply failed after a passing test", async () => {
    await submit({ ok: false, error: "failed to start", test: { ok: true } })
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      "salesChannels.marketplace.toast.saveApplyFailed|failed to start"
    )
  })

  it("prefers the server message over the error code", async () => {
    await submit({
      ok: false,
      error: "invalid_input",
      message: "Bad domain",
      test: { ok: true },
    })
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      "salesChannels.marketplace.toast.saveApplyFailed|Bad domain"
    )
  })

  it("still reports a failed connection test", async () => {
    await submit({ ok: false, test: { ok: false, message: "rejected" } })
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      "salesChannels.marketplace.toast.saveTestFailed|rejected"
    )
  })
})
