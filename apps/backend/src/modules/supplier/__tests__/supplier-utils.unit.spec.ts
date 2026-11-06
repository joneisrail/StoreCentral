import { escapeLike, normalizeSupplierSku } from "../utils"

describe("escapeLike", () => {
  it("escapes backslash, percent and underscore", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\")
  })

  it("leaves plain text alone", () => {
    expect(escapeLike("Acme")).toBe("Acme")
  })
})

describe("normalizeSupplierSku", () => {
  it("trims and lower-cases the key", () => {
    expect(normalizeSupplierSku("  AB-12 ")).toEqual({
      supplier_sku: "AB-12",
      supplier_sku_key: "ab-12",
    })
  })

  it("throws for empty or whitespace", () => {
    expect(() => normalizeSupplierSku("")).toThrow("Supplier code is required")
    expect(() => normalizeSupplierSku("   ")).toThrow("Supplier code is required")
  })
})
