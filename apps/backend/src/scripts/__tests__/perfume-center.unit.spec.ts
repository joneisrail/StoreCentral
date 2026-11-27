import {
  DEPT_CATEGORIES,
  barcodeFrom,
  brandHandles,
  genderFromDescription,
  parseSheet,
  planProducts,
  sellingPriceCents,
  slugify,
  toCents,
  toSku,
  type SheetRow,
} from "../helpers/perfume-center"

const row = (over: Partial<SheetRow> = {}): SheetRow => ({
  dept: "M",
  designer: "Carolina Herrera",
  upc: "8411061896259",
  coo: "ES",
  item: "I0079777",
  description: "212 (M) EDT SP 1.7oz(NEW PACK)",
  price: "$34.00",
  salePrice: "$39.10",
  imageUrl: "https://www.pim-hub.com/pcaimages/pricelist/I0079777.jpg",
  ...over,
})

describe("toSku", () => {
  it("puts an A in front of the supplier item", () => {
    expect(toSku("I0087568")).toBe("AI0087568")
  })
})

describe("sellingPriceCents", () => {
  it("adds 30 percent and rounds up to the next 50 cents", () => {
    expect(sellingPriceCents(3400)).toBe(4450)
    expect(sellingPriceCents(5000)).toBe(6500)
    expect(sellingPriceCents(25)).toBe(50)
    expect(sellingPriceCents(2150)).toBe(2800)
  })
})

describe("toCents", () => {
  it("reads dollar strings and rejects junk", () => {
    expect(toCents("$1,234.50")).toBe(123450)
    expect(toCents("$0.25")).toBe(25)
    expect(toCents("abc")).toBeNull()
  })
})

describe("slugify and gender", () => {
  it("never ends in a hyphen after cutting long text, so handles stay valid", () => {
    const long = "360 TRIO(M)3PC SET(3X1.0oz EDT SP REGULAR(LI FREE),1.0oz EDT SP RED(LI FREE),1.0oz EDT SP BLUE)"
    const handle = planProducts([row({ description: long, item: "I0009025" })]).products[0].handle

    expect(handle).not.toMatch(/--/)
    expect(handle).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(handle.endsWith("-ai0009025")).toBe(true)
  });

  it("makes url-safe slugs", () => {
    expect(slugify("Hermès Terre d'Hermès (M) EDT 3.4oz")).toBe(
      "hermes-terre-d-hermes-m-edt-3-4oz"
    )
  })

  it("reads the (M) (W) (U) marker", () => {
    expect(genderFromDescription("212 (M) EDT")).toBe("Men")
    expect(genderFromDescription("GOOD GIRL(W)EDP")).toBe("Women")
    expect(genderFromDescription("OUD(U)EXTRAIT")).toBe("Unisex")
    expect(genderFromDescription("NO MARKER")).toBeNull()
  })

  it("accepts only barcode-shaped numbers", () => {
    expect(barcodeFrom("8411061896259")).toBe("8411061896259")
    expect(barcodeFrom("I0098702")).toBeNull()
    expect(barcodeFrom("")).toBeNull()
  })
})

describe("planProducts", () => {
  it("plans a fragrance row with our SKU, selling price and image", () => {
    const { products, skipped } = planProducts([row()])

    expect(skipped).toEqual([])
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      sku: "AI0079777",
      item: "I0079777",
      costCents: 3400,
      priceCents: 4450,
      barcode: "8411061896259",
      gender: "Men",
      brand: "Carolina Herrera",
      handle: "212-m-edt-sp-1-7oz-new-pack-ai0079777",
    })
  })

  it("skips non-fragrance departments, bad items, duplicates and bad prices", () => {
    const { products, skipped } = planProducts([
      row({ dept: "WTST", item: "I0000001" }),
      row({ item: "BAD" }),
      row({ item: "I0000002", price: "$0.00" }),
      row({ item: "I0000003", description: "" }),
      row({ item: "I0000004" }),
      row({ item: "I0000004" }),
    ])

    expect(products.map((p) => p.item)).toEqual(["I0000004"])
    expect(skipped.map((s) => s.reason).sort()).toEqual([
      "bad-item",
      "bad-price",
      "department",
      "duplicate-item",
      "no-description",
    ])
  })

  it("gives a repeated barcode to the first product only", () => {
    const { products } = planProducts([
      row({ item: "I0000010" }),
      row({ item: "I0000011" }),
    ])

    expect(products[0].barcode).toBe("8411061896259")
    expect(products[1].barcode).toBeNull()
    expect(products[1].upc).toBe("8411061896259")
  })

  it("leaves the barcode empty when the sheet repeats the item id", () => {
    const { products } = planProducts([row({ upc: "I0079777" })])

    expect(products[0].barcode).toBeNull()
    expect(products[0].upc).toBeNull()
  })

  it("drops an image link that is not http", () => {
    const { products } = planProducts([row({ imageUrl: "I0079777" })])

    expect(products[0].imageUrl).toBeNull()
  })
})

describe("brandHandles", () => {
  it("keeps handles unique and avoids reserved ones", () => {
    const handles = brandHandles(["Guess", "Guess ", "GUESS!", "Pants"], ["pants"])

    expect(new Set(handles.values()).size).toBe(handles.size)
    expect(handles.get("Pants")).toBe("pants-2")
  })
})

describe("parseSheet", () => {
  it("reads a Windows-1252 export with the repeated Hyperlink column", () => {
    const csv =
      "DEPT,D,DESIGNER,UPC,COO,Item,Description,CASEPACK,Price  ,SalePrice,Qty,Hyperlink,Hyperlink\r\n" +
      "M         ,    ,Herm\xe8s,3346130,FR     ,I0000001,TERRE D'HERM\xc8S(M)EDT   ,,$50.00,$57.50,,I0000001,https://x.test/I0000001.jpg\r\n" +
      ",,,,,,,,,,,,\r\n"
    const rows = parseSheet(Buffer.from(csv, "latin1"))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      dept: "M",
      designer: "Hermès",
      item: "I0000001",
      description: "TERRE D'HERMÈS(M)EDT",
      price: "$50.00",
      salePrice: "$57.50",
      imageUrl: "https://x.test/I0000001.jpg",
    })
  })
})

describe("DEPT_CATEGORIES", () => {
  it("names M and W as Men and Women", () => {
    expect(DEPT_CATEGORIES.M.name).toBe("Men")
    expect(DEPT_CATEGORIES.W.name).toBe("Women")
  })

  it("has a unique handle for every department and none clashes with brands", () => {
    const handles = Object.values(DEPT_CATEGORIES).map((c) => c.handle)

    expect(new Set(handles).size).toBe(handles.length)
    expect(handles).not.toContain("brands")
  })
})
