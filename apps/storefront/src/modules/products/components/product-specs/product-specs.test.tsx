// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { HttpTypes } from "@medusajs/types"
import { cleanup, render } from "../../../../test/render"
import ProductSpecs from "./index"

afterEach(cleanup)

const make = (p: Partial<HttpTypes.StoreProduct>) =>
  ({ id: "p", title: "T", ...p }) as HttpTypes.StoreProduct

describe("ProductSpecs", () => {
  it("renders nothing when there are no values", () => {
    const { container } = render(<ProductSpecs product={make({})} />)
    expect(container.innerHTML).toBe("")
  })

  it("shows only rows with values", () => {
    const { container } = render(
      <ProductSpecs
        product={make({
          origin_country: "FR",
          weight: 350,
          length: 5,
          width: 4,
          height: 12,
          variants: [{ id: "v", barcode: "123456" }] as never,
        })}
      />
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Country of origin")
    expect(text).toContain("FR")
    expect(text).toContain("123456")
    expect(text).toContain("350 g")
    expect(text).toContain("5 x 4 x 12")
    expect(text).not.toContain("Material")
    expect(text).not.toContain("Type")
  })

  it("omits dimensions unless all three are present", () => {
    const { container } = render(
      <ProductSpecs product={make({ material: "Glass", length: 5 })} />
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Glass")
    expect(text).not.toContain("Dimensions")
  })
})
