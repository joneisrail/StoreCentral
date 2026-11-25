// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, userEvent } from "../../../../test/render"
import { ToastProvider } from "@modules/common/components/toast"
import QuickAdd from "./quick-add"

const addToCart = vi.fn()
const refresh = vi.fn()

vi.mock("@lib/data/cart", () => ({
  addToCart: (...args: unknown[]) => addToCart(...args),
}))
vi.mock("next/navigation", () => ({
  useParams: () => ({ countryCode: "us" }),
  useRouter: () => ({ refresh }),
}))

type Props = Parameters<typeof QuickAdd>[0]

const setup = (props: Partial<Props> = {}) =>
  render(
    <ToastProvider>
      <QuickAdd
        productId="prod_1"
        title="Oud"
        inStock={true}
        singleVariantId="variant_1"
        href="/products/oud"
        {...props}
      />
    </ToastProvider>
  )

const button = () => document.querySelector("button") as HTMLButtonElement

beforeEach(() => {
  addToCart.mockReset()
  refresh.mockReset()
})

afterEach(cleanup)

describe("QuickAdd", () => {
  it("renders a disabled Sold out button when out of stock", async () => {
    setup({ inStock: false })
    expect(button().textContent).toBe("Sold out")
    expect(button().disabled).toBe(true)
    await act(async () => {
      await userEvent.click(button())
    })
    expect(addToCart).not.toHaveBeenCalled()
  })

  it("adds once even when clicked twice quickly, then toasts", async () => {
    let resolve: () => void = () => {}
    addToCart.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r
      })
    )
    setup()
    await act(async () => {
      const el = button()
      el.click()
      el.click()
    })
    expect(addToCart).toHaveBeenCalledTimes(1)
    expect(addToCart).toHaveBeenCalledWith({
      variantId: "variant_1",
      quantity: 1,
      countryCode: "us",
    })
    expect(button().disabled).toBe(true)
    await act(async () => {
      resolve()
    })
    expect(document.body.textContent).toContain("Added to cart")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(button().disabled).toBe(false)
  })

  it("shows an error toast and re-enables on failure", async () => {
    addToCart.mockRejectedValue(new Error("No stock left"))
    setup()
    await act(async () => {
      await userEvent.click(button())
    })
    expect(document.body.textContent).toContain("No stock left")
    expect(button().disabled).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("falls back to a generic message for non-Error rejections", async () => {
    addToCart.mockRejectedValue("nope")
    setup()
    await act(async () => {
      await userEvent.click(button())
    })
    expect(document.body.textContent).toContain("Couldn't add to cart")
  })

  it("renders a link and no button for multi-variant products", () => {
    setup({ singleVariantId: null })
    expect(document.querySelector("button")).toBeNull()
    const link = document.querySelector("a") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe("/products/oud")
    expect(link.textContent).toBe("Choose options")
  })
})
