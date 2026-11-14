// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@medusajs/ui"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { release, cancel, promptFn, toastSuccess, toastError } = vi.hoisted(
  () => ({
    release: vi.fn(),
    cancel: vi.fn(),
    promptFn: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  })
)

vi.mock("../../../../../../hooks/api/order-holds", () => ({
  useReleaseOrder: () => ({ mutateAsync: release }),
  useHoldOrder: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("../../../../../../hooks/api/orders", () => ({
  useCancelOrder: () => ({ mutateAsync: cancel }),
}))
vi.mock("@medusajs/ui", async () => {
  const actual = await vi.importActual<any>("@medusajs/ui")
  return {
    ...actual,
    usePrompt: () => promptFn,
    toast: { success: toastSuccess, error: toastError },
  }
})

import { RowActionsMenu } from "./row-actions-menu"

afterEach(() => {
  cleanup()
  ;[release, cancel, promptFn, toastSuccess, toastError].forEach((m) =>
    m.mockReset()
  )
})

const order = (extra: Record<string, unknown> = {}) =>
  ({
    id: "order_1",
    display_id: 3,
    fulfillment_status: "not_fulfilled",
    fulfillments: [],
    ...extra,
  }) as any

const open = async (ui: import("react").ReactElement) => {
  render(<TooltipProvider>{ui}</TooltipProvider>)
  await userEvent.click(screen.getByRole("button"))
}

describe("RowActionsMenu", () => {
  it("offers hold and cancel on active rows", async () => {
    await open(<RowActionsMenu order={order()} mode="active" />)
    expect(await screen.findByText("orders.rowActions.hold")).toBeTruthy()
    expect(screen.getByText("orders.rowActions.cancel")).toBeTruthy()
    expect(screen.queryByText("orders.rowActions.release")).toBeNull()
  })

  it("release calls the release hook after confirming", async () => {
    promptFn.mockResolvedValue(true)
    release.mockResolvedValue({})
    await open(<RowActionsMenu order={order()} mode="held" />)
    await userEvent.click(await screen.findByText("orders.rowActions.release"))
    await waitFor(() => expect(release).toHaveBeenCalledWith({ id: "order_1" }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it("release failure shows the server message", async () => {
    promptFn.mockResolvedValue(true)
    release.mockRejectedValue(new Error("nope"))
    await open(<RowActionsMenu order={order()} mode="held" />)
    await userEvent.click(await screen.findByText("orders.rowActions.release"))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("nope"))
  })

  it("held orders can still be cancelled", async () => {
    promptFn.mockResolvedValue(true)
    cancel.mockResolvedValue({})
    await open(<RowActionsMenu order={order()} mode="held" />)
    await userEvent.click(await screen.findByText("orders.rowActions.cancel"))
    await waitFor(() => expect(cancel).toHaveBeenCalled())
  })

  it("cancel is disabled for an order with a fulfillment", async () => {
    await open(
      <RowActionsMenu
        order={order({ fulfillments: [{ id: "ful_1" }] })}
        mode="active"
      />
    )
    const item = (await screen.findByText("orders.rowActions.cancel")).closest(
      "[role=menuitem]"
    )
    expect(item?.hasAttribute("data-disabled")).toBe(true)
    await userEvent.click(item as Element)
    expect(promptFn).not.toHaveBeenCalled()
  })

  it("does not offer hold for a shipped order", async () => {
    await open(
      <RowActionsMenu
        order={order({ fulfillment_status: "shipped" })}
        mode="active"
      />
    )
    await screen.findByText("orders.rowActions.cancel")
    expect(screen.queryByText("orders.rowActions.hold")).toBeNull()
  })
  it.each([
    ["fulfilled", undefined],
    ["partially_shipped", undefined],
    ["shipped", undefined],
    ["delivered", undefined],
    ["partially_delivered", undefined],
    ["not_fulfilled", "canceled"],
    [undefined, undefined],
    ["something_new", undefined],
  ])(
    "does not offer hold for fulfillment_status %s / status %s",
    async (fulfillment_status, status) => {
      await open(
        <RowActionsMenu
          order={order({ fulfillment_status, status })}
          mode="active"
        />
      )
      await screen.findByText("orders.rowActions.cancel")
      expect(screen.queryByText("orders.rowActions.hold")).toBeNull()
    }
  )

  it.each(["not_fulfilled", "partially_fulfilled"])(
    "offers hold for fulfillment_status %s",
    async (fulfillment_status) => {
      await open(
        <RowActionsMenu order={order({ fulfillment_status })} mode="active" />
      )
      expect(await screen.findByText("orders.rowActions.hold")).toBeTruthy()
    }
  )
})
