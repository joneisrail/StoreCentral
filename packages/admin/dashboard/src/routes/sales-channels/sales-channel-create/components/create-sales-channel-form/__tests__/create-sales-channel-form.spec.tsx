// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { ReactNode } from "react"
import { FormProvider } from "react-hook-form"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (opts?.message) {
        return `${key}|${opts.message}`
      }
      return key
    },
  }),
}))

const mocks = vi.hoisted(() => ({
  plainCreate: vi.fn(),
  marketplaceCreate: vi.fn(),
  handleSuccess: vi.fn(),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@medusajs/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@medusajs/ui")>("@medusajs/ui")
  return { ...actual, toast: mocks.toast }
})

vi.mock("../../../../../../hooks/api/sales-channels", () => ({
  useCreateSalesChannel: () => ({
    mutateAsync: mocks.plainCreate,
    isPending: false,
  }),
}))
vi.mock("../../../../../../hooks/api/marketplace-connections", () => ({
  useCreateMarketplaceSalesChannel: () => ({
    mutateAsync: mocks.marketplaceCreate,
    isPending: false,
  }),
}))

vi.mock("../../../../../../components/modals", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const RouteFocusModal: any = Pass
  const FormStub = ({ form, children }: any) => (
    <FormProvider {...form}>{children}</FormProvider>
  )
  RouteFocusModal.Form = FormStub
  RouteFocusModal.Header = Pass
  RouteFocusModal.Body = Pass
  RouteFocusModal.Footer = Pass
  const CloseStub = ({ children }: any) => <>{children}</>
  RouteFocusModal.Close = CloseStub
  return {
    RouteFocusModal,
    useRouteModal: () => ({ handleSuccess: mocks.handleSuccess }),
  }
})

// jsdom lacks ResizeObserver, which Radix's Switch measures with.
if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

import { CreateSalesChannelForm } from "../create-sales-channel-form"

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "actions.save" }))
  })
}

const fillBase = () => {
  fill("fields.name", "Shopify US")
  fill("fields.description", "US store")
}

const mockMarketplaceResult = (result: Record<string, unknown>) =>
  mocks.marketplaceCreate.mockImplementation(async (_input, opts) => {
    const full = {
      sales_channel: { id: "sc_new", name: "Shopify US" },
      ...result,
    }
    opts?.onSuccess?.(full)
    return full
  })

beforeEach(() => {
  mocks.plainCreate.mockImplementation(async (_input, opts) => {
    opts?.onSuccess?.({ sales_channel: { id: "sc_plain" } })
  })
})

afterEach(() => {
  cleanup()
  Object.values(mocks.toast).forEach((f) => f.mockReset())
  mocks.plainCreate.mockReset()
  mocks.marketplaceCreate.mockReset()
  mocks.handleSuccess.mockReset()
})

describe("CreateSalesChannelForm marketplace", () => {
  it("submit with No marketplace calls the plain create", async () => {
    render(<CreateSalesChannelForm />)
    fillBase()
    await submit()

    await waitFor(() => expect(mocks.plainCreate).toHaveBeenCalled())
    expect(mocks.plainCreate.mock.calls[0][0]).toEqual({
      name: "Shopify US",
      description: "US store",
      is_disabled: false,
    })
    expect(mocks.marketplaceCreate).not.toHaveBeenCalled()
    expect(mocks.handleSuccess).toHaveBeenCalledWith("../sc_plain")
  })

  it("submit with a marketplace calls the marketplace create with snake_case fields", async () => {
    mockMarketplaceResult({ connection_status: "connected" })
    render(<CreateSalesChannelForm />)
    fillBase()
    fireEvent.click(screen.getByRole("radio", { name: "Shopify" }))
    fill("Shop domain", "us.myshopify.com")
    fill("Access token", "shpat_x")
    fill("Webhook secret", "whsec")
    fill("Location ID", "123")
    await submit()

    await waitFor(() => expect(mocks.marketplaceCreate).toHaveBeenCalled())
    expect(mocks.marketplaceCreate.mock.calls[0][0]).toEqual({
      marketplace: "shopify",
      name: "Shopify US",
      description: "US store",
      is_disabled: false,
      shop_domain: "us.myshopify.com",
      access_token: "shpat_x",
      webhook_secret: "whsec",
      location_id: "123",
    })
    expect(mocks.plainCreate).not.toHaveBeenCalled()
    expect(mocks.handleSuccess).toHaveBeenCalledWith("../sc_new")
  })

  it("empty marketplace fields still submit", async () => {
    mockMarketplaceResult({
      connection_status: "disconnected",
      input_problem: "missing",
    })
    render(<CreateSalesChannelForm />)
    fillBase()
    fireEvent.click(screen.getByRole("radio", { name: "Amazon" }))
    await submit()

    await waitFor(() => expect(mocks.marketplaceCreate).toHaveBeenCalled())
    // Only the pre-filled marketplace id is sent.
    expect(mocks.marketplaceCreate.mock.calls[0][0]).toEqual({
      marketplace: "amazon",
      name: "Shopify US",
      description: "US store",
      is_disabled: false,
      marketplace_id: "ATVPDKIKX0DER",
    })
    expect(mocks.handleSuccess).toHaveBeenCalledWith("../sc_new")
  })

  const cases: [
    string,
    Record<string, unknown>,
    keyof typeof mocks.toast,
    string,
  ][] = [
    [
      "connected",
      { connection_status: "connected" },
      "success",
      "salesChannels.marketplace.toast.connected",
    ],
    [
      "error",
      { connection_status: "error", message: "bad token" },
      "warning",
      "salesChannels.marketplace.toast.error|bad token",
    ],
    [
      "unavailable",
      { connection_status: "unavailable" },
      "warning",
      "salesChannels.marketplace.toast.unavailable",
    ],
    [
      "disconnected",
      { connection_status: "disconnected" },
      "info",
      "salesChannels.marketplace.toast.disconnected",
    ],
    [
      "disconnected (missing)",
      { connection_status: "disconnected", input_problem: "missing" },
      "info",
      "salesChannels.marketplace.toast.missing",
    ],
    [
      "error without a message",
      { connection_status: "error" },
      "warning",
      "salesChannels.marketplace.toast.errorNoMessage",
    ],
  ]

  it.each(cases)(
    "each connection_status shows the matching toast: %s",
    async (_name, result, kind, text) => {
      mockMarketplaceResult(result)
      render(<CreateSalesChannelForm />)
      fillBase()
      fireEvent.click(screen.getByRole("radio", { name: "Shopify" }))
      await submit()

      await waitFor(() => expect(mocks.toast[kind]).toHaveBeenCalledWith(text))
      expect(mocks.handleSuccess).toHaveBeenCalledWith("../sc_new")
    }
  )
})
