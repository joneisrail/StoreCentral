import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import { footerCategories } from "./footer-categories"

const category = (
  handle: string,
  over: Partial<HttpTypes.StoreProductCategory> = {}
) => ({ id: handle, name: handle, handle, ...over }) as HttpTypes.StoreProductCategory

describe("footerCategories", () => {
  it("leaves out the brands category and keeps the others", () => {
    const result = footerCategories([
      category("brands"),
      category("body-care"),
      category("gift-sets"),
    ])

    expect(result.map((c) => c.handle)).toEqual(["body-care", "gift-sets"])
  })

  it("leaves out child categories", () => {
    const parent = category("brands")
    const result = footerCategories([
      category("guess", { parent_category: parent }),
      category("body-care"),
    ])

    expect(result.map((c) => c.handle)).toEqual(["body-care"])
  })

  it("is empty when only brands exist, and for no input", () => {
    expect(footerCategories([category("brands")])).toEqual([])
    expect(footerCategories(null)).toEqual([])
    expect(footerCategories(undefined)).toEqual([])
  })

  it("lists at most six", () => {
    const many = Array.from({ length: 9 }, (_, i) => category(`c${i}`))

    expect(footerCategories(many)).toHaveLength(6)
  })
})
