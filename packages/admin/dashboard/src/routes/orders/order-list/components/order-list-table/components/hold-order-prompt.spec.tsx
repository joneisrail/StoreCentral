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

vi.mock("../../../../../../hooks/api/order-holds", () => ({
  useHoldOrder: () => ({ mutateAsync }),
}))
vi.mock("@medusajs/ui", async () => {
  const actual = await vi.importActual<any>("@medusajs/ui")
  return { ...actual, toast: { success: toastSuccess, error: toastError } }
})

import { HoldOrderPrompt } from "./hold-order-prompt"

afterEach(() => {
  cleanup()
  mutateAsync.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

const setup = () => {
  const onOpenChange = vi.fn()
  render(
    <HoldOrderPrompt
      order={{ id: "order_1", display_id: 7 }}
      open
      onOpenChange={onOpenChange}
    />
  )
  return { onOpenChange }
}

const confirmButton = () =>
  screen.getByRole("button", {
    name: "orders.rowActions.holdConfirm",
  }) as HTMLButtonElement

describe("HoldOrderPrompt", () => {
  it("requires a reason and trims it", async () => {
    mutateAsync.mockResolvedValue({})
    setup()
    expect(confirmButton().disabled).toBe(true)

    await userEvent.type(screen.getByRole("textbox"), "   ")
    expect(confirmButton().disabled).toBe(true)

    await userEvent.type(screen.getByRole("textbox"), "  fraud check  ")
    expect(confirmButton().disabled).toBe(false)
    await userEvent.click(confirmButton())

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "order_1",
      reason: "fraud check",
    })
  })

  it("calls the hold hook, toasts and closes on success", async () => {
    mutateAsync.mockResolvedValue({})
    const { onOpenChange } = setup()
    await userEvent.type(screen.getByRole("textbox"), "stock issue")
    await userEvent.click(confirmButton())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(toastSuccess).toHaveBeenCalledWith("orders.rowActions.holdSuccess")
  })

  it("shows the server message on error and leaves the dialog open", async () => {
    mutateAsync.mockRejectedValue(new Error("Order already shipped"))
    const { onOpenChange } = setup()
    await userEvent.type(screen.getByRole("textbox"), "stock issue")
    await userEvent.click(confirmButton())
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Order already shipped")
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("does not double submit", async () => {
    let resolve: (v: unknown) => void = () => {}
    mutateAsync.mockReturnValue(new Promise((r) => (resolve = r)))
    setup()
    await userEvent.type(screen.getByRole("textbox"), "x")
    await userEvent.click(confirmButton())
    await userEvent.click(confirmButton())
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    resolve({})
  })
})
