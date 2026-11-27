// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { HttpTypes } from "@medusajs/types"
import { cleanup, render } from "../../../../test/render"
import ProductTabs from "./index"

afterEach(cleanup)

const bare = { id: "p", title: "T" } as HttpTypes.StoreProduct
const specced = { ...bare, material: "Glass" } as HttpTypes.StoreProduct

describe("ProductTabs", () => {
  it("omits both items when there is nothing to show", () => {
    const { container } = render(<ProductTabs product={bare} />)
    expect(container.textContent).not.toContain("Specifications")
    expect(container.textContent).not.toContain("Shipping and returns")
  })

  it("shows Specifications only when specs exist", () => {
    const { container } = render(<ProductTabs product={specced} />)
    expect(container.textContent).toContain("Specifications")
    expect(container.textContent).not.toContain("Shipping and returns")
  })

  it("shows Shipping and returns when a note is given", () => {
    const { container } = render(
      <ProductTabs product={bare} shippingNote="Ships in 2 days" returnsNote="  " />
    )
    expect(container.textContent).toContain("Shipping and returns")
    expect(container.textContent).not.toContain("Specifications")
  })
})
