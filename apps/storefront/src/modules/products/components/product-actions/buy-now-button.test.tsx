// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import { ToastProvider } from "@modules/common/components/toast"
import BuyNowButton from "./buy-now-button"

const addToCart = vi.fn()
const push = vi.fn()

vi.mock("@lib/data/cart", () => ({
  addToCart: (...args: unknown[]) => addToCart(...args),
}))
vi.mock("next/navigation", () => ({
  useParams: () => ({ countryCode: "us" }),
  useRouter: () => ({ push }),
}))

const onPendingChange = vi.fn()
const setup = (variantId: string | undefined, disabled = false) =>
  render(
    <ToastProvider>
      <BuyNowButton variantId={variantId} quantity={3} disabled={disabled}
        onPendingChange={onPendingChange}
      />
    </ToastProvider>
  )
const button = () => document.querySelector("button") as HTMLButtonElement

beforeEach(() => {
  addToCart.mockReset()
  push.mockReset()
  onPendingChange.mockReset()
})
afterEach(cleanup)

describe("BuyNowButton", () => {
  it("adds the quantity once, then goes to checkout", async () => {
    addToCart.mockResolvedValue(undefined)
    setup("variant_1")
    await act(async () => {
      await userEvent.click(button())
    })
    expect(addToCart).toHaveBeenCalledTimes(1)
    expect(addToCart).toHaveBeenCalledWith({
      variantId: "variant_1",
      quantity: 3,
      countryCode: "us",
    })
    expect(push).toHaveBeenCalledWith("/us/checkout")
  })
  it("toasts the fixed text and stays put on failure", async () => {
    addToCart.mockRejectedValue(new Error("Variant is out of stock"))
    setup("variant_1")
    await act(async () => {
      await userEvent.click(button())
    })
    expect(document.body.textContent).toContain("Couldn't add to cart")
    expect(document.body.textContent).not.toContain("Variant is out of stock")
    expect(push).not.toHaveBeenCalled()
    expect(button().disabled).toBe(false)
  })
  it("is disabled without a variant or when disabled", async () => {
    setup(undefined)
    expect(button().disabled).toBe(true)
    cleanup()
    setup("variant_1", true)
    expect(button().disabled).toBe(true)
    await act(async () => {
      await userEvent.click(button())
    })
    expect(addToCart).not.toHaveBeenCalled()
  })
  it("reports pending state to the parent", async () => {
    addToCart.mockResolvedValue(undefined)
    setup("variant_1")
    await act(async () => {
      await userEvent.click(button())
    })
    expect(onPendingChange.mock.calls).toEqual([[true], [false]])
  })
})
